import {
  clearSessionCookie,
  deleteDashboardSession,
  requestIsSameSite
} from "../_lib/dashboard-auth.js";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

export async function onRequestPost({ request, env }) {
  if (!requestIsSameSite(request)) {
    return new Response(JSON.stringify({ ok: false, error: "origin_not_allowed" }), {
      status: 403,
      headers: HEADERS
    });
  }

  try {
    await deleteDashboardSession(request, env);
  } catch (error) {
    console.error("Dashboard logout failed", error instanceof Error ? error.message : "unknown_error");
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...HEADERS, "set-cookie": clearSessionCookie() }
  });
}
