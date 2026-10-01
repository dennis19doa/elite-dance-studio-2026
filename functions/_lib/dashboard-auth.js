const COOKIE_NAME = "elite_dashboard_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const CODE_TTL_SECONDS = 10 * 60;
export const DASHBOARD_EMAIL = "info@elitedancestudio.de";

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase().slice(0, 254);
}

export async function ensureAuthSchema(db) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS dashboard_login_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        attempts INTEGER NOT NULL DEFAULT 0
      )
    `),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_dashboard_codes_email ON dashboard_login_codes(email, created_at)"),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS dashboard_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      )
    `),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_dashboard_sessions_token ON dashboard_sessions(token_hash)")
  ]);
}

export async function cleanupAuth(db, now = Math.floor(Date.now() / 1000)) {
  await db.batch([
    db.prepare("DELETE FROM dashboard_login_codes WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)").bind(now, now - 86400),
    db.prepare("DELETE FROM dashboard_sessions WHERE expires_at < ?").bind(now)
  ]);
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function generateLoginCode() {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1000000).padStart(6, "0");
}

export function generateSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function hmacHex(value, secret) {
  if (!secret) throw new Error("dashboard_auth_secret_missing");

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hashLoginCode(email, code, env) {
  return hmacHex(`code:${normalizeEmail(email)}:${code}`, env.DASHBOARD_AUTH_SECRET);
}

export function hashSessionToken(token, env) {
  return hmacHex(`session:${token}`, env.DASHBOARD_AUTH_SECRET);
}

export function timingSafeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export function parseCookies(request) {
  const raw = request.headers.get("cookie") || "";
  return Object.fromEntries(
    raw.split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

export function sessionCookie(token) {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "Path=/api/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict"
  ].join("; ");
}

export function clearSessionCookie() {
  return [
    `${COOKIE_NAME}=`,
    "Max-Age=0",
    "Path=/api/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict"
  ].join("; ");
}

export async function createDashboardSession(email, env) {
  const now = Math.floor(Date.now() / 1000);
  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token, env);

  await ensureAuthSchema(env.ANALYTICS_DB);
  await cleanupAuth(env.ANALYTICS_DB, now);
  await env.ANALYTICS_DB
    .prepare(`
      INSERT INTO dashboard_sessions (email, token_hash, created_at, expires_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(normalizeEmail(email), tokenHash, now, now + SESSION_TTL_SECONDS, now)
    .run();

  return token;
}

export async function getDashboardSession(request, env) {
  if (!env.ANALYTICS_DB || !env.DASHBOARD_AUTH_SECRET) return null;

  const cookies = parseCookies(request);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  const now = Math.floor(Date.now() / 1000);
  const tokenHash = await hashSessionToken(token, env);
  await ensureAuthSchema(env.ANALYTICS_DB);
  await cleanupAuth(env.ANALYTICS_DB, now);

  const session = await env.ANALYTICS_DB
    .prepare(`
      SELECT id, email, expires_at
      FROM dashboard_sessions
      WHERE token_hash = ? AND expires_at >= ?
      LIMIT 1
    `)
    .bind(tokenHash, now)
    .first();

  if (!session) return null;

  await env.ANALYTICS_DB
    .prepare("UPDATE dashboard_sessions SET last_seen_at = ? WHERE id = ?")
    .bind(now, session.id)
    .run();

  return {
    id: session.id,
    email: session.email,
    expiresAt: Number(session.expires_at)
  };
}

export async function deleteDashboardSession(request, env) {
  if (!env.ANALYTICS_DB || !env.DASHBOARD_AUTH_SECRET) return;

  const cookies = parseCookies(request);
  const token = cookies[COOKIE_NAME];
  if (!token) return;

  const tokenHash = await hashSessionToken(token, env);
  await ensureAuthSchema(env.ANALYTICS_DB);
  await env.ANALYTICS_DB
    .prepare("DELETE FROM dashboard_sessions WHERE token_hash = ?")
    .bind(tokenHash)
    .run();
}

export function requestIsSameSite(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === "https://elitedancestudio.de" || origin === "https://www.elitedancestudio.de";
}

async function getZohoAccessToken(env) {
  const body = new URLSearchParams({
    refresh_token: env.ZOHO_REFRESH_TOKEN,
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    grant_type: "refresh_token"
  });

  const response = await fetch("https://accounts.zoho.eu/oauth/v2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error("zoho_token_refresh_failed");
  }
  return data.access_token;
}

export async function sendLoginCode(email, code, env) {
  const required = [
    "ZOHO_REFRESH_TOKEN",
    "ZOHO_CLIENT_ID",
    "ZOHO_CLIENT_SECRET",
    "ZOHO_ACCOUNT_ID",
    "ZOHO_FROM_EMAIL"
  ];
  if (required.some((key) => !env[key])) {
    throw new Error("zoho_not_configured");
  }

  const accessToken = await getZohoAccessToken(env);
  const response = await fetch(
    `https://mail.zoho.eu/api/accounts/${encodeURIComponent(env.ZOHO_ACCOUNT_ID)}/messages`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Zoho-oauthtoken ${accessToken}`
      },
      body: JSON.stringify({
        fromAddress: env.ZOHO_FROM_EMAIL,
        toAddress: normalizeEmail(email),
        subject: "Elite Marketing Dashboard login code",
        content: [
          "Elite Dance Studio – Marketing Dashboard",
          "",
          `Your login code is: ${code}`,
          "",
          "The code expires in 10 minutes.",
          "If you did not request this code, you can ignore this email."
        ].join("\n"),
        mailFormat: "plaintext",
        encoding: "UTF-8"
      })
    }
  );

  const data = await response.json().catch(() => ({}));
  const zohoCode = Number(data?.status?.code ?? response.status);
  if (!response.ok || zohoCode >= 400) {
    throw new Error("zoho_send_failed");
  }
}

export const AUTH_LIMITS = {
  codeTtlSeconds: CODE_TTL_SECONDS,
  sessionTtlSeconds: SESSION_TTL_SECONDS
};
