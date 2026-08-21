import { defineConfig } from "astro/config";

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? "https://elitedancestudio.de",
  base: process.env.GITHUB_PAGES_BASE,
  output: "static",
});
