import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.env.GITHUB_PAGES_BASE ?? "").replace(/^\/+|\/+$/g, "");

if (!base) process.exit(0);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(projectRoot, "dist");
const prefix = `/${base}`;
const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rootPathPattern = new RegExp(`((?:href|src|poster)=["'])/(?!/|#|${escapedBase}(?:/|["']))`, "g");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const location = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(location) : [location];
  }));
  return files.flat();
}

for (const file of await walk(distRoot)) {
  if (!file.endsWith(".html")) continue;

  const html = await readFile(file, "utf8");
  // Components use root-relative links locally. Prefix them only in the Pages build.
  const rewritten = html.replace(rootPathPattern, `$1${prefix}/`);
  await writeFile(file, rewritten);
}
