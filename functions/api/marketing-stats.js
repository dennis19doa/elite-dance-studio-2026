import { getDashboardSession } from "../_lib/dashboard-auth.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS marketing_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        event_type TEXT NOT NULL,
        campaign TEXT NOT NULL,
        creative TEXT,
        source TEXT,
        medium TEXT,
        page TEXT,
        product TEXT
      )
    `),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_marketing_events_created_at ON marketing_events(created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_marketing_events_campaign ON marketing_events(campaign)")
  ]);
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.ANALYTICS_DB) {
      return json({ ok: false, error: "analytics_not_configured" }, 503);
    }

    const session = await getDashboardSession(request, env);
    if (!session) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const url = new URL(request.url);
    const rawDays = Number.parseInt(url.searchParams.get("days") || "30", 10);
    const days = Number.isFinite(rawDays) ? Math.min(Math.max(rawDays, 1), 365) : 30;
    const since = new Date(Date.now() - (days * 86400000)).toISOString();

    await ensureSchema(env.ANALYTICS_DB);

    const summaryQuery = env.ANALYTICS_DB.prepare(`
      SELECT
        SUM(CASE WHEN event_type = 'landing' THEN 1 ELSE 0 END) AS visits,
        SUM(CASE WHEN event_type = 'starter_pass_view' THEN 1 ELSE 0 END) AS starter_pass_views,
        SUM(CASE WHEN event_type = 'welcome_pass_checkout_click' THEN 1 ELSE 0 END) AS checkout_clicks,
        SUM(CASE WHEN event_type = 'membership_checkout_click' THEN 1 ELSE 0 END) AS membership_clicks
      FROM marketing_events
      WHERE created_at >= ?
    `).bind(since);

    const campaignQuery = env.ANALYTICS_DB.prepare(`
      SELECT
        campaign,
        COALESCE(creative, '') AS creative,
        COALESCE(source, '') AS source,
        SUM(CASE WHEN event_type = 'landing' THEN 1 ELSE 0 END) AS visits,
        SUM(CASE WHEN event_type = 'starter_pass_view' THEN 1 ELSE 0 END) AS starter_pass_views,
        SUM(CASE WHEN event_type = 'welcome_pass_checkout_click' THEN 1 ELSE 0 END) AS checkout_clicks,
        SUM(CASE WHEN event_type = 'membership_checkout_click' THEN 1 ELSE 0 END) AS membership_clicks,
        MIN(created_at) AS first_seen,
        MAX(created_at) AS last_seen
      FROM marketing_events
      WHERE created_at >= ?
      GROUP BY campaign, creative, source
      ORDER BY checkout_clicks DESC, visits DESC
    `).bind(since);

    const dailyQuery = env.ANALYTICS_DB.prepare(`
      SELECT
        substr(created_at, 1, 10) AS date,
        SUM(CASE WHEN event_type = 'landing' THEN 1 ELSE 0 END) AS visits,
        SUM(CASE WHEN event_type = 'welcome_pass_checkout_click' THEN 1 ELSE 0 END) AS checkout_clicks
      FROM marketing_events
      WHERE created_at >= ?
      GROUP BY substr(created_at, 1, 10)
      ORDER BY date ASC
    `).bind(since);

    const [summaryResult, campaignResult, dailyResult] = await env.ANALYTICS_DB.batch([
      summaryQuery,
      campaignQuery,
      dailyQuery
    ]);

    const summary = summaryResult.results?.[0] || {};
    return json({
      ok: true,
      days,
      summary: {
        visits: Number(summary.visits || 0),
        starterPassViews: Number(summary.starter_pass_views || 0),
        checkoutClicks: Number(summary.checkout_clicks || 0),
        membershipClicks: Number(summary.membership_clicks || 0)
      },
      campaigns: (campaignResult.results || []).map((row) => ({
        campaign: row.campaign,
        creative: row.creative,
        source: row.source,
        visits: Number(row.visits || 0),
        starterPassViews: Number(row.starter_pass_views || 0),
        checkoutClicks: Number(row.checkout_clicks || 0),
        membershipClicks: Number(row.membership_clicks || 0),
        firstSeen: row.first_seen,
        lastSeen: row.last_seen
      })),
      daily: (dailyResult.results || []).map((row) => ({
        date: row.date,
        visits: Number(row.visits || 0),
        checkoutClicks: Number(row.checkout_clicks || 0)
      }))
    });
  } catch (error) {
    console.error("Marketing dashboard failed", error instanceof Error ? error.message : "unknown_error");
    return json({ ok: false, error: "dashboard_failed" }, 500);
  }
}
