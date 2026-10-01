import {
  DASHBOARD_EMAIL,
  createDashboardSession,
  ensureAuthSchema,
  hashLoginCode,
  requestIsSameSite,
  sessionCookie,
  timingSafeEqual
} from "../_lib/dashboard-auth.js";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...HEADERS, ...extraHeaders }
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!requestIsSameSite(request)) {
      return json({ ok: false, error: "origin_not_allowed" }, 403);
    }

    if (!env.ANALYTICS_DB || !env.DASHBOARD_AUTH_SECRET) {
      return json({ ok: false, error: "dashboard_auth_not_configured" }, 503);
    }

    const payload = await request.json().catch(() => ({}));
    const code = String(payload.code || "").trim();
    const email = DASHBOARD_EMAIL;

    if (!/^\d{6}$/.test(code)) {
      return json({ ok: false, error: "invalid_code" }, 401);
    }

    const db = env.ANALYTICS_DB;
    const now = Math.floor(Date.now() / 1000);
    await ensureAuthSchema(db);

    const record = await db
      .prepare(`
        SELECT id, code_hash, attempts
        FROM dashboard_login_codes
        WHERE email = ? AND used_at IS NULL AND expires_at >= ?
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .bind(email, now)
      .first();

    if (!record || Number(record.attempts || 0) >= 5) {
      return json({ ok: false, error: "invalid_code" }, 401);
    }

    await db
      .prepare("UPDATE dashboard_login_codes SET attempts = attempts + 1 WHERE id = ?")
      .bind(record.id)
      .run();

    const suppliedHash = await hashLoginCode(email, code, env);
    if (!timingSafeEqual(record.code_hash, suppliedHash)) {
      return json({ ok: false, error: "invalid_code" }, 401);
    }

    await db
      .prepare("UPDATE dashboard_login_codes SET used_at = ? WHERE id = ?")
      .bind(now, record.id)
      .run();

    const sessionToken = await createDashboardSession(email, env);
    return json(
      { ok: true },
      200,
      { "set-cookie": sessionCookie(sessionToken) }
    );
  } catch (error) {
    console.error("Dashboard code verification failed", error instanceof Error ? error.message : "unknown_error");
    return json({ ok: false, error: "verification_failed" }, 500);
  }
}
