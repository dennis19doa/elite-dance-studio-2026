const TV_UPSTREAM = "https://dennis19doa.github.io/elite-dance-studio-2026/tv/";

export async function onRequest({ request }) {
  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(TV_UPSTREAM);

  // Keep harmless query parameters such as demo modes while always serving
  // the known-good TV build.
  upstreamUrl.search = incomingUrl.search;

  const upstream = await fetch(upstreamUrl.toString(), {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers: {
      "User-Agent": request.headers.get("User-Agent") || "Elite-Dance-TV",
      "Accept": request.headers.get("Accept") || "text/html,*/*",
    },
    redirect: "follow",
  });

  const headers = new Headers(upstream.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  headers.set("CDN-Cache-Control", "no-store");
  headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  headers.set("X-Elite-TV-Source", "github-pages-live");
  headers.delete("Content-Security-Policy");
  headers.delete("X-Frame-Options");

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
