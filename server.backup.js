
require("dotenv").config();
console.log("CUSTOM BRITISH ACADEMY SERVER LOADED");

const express = require("express");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

const app = express();

const required = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "RESEND_API_KEY",
  "SCHOOL_EMAIL",
  "EMAIL_FROM"
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing .env setting: ${key}`);
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);



app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": ["'self'", "'unsafe-inline'"],
        "script-src-attr": ["'unsafe-inline'"],
        "img-src": [
          "'self'",
          "data:",
          "https://images.unsplash.com"
        ]
      }
    }
  })
);


app.use(express.json({ limit: "20kb" }));

app.use("/api/", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20
}));
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; img-src 'self' data: https://images.unsplash.com; style-src 'self' 'unsafe-inline' https:;"
  );
  next();
});
app.use(express.static(path.join(__dirname)));

app.post("/api/admissions", async (req, res) => {
  const b = req.body || {};

  const studentName = String(b.student_name || "").trim();
  const classApplied = String(b.class_applied || "").trim();
  const parentName = String(b.parent_name || "").trim();
  const phone = String(b.phone || "").trim();
  const email = String(b.email || "").trim();

  if (!studentName || !classApplied || !parentName || !phone) {
    return res.status(400).json({
      error: "Please fill in all required fields."
    });
  }

  if (b.consent !== true) {
    return res.status(400).json({
      error: "Consent is required."
    });
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({
      error: "Please enter a valid email."
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
    consent: true
  };

  try {
    const { data, error } = await supabase
      .from("admissions")
      .insert(application)
      .select("id")
      .single();

  if (error) {
  console.error("Database error details:", {
    message: error.message,
    details: error.details,
    hint: error.hint,
    code: error.code,
    cause: error.cause?.message,
    causeCode: error.cause?.code
  });

  return res.status(500).json({
    error: "Could not save application."
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
          `Email: ${email || "Not provided"}`
        ].join("\n")
      });

      emailSent = !result.error;

      if (result.error) {
        console.error("Email error:", result.error);
      }
    } catch (e) {
      console.error("Email failed:", e.message);
    }

    res.status(201).json({
      success: true,
      applicationId: data.id,
      emailSent,
      message: emailSent
        ? "Application saved and email sent."
        : "Application saved, but email failed."
    });
  } catch (e) {
    console.error("FULL SERVER ERROR:", e);
    console.error("ERROR CAUSE:", e.cause);

    res.status(500).json({
      error: "Something went wrong.",
      debug: e.message
    });
  }
});


app.listen(Number(process.env.PORT) || 3000, () => {
  console.log(`British Academy server: http://localhost:${Number(process.env.PORT) || 3000}`);
});
