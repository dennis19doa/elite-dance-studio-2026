const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const STYLES = new Map([["breaking", "Breaking"], ["hip-hop", "Hip-Hop"], ["house", "House"], ["bachata", "Bachata"]]);
const BOOKING_METHODS = new Map([["eversports", "Eversports (online presale)"], ["usc", "Urban Sports Club"]]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function clean(value, max = 200) {
  return String(value ?? "").trim().replace(/[\r\n\t]+/g, " ").slice(0, max);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function zohoAccessToken(env) {
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
  if (!response.ok || !data.access_token) throw new Error("zoho_token_refresh_failed");
  return data.access_token;
}

export async function onRequestPost({ request, env }) {
  try {
    const requiredEnv = ["ZOHO_REFRESH_TOKEN", "ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_ACCOUNT_ID", "ZOHO_FROM_EMAIL"];
    if (requiredEnv.some((key) => !env[key])) return json({ ok: false, error: "configuration_error" }, 503);
    if (Number(request.headers.get("content-length") || 0) > 8192) {
      return json({ ok: false, error: "payload_too_large" }, 413);
    }

    const form = await request.formData();
    // Honeypot: silently discard bots.
    if (clean(form.get("_gotcha"))) return json({ ok: true });

    const name = clean(form.get("name"), 160);
    const email = clean(form.get("email"), 254);
    const phone = clean(form.get("phone"), 80);
    const style = clean(form.get("style"), 30);
    const bookingMethod = clean(form.get("booking_method"), 30);
    const consent = clean(form.get("privacy_consent"), 30);
    const formKind = clean(form.get("form_kind"), 20);

    if (
      formKind !== "battle" ||
      !name ||
      !validEmail(email) ||
      !STYLES.has(style) ||
      !BOOKING_METHODS.has(bookingMethod) ||
      consent !== "accepted"
    ) {
      return json({ ok: false, error: "invalid_submission" }, 400);
    }

    const accessToken = await zohoAccessToken(env);
    const content = [
      "ELITE DANCE BATTLE 2026 – VORANMELDUNG",
      "",
      "Event: Samstag, 05.12.2026",
      "Studio: Wiclefstraße 16–17, 10551 Berlin",
      "Kategorie: " + STYLES.get(style),
      "Geplanter Buchungsweg: " + BOOKING_METHODS.get(bookingMethod),
      "",
      "Name: " + name,
      "E-Mail: " + email,
      "Telefon: " + (phone || "–"),
      "",
      "Status: Voranmeldung – noch KEINE bestätigte Buchung oder Zahlung.",
      "Datenschutz-Einwilligung: akzeptiert",
      "Quelle: elitedancestudio.de/battle/",
      "Eingang (UTC): " + new Date().toISOString(),
    ].join("\n");

    const response = await fetch(
      "https://mail.zoho.eu/api/accounts/" + encodeURIComponent(env.ZOHO_ACCOUNT_ID) + "/messages",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: "Zoho-oauthtoken " + accessToken,
        },
        body: JSON.stringify({
          fromAddress: env.ZOHO_FROM_EMAIL,
          toAddress: env.ZOHO_FROM_EMAIL,
          subject: "Elite Battle 2026 – " + STYLES.get(style) + " – " + name,
          content,
          mailFormat: "plaintext",
          encoding: "UTF-8",
        }),
      }
    );

    const responseData = await response.json().catch(() => ({}));
    const zohoCode = Number(responseData?.status?.code ?? response.status);
    if (!response.ok || zohoCode >= 400) throw new Error("zoho_send_failed");

    return json({ ok: true, status: "preregistration_received" });
  } catch (error) {
    console.error("Battle preregistration failed", error instanceof Error ? error.message : "unknown_error");
    return json({ ok: false, error: "send_failed" }, 502);
  }
}

export function onRequestGet() {
  return json({ ok: false, error: "method_not_allowed" }, 405);
}
