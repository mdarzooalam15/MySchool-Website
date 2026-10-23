require("dotenv").config();

const express = require("express");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Check required environment variables
const required = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "RESEND_API_KEY",
  "SCHOOL_EMAIL",
  "EMAIL_FROM",
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD",
  "SESSION_SECRET",
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing .env setting: ${key}`);
  }
}

if (process.env.SESSION_SECRET.length < 32) {
  throw new Error("SESSION_SECRET must be at least 32 characters.");
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
);

const resend = new Resend(process.env.RESEND_API_KEY);

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": ["'self'", "'unsafe-inline'"],
        "script-src-attr": ["'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'", "https:"],
        "img-src": ["'self'", "data:", "https://images.unsplash.com"],
      },
    },
  }),
);

app.use(express.json({ limit: "20kb" }));

// General API rate limit
app.use(
  "/api/",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

// Admin session — localhost development configuration
app.use(
  session({
    name: "ba_admin_session",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      maxAge: 30 * 60 * 1000,
    },
  }),
);

// Admin login rate limit
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

// Constant-time comparison for credentials
function safeEqual(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));

  return (
    first.length === second.length && crypto.timingSafeEqual(first, second)
  );
}

// Require authenticated admin
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin === true) {
    return next();
  }

  return res.status(401).json({
    error: "Admin login required.",
  });
}

// Basic same-origin protection for state-changing requests
function sameOrigin(req, res, next) {
  const origin = req.get("origin");

  if (!origin) {
    return res.status(403).json({
      error: "Origin header required.",
    });
  }

  try {
    if (new URL(origin).host !== req.get("host")) {
      return res.status(403).json({
        error: "Invalid request origin.",
      });
    }
  } catch {
    return res.status(403).json({
      error: "Invalid request origin.",
    });
  }

  next();
}

// ------------------------------
// ADMIN LOGIN
// ------------------------------
app.post(
  "/api/admin/login",
  adminLoginLimiter,
  sameOrigin,
  (req, res, next) => {
    const { username, password } = req.body || {};

    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      !safeEqual(username, process.env.ADMIN_USERNAME) ||
      !safeEqual(password, process.env.ADMIN_PASSWORD)
    ) {
      return res.status(401).json({
        error: "Invalid username or password.",
      });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);

      req.session.isAdmin = true;

      req.session.save((saveError) => {
        if (saveError) return next(saveError);

        res.json({ success: true });
      });
    });
  },
);

// Check whether admin session is active
app.get("/api/admin/me", requireAdmin, (req, res) => {
  res.json({ authenticated: true });
});

// ------------------------------
// ADMIN LOGOUT
// ------------------------------
app.post("/api/admin/logout", requireAdmin, sameOrigin, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);

    res.clearCookie("ba_admin_session", {
      httpOnly: true,
      secure: false,
      sameSite: "strict",
    });

    res.json({ success: true });
  });
});

// ------------------------------
// GET ADMISSION APPLICATIONS
// ------------------------------
app.get("/api/admin/admissions", requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("admissions")
      .select(
        "id, student_name, class_applied, parent_name, phone, created_at, status",
      )
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error("Admin query failed:", error.message);

      return res.status(500).json({
        error: "Could not load applications.",
      });
    }

    res.json(data);
  } catch (err) {
    console.error("Admin admissions error:", err.message);

    res.status(500).json({
      error: "Could not load applications.",
    });
  }
});

// ------------------------------
// UPDATE APPLICATION STATUS
// ------------------------------
app.patch(
  "/api/admin/admissions/:id/status",
  requireAdmin,
  sameOrigin,
  async (req, res) => {
    const { id } = req.params;
    const { status } = req.body || {};

    const allowedStatuses = ["Pending", "Under Review", "Accepted", "Rejected"];

    if (!/^[1-9]\d*$/.test(id)) {
      return res.status(400).json({
        error: "Invalid application ID.",
      });
    }

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: "Invalid application status.",
      });
    }

    try {
      const { data, error } = await supabase
        .from("admissions")
        .update({ status })
        .eq("id", id)
        .select("id, status")
        .maybeSingle();

      if (error) {
        console.error("Status update failed:", error.message);

        return res.status(500).json({
          error: "Could not update application status.",
        });
      }

      if (!data) {
        return res.status(404).json({
          error: "Application not found.",
        });
      }

      res.json({
        success: true,
        application: data,
      });
    } catch (err) {
      console.error("Status update error:", err.message);

      res.status(500).json({
        error: "Could not update application status.",
      });
    }
  },
);

// ------------------------------
// PUBLIC ADMISSION FORM
// ------------------------------
app.post("/api/admissions", async (req, res) => {
  const b = req.body || {};

  const studentName = String(b.student_name || "").trim();
  const classApplied = String(b.class_applied || "").trim();
  const parentName = String(b.parent_name || "").trim();
  const phone = String(b.phone || "").trim();
  const email = String(b.email || "").trim();

  if (!studentName || !classApplied || !parentName || !phone) {
    return res.status(400).json({
      error: "Please fill in all required fields.",
    });
  }

  if (b.consent !== true) {
    return res.status(400).json({
      error: "Consent is required.",
    });
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({
      error: "Please enter a valid email.",
    });
  }

  const application = {
    student_name: studentName.slice(0, 100),
    date_of_birth: b.date_of_birth || null,
    class_applied: classApplied.slice(0, 50),
    previous_school: String(b.previous_school || "").slice(0, 150),
    parent_name: parentName.slice(0, 100),
    relationship: String(b.relationship || "").slice(0, 50),
    phone: phone.slice(0, 25),
    email: email || null,
    address: String(b.address || "").slice(0, 500),
    note: String(b.note || "").slice(0, 1000),
    consent: true,
  };

  try {
    const { data, error } = await supabase
      .from("admissions")
      .insert(application)
      .select("id")
      .single();

    if (error) {
      console.error("Database insert failed:", error.message);

      return res.status(500).json({
        error: "Could not save application.",
      });
    }

    let emailSent = false;

    try {
      const result = await resend.emails.send({
        from: process.env.EMAIL_FROM,
        to: [process.env.SCHOOL_EMAIL],
        subject: `New admission application #${data.id}`,
        text: [
          `Application ID: ${data.id}`,
          `Student: ${studentName}`,
          `Class: ${classApplied}`,
          `Parent/Guardian: ${parentName}`,
          `Phone: ${phone}`,
          `Email: ${email || "Not provided"}`,
        ].join("\n"),
      });

      emailSent = !result.error;

      if (result.error) {
        console.error("Email sending failed:", result.error);
      }
    } catch (err) {
      console.error("Email sending error:", err.message);
    }

    res.status(201).json({
      success: true,
      applicationId: data.id,
      emailSent,
      message: emailSent
        ? "Application saved and email sent."
        : "Application saved, but email failed.",
    });
  } catch (err) {
    console.error("Admission submission failed:", err.message);

    res.status(500).json({
      error: "Something went wrong while saving the application.",
    });
  }
});

app.post("/api/contact", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim();
    const message = String(req.body?.message || "").trim();

    if (!name || !email || !message) {
      return res.status(400).json({
        error: "Please fill in all contact form fields.",
      });
    }

    if (
      name.length > 100 ||
      email.length > 254 ||
      message.length > 5000 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return res.status(400).json({
        error:
          "Please enter valid details. Message must be under 5000 characters.",
      });
    }

    const { data, error } = await supabase
      .from("contact_enquiries")
      .insert([{ name, email, message }])
      .select("id")
      .single();

    if (error) {
      console.error("Contact enquiry save failed:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });

      return res.status(500).json({
        error: "Could not save your enquiry. Please try again.",
      });
    }

    const emailResult = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: [process.env.SCHOOL_EMAIL],
      subject: `New Contact Enquiry #${data.id} - British Academy`,
      text: [
        "A new contact enquiry was submitted.",
        "",
        `Enquiry ID: ${data.id}`,
        `Name: ${name}`,
        `Email: ${email}`,
        "",
        "Message:",
        message,
      ].join("\n"),
      replyTo: email,
    });

    if (emailResult.error) {
      console.error(
        "Contact notification email failed:",
        emailResult.error.message,
      );
      return res.status(500).json({
        error:
          "Your enquiry was saved, but the school email could not be sent.",
      });
    }

    return res.status(201).json({
      success: true,
      message: "Your enquiry was saved and the school was notified.",
      id: data.id,
    });
  } catch (error) {
    console.error("Contact route failed:", error.message);
    return res.status(500).json({
      error: "An unexpected error occurred. Please try again.",
    });
  }
});

// ------------------------------
// BLOCK SENSITIVE FILE REQUESTS
// ------------------------------
app.use((req, res, next) => {
  let requestPath;

  try {
    requestPath = decodeURIComponent(req.path);
  } catch {
    return res.sendStatus(400);
  }

  const blocked =
    /^\/(?:\.env|server(?:\.backup)?\.js|package(?:-lock)?\.json|.*\.backup\.js|node_modules|\.git)(?:\/|$)/i;

  if (blocked.test(requestPath)) {
    return res.sendStatus(404);
  }

  next();
});

// Serve existing website files
app.use(express.static(path.join(__dirname)));

// Handle unexpected errors without exposing internals
app.use((err, req, res, next) => {
  console.error("Server error:", err.message);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: "Internal server error.",
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`British Academy server: http://localhost:${PORT}`);
});
