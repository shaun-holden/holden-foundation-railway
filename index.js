const express = require("express");
const path = require("path");
const { Resend } = require("resend");
const Stripe = require("stripe");
const multer = require("multer");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const PORT = process.env.PORT || 3000;
const resend = new Resend(process.env.RESEND_API_KEY);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Stripe webhook needs raw body — must come before express.json()
app.post("/api/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const donorEmail = session.customer_details?.email;
    const donorName = session.customer_details?.name || "Valued Donor";
    const amount = (session.amount_total / 100).toFixed(2);
    const date = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    if (donorEmail) {
      try {
        // Send tax receipt to donor
        await resend.emails.send({
          from: "Holden Foundation <noreply@holdenfoundationforkidssports.com>",
          to: donorEmail,
          subject: "Thank You for Your Donation — Tax Receipt",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #060918; color: #f8fafc; padding: 40px; border-radius: 12px;">
              <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="font-size: 28px; color: #f5c842; margin: 0;">Holden Foundation for Kids Sports</h1>
                <p style="color: #94a3b8; font-size: 14px; margin-top: 5px;">501(c)(3) Nonprofit Organization</p>
              </div>

              <div style="background: #0a0e2a; border: 1px solid rgba(245,200,66,0.2); border-radius: 10px; padding: 30px; margin-bottom: 25px;">
                <h2 style="color: #f5c842; font-size: 22px; margin-top: 0;">Donation Receipt</h2>
                <p style="color: #f8fafc; line-height: 1.8; margin: 0;">
                  <strong>Donor:</strong> ${donorName}<br/>
                  <strong>Date:</strong> ${date}<br/>
                  <strong>Amount:</strong> $${amount}<br/>
                  <strong>Payment Method:</strong> Online (Stripe)
                </p>
              </div>

              <div style="background: #0a0e2a; border: 1px solid rgba(56,189,248,0.2); border-radius: 10px; padding: 25px; margin-bottom: 25px;">
                <p style="color: #f8fafc; line-height: 1.8; margin: 0;">
                  Dear ${donorName},
                </p>
                <p style="color: #94a3b8; line-height: 1.8;">
                  Thank you for your generous contribution to the Holden Foundation for Kids Sports. Your donation directly supports youth athletic programs, scholarships, and community outreach for children in need.
                </p>
                <p style="color: #94a3b8; line-height: 1.8;">
                  No goods or services were provided in exchange for this contribution. This letter serves as your official receipt for tax purposes.
                </p>
              </div>

              <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 20px; text-align: center;">
                <p style="color: #94a3b8; font-size: 13px; line-height: 1.6;">
                  <strong style="color: #f5c842;">Holden Foundation for Kids Sports</strong><br/>
                  Peachtree Corners, GA<br/>
                  info@holdenfoundation.org<br/>
                  EIN: 88-2344143
                </p>
                <p style="color: #94a3b8; font-size: 12px;">
                  Please retain this receipt for your tax records.
                </p>
              </div>
            </div>
          `,
        });

        // Notify you about the donation
        await resend.emails.send({
          from: "Holden Foundation <noreply@holdenfoundationforkidssports.com>",
          to: "holdensportsforkids@gmail.com",
          subject: `New Donation: $${amount} from ${donorName}`,
          html: `
            <h2>New Donation Received!</h2>
            <p><strong>Donor:</strong> ${donorName}</p>
            <p><strong>Email:</strong> ${donorEmail}</p>
            <p><strong>Amount:</strong> $${amount}</p>
            <p><strong>Date:</strong> ${date}</p>
            <p>A tax receipt has been automatically sent to the donor.</p>
          `,
        });

        console.log(`Donation receipt sent to ${donorEmail} for $${amount}`);
      } catch (err) {
        console.error("Failed to send donation receipt:", err);
      }
    }
  }

  res.json({ received: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/contact", async (req, res) => {
  const { firstName, lastName, email, interest, message } = req.body;

  if (!firstName || !email || !message) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    await resend.emails.send({
      from: "Holden Foundation <noreply@holdenfoundationforkidssports.com>",
      to: "holdensportsforkids@gmail.com",
      subject: `New Contact: ${firstName} ${lastName} — ${interest}`,
      html: `
        <h2>New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${firstName} ${lastName}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Interest:</strong> ${interest}</p>
        <p><strong>Message:</strong></p>
        <p>${message}</p>
      `,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Resend error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

const scholarshipUpload = upload.fields([
  { name: "reportCard", maxCount: 1 },
  { name: "coachLetter", maxCount: 1 },
  { name: "proofOfIncome", maxCount: 1 },
]);

app.post("/api/scholarship", scholarshipUpload, async (req, res) => {
  const d = req.body;

  if (!d.parentFirstName || !d.parentEmail || !d.childFirstName || !d.whyImportant) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const attachments = [];
  for (const field of ["reportCard", "coachLetter", "proofOfIncome"]) {
    if (req.files && req.files[field] && req.files[field][0]) {
      const file = req.files[field][0];
      attachments.push({
        filename: file.originalname,
        content: file.buffer,
      });
    }
  }

  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  try {
    // Send application to foundation
    await resend.emails.send({
      from: "Holden Foundation <noreply@holdenfoundationforkidssports.com>",
      to: "holdensportsforkids@gmail.com",
      subject: `Scholarship Application: ${d.childFirstName} ${d.childLastName}`,
      attachments,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 700px;">
          <h1 style="color: #f5c842;">New Scholarship Application</h1>
          <p style="color: #666;">Received on ${date}</p>

          <h2 style="color: #38bdf8; border-bottom: 1px solid #ddd; padding-bottom: 8px;">Parent / Guardian</h2>
          <p><strong>Name:</strong> ${d.parentFirstName} ${d.parentLastName}</p>
          <p><strong>Email:</strong> ${d.parentEmail}</p>
          <p><strong>Phone:</strong> ${d.parentPhone || "N/A"}</p>
          <p><strong>Relationship:</strong> ${d.relationship || "N/A"}</p>
          <p><strong>Address:</strong> ${d.street || ""}, ${d.city || ""}, ${d.state || ""} ${d.zip || ""}</p>

          <h2 style="color: #38bdf8; border-bottom: 1px solid #ddd; padding-bottom: 8px;">Child / Athlete</h2>
          <p><strong>Name:</strong> ${d.childFirstName} ${d.childLastName}</p>
          <p><strong>Date of Birth:</strong> ${d.dob || "N/A"}</p>
          <p><strong>Age:</strong> ${d.age || "N/A"}</p>
          <p><strong>Gender:</strong> ${d.gender || "N/A"}</p>
          <p><strong>School:</strong> ${d.school || "N/A"}</p>
          <p><strong>Grade:</strong> ${d.gradeLevel || "N/A"}</p>
          <p><strong>Sport(s):</strong> ${d.sports || "N/A"}</p>

          <h2 style="color: #38bdf8; border-bottom: 1px solid #ddd; padding-bottom: 8px;">Financial Need</h2>
          <p><strong>Household Income:</strong> ${d.incomeRange || "N/A"}</p>
          <p><strong>Household Members:</strong> ${d.householdMembers || "N/A"}</p>
          <p><strong>Currently in Sports:</strong> ${d.currentlyInSports || "N/A"}</p>
          <p><strong>Current Program:</strong> ${d.currentProgram || "N/A"}</p>
          <p><strong>Previous Scholarship:</strong> ${d.previousScholarship || "N/A"}</p>

          <h2 style="color: #38bdf8; border-bottom: 1px solid #ddd; padding-bottom: 8px;">Personal Statement</h2>
          <p><strong>Why this scholarship is important:</strong></p>
          <p style="background: #f5f5f5; padding: 12px; border-radius: 6px;">${d.whyImportant}</p>
          <p><strong>Athletic experience & goals:</strong></p>
          <p style="background: #f5f5f5; padding: 12px; border-radius: 6px;">${d.athleticExperience || "N/A"}</p>
          <p><strong>Additional info:</strong></p>
          <p style="background: #f5f5f5; padding: 12px; border-radius: 6px;">${d.additionalInfo || "N/A"}</p>

          <p style="margin-top: 20px; color: #666; font-size: 13px;">
            ${attachments.length} document(s) attached.
          </p>
        </div>
      `,
    });

    // Send confirmation to parent
    await resend.emails.send({
      from: "Holden Foundation <noreply@holdenfoundationforkidssports.com>",
      to: d.parentEmail,
      subject: "Scholarship Application Received — Holden Foundation",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #060918; color: #f8fafc; padding: 40px; border-radius: 12px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="font-size: 28px; color: #f5c842; margin: 0;">Holden Foundation for Kids Sports</h1>
            <p style="color: #94a3b8; font-size: 14px; margin-top: 5px;">Scholarship Program</p>
          </div>

          <div style="background: #0a0e2a; border: 1px solid rgba(56,189,248,0.2); border-radius: 10px; padding: 25px; margin-bottom: 25px;">
            <p style="color: #f8fafc; line-height: 1.8; margin: 0;">
              Dear ${d.parentFirstName},
            </p>
            <p style="color: #94a3b8; line-height: 1.8;">
              Thank you for submitting a scholarship application for <strong style="color: #f8fafc;">${d.childFirstName} ${d.childLastName}</strong>. We have received your application and all supporting documents.
            </p>
            <p style="color: #94a3b8; line-height: 1.8;">
              Our team will review your application carefully. Please allow 2–4 weeks for processing. If we need any additional information, we will reach out to you at this email address.
            </p>
          </div>

          <div style="background: #0a0e2a; border: 1px solid rgba(245,200,66,0.2); border-radius: 10px; padding: 20px; margin-bottom: 25px;">
            <h3 style="color: #f5c842; margin-top: 0; font-size: 16px;">Application Summary</h3>
            <p style="color: #94a3b8; line-height: 1.8; margin: 0;">
              <strong style="color: #f8fafc;">Applicant:</strong> ${d.childFirstName} ${d.childLastName}<br/>
              <strong style="color: #f8fafc;">Sport(s):</strong> ${d.sports || "N/A"}<br/>
              <strong style="color: #f8fafc;">Date Submitted:</strong> ${date}
            </p>
          </div>

          <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 20px; text-align: center;">
            <p style="color: #94a3b8; font-size: 13px; line-height: 1.6;">
              <strong style="color: #f5c842;">Holden Foundation for Kids Sports</strong><br/>
              Peachtree Corners, GA<br/>
              EIN: 88-2344143
            </p>
          </div>
        </div>
      `,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Scholarship submission error:", err);
    res.status(500).json({ error: "Failed to submit application. Please try again." });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
