const menuToggle = document.getElementById("menuToggle");
const navigation = document.getElementById("navigation");

menuToggle.addEventListener("click", () => {
    const isOpen = navigation.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.textContent = isOpen ? "✕" : "☰";
});

navigation.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
        navigation.classList.remove("open");
        menuToggle.setAttribute("aria-expanded", "false");
        menuToggle.textContent = "☰";
    });
});

document.getElementById("year").textContent =
    new Date().getFullYear();

/*document.getElementById("contactForm").addEventListener("submit", (event) => {
    event.preventDefault();

    document.getElementById("formMessage").textContent =
        "Thank you! The form design works, but message delivery needs a backend or form service.";

    event.target.reset();
});*/

document.getElementById("contactForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = event.target;
    const messageBox = document.getElementById("formMessage");
    const button = form.querySelector('button[type="submit"]');

    const formData = {
        name: form.elements.name.value.trim(),
        email: form.elements.email.value.trim(),
        message: form.elements.message.value.trim()
    };

    messageBox.textContent = "Sending your enquiry...";
    button.disabled = true;

    try {
        const response = await fetch("/api/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formData)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "Could not send enquiry.");
        }

        messageBox.textContent = "Thank you! Your enquiry has been sent successfully.";
        form.reset();
    } catch (error) {
        messageBox.textContent = error.message || "Something went wrong. Please try again.";
    } finally {
        button.disabled = false;
    }
});
