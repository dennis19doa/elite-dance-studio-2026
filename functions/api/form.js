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
    const err = new Error("zoho_token_refresh_failed");
    err.diagnostic = {
      stage: "token_refresh",
      upstreamStatus: response.status,
      upstreamError: String(data.error || "unknown_error").slice(0, 120),
    };
    throw err;
  }

  return data.access_token;
}

function buildMessage(fields) {
  if (fields.formKind === "feedback") {
    return [
      "First Visit Feedback",
      "",
      `Class: ${fields.className || "–"}`,
      `Teacher: ${fields.teacherName || "–"}`,
      `Before class / friction: ${fields.preVisitFriction.length ? fields.preVisitFriction.join(", ") : "–"}`,
      `Overall first impression: ${fields.overallRating || "–"} / 5`,
      `Class level: ${fields.levelFit || "–"}`,
      `Would return: ${fields.returnIntent || "–"}`,
      `Discovery source: ${fields.discoverySource || "–"}`,
      "",
      "Open feedback:",
      fields.openFeedback || "–",
      "",
      `Source: ${fields.source || "eversports-first-visit"}`,
      "Datenschutz-Einwilligung: akzeptiert",
      "Quelle: elitedancestudio.de/feedback/",
    ].join("\n");
  }

  if (fields.formKind === "advanced") {
    return [
      "Bachata Advanced Anmeldung",
      "",
      `Name: ${fields.name}`,
      `E-Mail: ${fields.email}`,
      `WhatsApp: ${fields.phone}`,
      `Monate: ${fields.months.length ? fields.months.join(", ") : "–"}`,
      "",
      "Trainingswünsche:",
      fields.trainingSubject || "–",
      "",
      "Weitere Nachricht:",
      fields.extraNote || "–",
      "",
      "Datenschutz-Einwilligung: akzeptiert",
      "Quelle: elitedancestudio.de/fortgeschrittene/#bachata-advanced",
    ].join("\n");
  }

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

export function onRequestGet({ env }) {
  const requiredEnv = [
    "ZOHO_REFRESH_TOKEN",
    "ZOHO_CLIENT_ID",
    "ZOHO_CLIENT_SECRET",
    "ZOHO_ACCOUNT_ID",
    "ZOHO_FROM_EMAIL",
  ];
  return json({
    ok: true,
    version: "advanced-form-v4",
    zohoConfigured: requiredEnv.every((key) => Boolean(env[key])),
  });
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

    const missingEnv = requiredEnv.filter((key) => !env[key]);
    if (missingEnv.length) {
      console.error("Zoho form configuration is incomplete. Missing:", missingEnv.join(", "));
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
      months: form.getAll("months").map((value) => clean(value, 80)).filter(Boolean),
      trainingSubject: clean(form.get("training_subject"), 3000),
      extraNote: clean(form.get("extra_note"), 3000),
      className: clean(form.get("class_name"), 300),
      teacherName: clean(form.get("teacher_name"), 300),
      preVisitFriction: form.getAll("pre_visit_friction").map((value) => clean(value, 120)).filter(Boolean),
      overallRating: clean(form.get("overall_rating"), 20),
      levelFit: clean(form.get("level_fit"), 120),
      returnIntent: clean(form.get("return_intent"), 120),
      openFeedback: clean(form.get("open_feedback"), 5000),
      discoverySource: clean(form.get("discovery_source"), 200),
      source: clean(form.get("source"), 300),
      privacyConsent: clean(form.get("privacy_consent"), 40),
    };

    if (!["welcome", "contact", "feedback", "advanced"].includes(fields.formKind)) {
      return json({ ok: false, error: "invalid_form" }, 400);
    }

    if (fields.privacyConsent !== "accepted") {
      return json({ ok: false, error: "invalid_submission" }, 400);
    }

    if (fields.formKind !== "feedback" && (!fields.name || !isEmail(fields.email))) {
      return json({ ok: false, error: "invalid_submission" }, 400);
    }

    if (fields.formKind === "welcome" && (!fields.experience || !fields.styleInterest)) {
      return json({ ok: false, error: "missing_required_fields" }, 400);
    }

    if (fields.formKind === "contact" && (!fields.topic || !fields.message)) {
      return json({ ok: false, error: "missing_required_fields" }, 400);
    }

    if (
      fields.formKind === "advanced" &&
      (!fields.phone || !fields.months.length || !fields.trainingSubject)
    ) {
      return json({ ok: false, error: "missing_required_fields" }, 400);
    }

    if (
      fields.formKind === "feedback" &&
      (
        !fields.className ||
        !fields.teacherName ||
        !fields.preVisitFriction.length ||
        !fields.overallRating ||
        !fields.levelFit ||
        !fields.returnIntent ||
        !fields.discoverySource
      )
    ) {
      return json({ ok: false, error: "missing_required_fields" }, 400);
    }

    const accessToken = await getAccessToken(env);
    const subject = fields.formKind === "welcome"
      ? `Welcome Pass – ${fields.name}`
      : fields.formKind === "feedback"
        ? `First Visit Feedback – ${fields.className} – ${fields.teacherName}`
        : fields.formKind === "advanced"
          ? `Bachata Advanced Anmeldung – ${fields.name}`
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
      const err = new Error("zoho_send_failed");
      err.diagnostic = {
        stage: "mail_send",
        upstreamStatus: mailResponse.status,
        zohoCode,
      };
      throw err;
    }

    return json({ ok: true });
  } catch (error) {
    console.error("Website form submission failed", error instanceof Error ? error.message : "unknown_error");
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "send_failed",
      diagnostic: error && typeof error === "object" && "diagnostic" in error ? error.diagnostic : undefined,
    }, 502);
  }
}
