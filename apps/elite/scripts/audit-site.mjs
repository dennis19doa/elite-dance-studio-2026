import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(projectRoot, "dist");
const errors = [];
const warnings = [];
const pages = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const location = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(location) : [location];
  }));
  return files.flat();
}

function routeFor(file) {
  const relative = path.relative(distRoot, file).split(path.sep).join("/");
  if (relative === "index.html") return "/";
  if (relative.endsWith("/index.html")) return `/${relative.slice(0, -10)}`;
  return `/${relative}`;
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1] ?? null;
}

function hasAttribute(tag, name) {
  return new RegExp(`(?:^|\\s)${name}(?:\\s*=|\\s|/?>)`, "i").test(tag);
}

function textContent(value) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function exists(location) {
  try {
    await stat(location);
    return true;
  } catch {
    return false;
  }
}

async function resolvePublicPath(pathname) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  const direct = path.join(distRoot, clean);
  const candidates = pathname.endsWith("/") || pathname === "/"
    ? [path.join(direct, "index.html")]
    : [direct, `${direct}.html`, path.join(direct, "index.html")];

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

const allFiles = await walk(distRoot);
const htmlFiles = allFiles.filter((file) => file.endsWith(".html"));

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  const route = routeFor(file);
  const robotsTag = html.match(/<meta\s+[^>]*name=["']robots["'][^>]*>/i)?.[0] ?? "";
  const indexed = !/noindex/i.test(attribute(robotsTag, "content") ?? "");
  const titleMatches = [...html.matchAll(/<title>([\s\S]*?)<\/title>/gi)];
  const descriptionTags = [...html.matchAll(/<meta\s+[^>]*name=["']description["'][^>]*>/gi)];
  const canonicalTags = [...html.matchAll(/<link\s+[^>]*rel=["']canonical["'][^>]*>/gi)];
  const h1Matches = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  const title = textContent(titleMatches[0]?.[1] ?? "");
  const description = attribute(descriptionTags[0]?.[0] ?? "", "content") ?? "";

  if (titleMatches.length !== 1 || !title) errors.push(`${route}: expected one non-empty title`);
  if (descriptionTags.length !== 1 || !description) errors.push(`${route}: expected one meta description`);
  if (canonicalTags.length !== 1 || !attribute(canonicalTags[0]?.[0] ?? "", "href")) {
    errors.push(`${route}: expected one canonical URL`);
  }
  if (indexed && h1Matches.length !== 1) errors.push(`${route}: expected one H1, found ${h1Matches.length}`);

  const imageTags = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  for (const image of imageTags) {
    if (!hasAttribute(image, "alt")) errors.push(`${route}: image is missing an alt attribute`);
    const source = attribute(image, "src");
    if (source?.startsWith("/") && !(await resolvePublicPath(source))) {
      errors.push(`${route}: missing image ${source}`);
    }
  }

  const jsonLdBlocks = [...html.matchAll(/<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of jsonLdBlocks) {
    try {
      JSON.parse(block[1]);
    } catch {
      errors.push(`${route}: invalid JSON-LD`);
    }
  }

  if (indexed && /Coach Placeholder|Bildidee|Originalfoto folgt|Prototyp/i.test(html)) {
    warnings.push(`${route}: contains review-stage or placeholder language`);
  }

  pages.push({ file, route, html, indexed, title, description });
}

for (const page of pages) {
  const links = [...page.html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);

  for (const href of links) {
    if (/^(https?:|mailto:|tel:|javascript:)/i.test(href)) continue;
    const [rawPath, fragment] = href.split("#");
    const pathname = rawPath || page.route;
    if (!pathname.startsWith("/")) continue;

    const targetFile = await resolvePublicPath(pathname.split("?")[0]);
    if (!targetFile) {
      errors.push(`${page.route}: broken internal link ${href}`);
      continue;
    }

    if (fragment) {
      const targetHtml = targetFile.endsWith(".html") ? await readFile(targetFile, "utf8") : "";
      const safeFragment = fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`\\bid=["']${safeFragment}["']`).test(targetHtml)) {
        errors.push(`${page.route}: missing link target ${href}`);
      }
    }
  }
}

for (const field of ["title", "description"]) {
  const seen = new Map();
  for (const page of pages.filter((item) => item.indexed)) {
    const value = page[field];
    if (!value) continue;
    const previous = seen.get(value);
    if (previous) warnings.push(`${page.route}: duplicate ${field} also used by ${previous}`);
    else seen.set(value, page.route);
  }
}

console.log(`Audited ${pages.length} HTML pages.`);
warnings.forEach((warning) => console.warn(`WARN ${warning}`));
errors.forEach((error) => console.error(`ERROR ${error}`));

if (errors.length) {
  console.error(`Audit failed with ${errors.length} error(s) and ${warnings.length} warning(s).`);
  process.exitCode = 1;
} else {
  console.log(`Audit passed with ${warnings.length} review warning(s).`);
}
