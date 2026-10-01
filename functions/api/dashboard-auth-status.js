import { getDashboardSession } from "../_lib/dashboard-auth.js";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

export async function onRequestGet({ request, env }) {
  try {
    const session = await getDashboardSession(request, env);
    if (!session) return json({ ok: false, authenticated: false }, 401);

    return json({
      ok: true,
      authenticated: true,
      email: session.email,
      expiresAt: session.expiresAt
    });
  } catch (error) {
    console.error("Dashboard auth status failed", error instanceof Error ? error.message : "unknown_error");
    return json({ ok: false, authenticated: false }, 500);
  }
}
