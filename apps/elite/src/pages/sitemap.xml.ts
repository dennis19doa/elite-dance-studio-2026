import type { APIRoute } from "astro";
import coaches from "../data/coaches.json";

const publicRoutes = [
  "/",
  "/kurse/",
  "/styles/",
  "/preise/",
  "/events/",
  "/coaches/",
  "/intensives/",
  "/fortgeschrittene/",
  "/ueber-uns/",
  "/raummiete/",
  "/kontakt/",
  "/starter-pass/",
  "/stundenplan/",
  "/faq/",
  "/bachata-berlin/",
  "/reggaeton-berlin/"
];

const coachRoutes = coaches.map((coach) => `/coaches/${coach.slug}/`);

export const GET: APIRoute = ({ site }) => {
  const baseUrl = site ?? new URL("https://elitedancestudio.de");
  const urls = [...publicRoutes, ...coachRoutes]
    .map((route) => `  <url><loc>${new URL(route, baseUrl).toString()}</loc></url>`)
    .join("\n");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } }
  );
};
