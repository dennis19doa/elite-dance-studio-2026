const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function clean(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function getAccessToken(env) {
  const body = new URLSearchParams({
    refresh_token: env.ZOHO_REFRESH_TOKEN,
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    grant_type: "refresh_token",
  });

  const response = await fetch("https://accounts.zoho.eu/oauth/v2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    console.error("Zoho token refresh failed", response.status, data.error || "unknown_error");
    throw new Error("zoho_token_refresh_failed");
  }

  return data.access_token;
}

function buildMessage(fields) {
  const lines = [
    fields.formKind === "welcome" ? "Neue Welcome-Pass-Anfrage" : "Neue Website-Anfrage",
    "",
    `Name: ${fields.name}`,
    `E-Mail: ${fields.email}`,
    `Telefon: ${fields.phone || "–"}`,
  ];

  if (fields.formKind === "welcome") {
    lines.push(
      `Tanzerfahrung: ${fields.experience || "–"}`,
      `Style: ${fields.styleInterest || "–"}`,
      `Kommt allein: ${fields.partnerStatus || "–"}`,
      `Wunschklasse / mögliche Tage: ${fields.availability || "–"}`,
    );
  } else {
    lines.push(
      `Thema: ${fields.topic || "–"}`,
      "",
      "Nachricht:",
      fields.message || "–",
    );
  }

  lines.push("", "Datenschutz-Einwilligung: akzeptiert", "Quelle: elitedancestudio.de");
  return lines.join("\n");
}

export async function onRequestPost({ request, env }) {
  try {
    const requiredEnv = [
      "ZOHO_REFRESH_TOKEN",
      "ZOHO_CLIENT_ID",
      "ZOHO_CLIENT_SECRET",
      "ZOHO_ACCOUNT_ID",
      "ZOHO_FROM_EMAIL",
    ];

    if (requiredEnv.some((key) => !env[key])) {
      console.error("Zoho form configuration is incomplete");
      return json({ ok: false, error: "configuration_error" }, 500);
    }

    const form = await request.formData();

    // Honeypot: bots get a successful-looking response without sending mail.
    if (clean(form.get("_gotcha"), 200)) {
      return json({ ok: true });
    }

    const fields = {
      formKind: clean(form.get("form_kind"), 20),
      name: clean(form.get("name"), 160),
      email: clean(form.get("email"), 254),
      phone: clean(form.get("phone"), 80),
      experience: clean(form.get("experience"), 300),
      styleInterest: clean(form.get("style_interest"), 300),
      partnerStatus: clean(form.get("partner_status"), 300),
      availability: clean(form.get("availability"), 2000),
      topic: clean(form.get("topic"), 300),
      message: clean(form.get("message"), 5000),
      privacyConsent: clean(form.get("privacy_consent"), 40),
    };

    if (!["welcome", "contact"].includes(fields.formKind)) {
      return json({ ok: false, error: "invalid_form" }, 400);
    }

    if (!fields.name || !isEmail(fields.email) || fields.privacyConsent !== "accepted") {
      return json({ ok: false, error: "invalid_submission" }, 400);
    }

    if (fields.formKind === "welcome" && (!fields.experience || !fields.styleInterest)) {
      return json({ ok: false, error: "missing_required_fields" }, 400);
    }

    if (fields.formKind === "contact" && (!fields.topic || !fields.message)) {
      return json({ ok: false, error: "missing_required_fields" }, 400);
    }

    const accessToken = await getAccessToken(env);
    const subject = fields.formKind === "welcome"
      ? `Welcome Pass – ${fields.name}`
      : `Website-Anfrage – ${fields.name} – ${fields.topic}`;

    const mailResponse = await fetch(
      `https://mail.zoho.eu/api/accounts/${encodeURIComponent(env.ZOHO_ACCOUNT_ID)}/messages`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Zoho-oauthtoken ${accessToken}`,
        },
        body: JSON.stringify({
          fromAddress: env.ZOHO_FROM_EMAIL,
          toAddress: env.ZOHO_FROM_EMAIL,
          subject,
          content: buildMessage(fields),
          mailFormat: "plaintext",
          encoding: "UTF-8",
        }),
      },
    );

    const mailData = await mailResponse.json().catch(() => ({}));
    const zohoCode = Number(mailData?.status?.code ?? mailResponse.status);
    if (!mailResponse.ok || zohoCode >= 400) {
      console.error("Zoho send failed", mailResponse.status, zohoCode);
      throw new Error("zoho_send_failed");
    }

    return json({ ok: true });
  } catch (error) {
    console.error("Website form submission failed", error instanceof Error ? error.message : "unknown_error");
    return json({ ok: false, error: "send_failed" }, 502);
  }
}
