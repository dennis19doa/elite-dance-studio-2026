import {
  AUTH_LIMITS,
  DASHBOARD_EMAIL,
  cleanupAuth,
  ensureAuthSchema,
  generateLoginCode,
  hashLoginCode,
  requestIsSameSite,
  sendLoginCode
} from "../_lib/dashboard-auth.js";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!requestIsSameSite(request)) {
      return json({ ok: false, error: "origin_not_allowed" }, 403);
    }

    if (!env.ANALYTICS_DB || !env.DASHBOARD_AUTH_SECRET) {
      return json({ ok: false, error: "dashboard_auth_not_configured" }, 503);
    }

    const db = env.ANALYTICS_DB;
    const email = DASHBOARD_EMAIL;
    const now = Math.floor(Date.now() / 1000);

    await ensureAuthSchema(db);
    await cleanupAuth(db, now);

    const recent = await db
      .prepare(`
        SELECT
          MAX(created_at) AS latest,
          COUNT(*) AS request_count
        FROM dashboard_login_codes
        WHERE email = ? AND created_at >= ?
      `)
      .bind(email, now - 3600)
      .first();

    const latest = Number(recent?.latest || 0);
    const requestCount = Number(recent?.request_count || 0);

    if ((latest && now - latest < 60) || requestCount >= 5) {
      return json({ ok: true, throttled: true });
    }

    await db
      .prepare("UPDATE dashboard_login_codes SET used_at = ? WHERE email = ? AND used_at IS NULL")
      .bind(now, email)
      .run();

    const code = generateLoginCode();
    const codeHash = await hashLoginCode(email, code, env);
    await db
      .prepare(`
        INSERT INTO dashboard_login_codes (email, code_hash, created_at, expires_at)
        VALUES (?, ?, ?, ?)
      `)
      .bind(email, codeHash, now, now + AUTH_LIMITS.codeTtlSeconds)
      .run();

    await sendLoginCode(email, code, env);
    return json({ ok: true });
  } catch (error) {
    console.error("Dashboard code request failed", error instanceof Error ? error.message : "unknown_error");
    return json({ ok: false, error: "code_request_failed" }, 500);
  }
}
