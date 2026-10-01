const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function clean(value, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}

const ALLOWED_EVENTS = new Set([
  "landing",
  "starter_pass_view",
  "welcome_pass_checkout_click",
  "membership_checkout_click",
  "eversports_click"
]);

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

export async function onRequestPost({ request, env }) {
  try {
    if (!env.ANALYTICS_DB) {
      return json({ ok: false, error: "analytics_not_configured" }, 503);
    }

    const origin = request.headers.get("origin");
    const allowedOrigins = new Set([
      "https://elitedancestudio.de",
      "https://www.elitedancestudio.de"
    ]);
    if (origin && !allowedOrigins.has(origin)) {
      return json({ ok: false, error: "origin_not_allowed" }, 403);
    }

    const data = await request.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return json({ ok: false, error: "invalid_payload" }, 400);
    }

    const eventType = clean(data.eventType, 60);
    const campaign = clean(data.campaign, 120);
    if (!ALLOWED_EVENTS.has(eventType) || !campaign) {
      return json({ ok: false, error: "invalid_event" }, 400);
    }

    const creative = clean(data.creative, 120);
    const source = clean(data.source, 80);
    const medium = clean(data.medium, 80);
    const page = clean(data.page, 300);
    const product = clean(data.product, 80);

    await ensureSchema(env.ANALYTICS_DB);
    await env.ANALYTICS_DB
      .prepare(`
        INSERT INTO marketing_events
          (event_type, campaign, creative, source, medium, page, product)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(eventType, campaign, creative, source, medium, page, product)
      .run();

    return json({ ok: true }, 201);
  } catch (error) {
    console.error("Marketing tracking failed", error instanceof Error ? error.message : "unknown_error");
    return json({ ok: false, error: "tracking_failed" }, 500);
  }
}
