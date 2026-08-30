const rawMediaBaseUrl = import.meta.env.PUBLIC_MEDIA_BASE_URL?.trim() ?? "";

// Keep the working R2 public origin as the temporary default until
// media.elitedancestudio.de is connected to the bucket in Cloudflare.
const r2PublicMediaBaseUrl = "https://pub-78965290644946caade1e59ed21bf9ce.r2.dev";

export const mediaBaseUrl = rawMediaBaseUrl.replace(/\/+$/, "");
export const cloudMediaBaseUrl = mediaBaseUrl || r2PublicMediaBaseUrl;

export function mediaUrl(path: string): string {
  if (!path || /^https?:\/\//i.test(path) || !mediaBaseUrl) return path;

  const normalizedPath = path
    .replace(/^\/+/, "")
    .replace(/^media\//, "");

  return `${mediaBaseUrl}/${normalizedPath}`;
}

export function cloudMediaUrl(path: string): string {
  if (!path || /^https?:\/\//i.test(path)) return path;

  const normalizedPath = path
    .replace(/^\/+/, "")
    .replace(/^media\//, "");

  return `${cloudMediaBaseUrl}/${normalizedPath}`;
}
