import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(projectRoot, "dist");

// The full-resolution source video is intentionally retained in the repository for
// the existing GitHub preview workflow, but it is unused by the website and exceeds
// Cloudflare Pages' 25 MiB per-asset limit. The optimized desktop/mobile files remain.
const cloudflareExcludedAssets = ["media/hero/elite-homepage-video.mp4"];

for (const relativePath of cloudflareExcludedAssets) {
  await rm(path.join(distRoot, relativePath), { force: true });
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const location = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(location) : [location];
    })
  );
  return files.flat();
}

const maxAssetSize = 25 * 1024 * 1024;
const oversizedAssets = [];

for (const file of await walk(distRoot)) {
  const fileStats = await stat(file);
  if (fileStats.size > maxAssetSize) {
    oversizedAssets.push(`${path.relative(distRoot, file)} (${fileStats.size} bytes)`);
  }
}

if (oversizedAssets.length) {
  throw new Error(
    `Cloudflare Pages rejects assets larger than 25 MiB:\n${oversizedAssets.join("\n")}`
  );
}

console.log("Cloudflare Pages asset-size check passed.");
