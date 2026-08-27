const rawMediaBaseUrl = import.meta.env.PUBLIC_MEDIA_BASE_URL?.trim() ?? "";

export const mediaBaseUrl = rawMediaBaseUrl.replace(/\/+$/, "");

export function mediaUrl(path: string): string {
  if (!path || /^https?:\/\//i.test(path) || !mediaBaseUrl) return path;

  const normalizedPath = path
    .replace(/^\/+/, "")
    .replace(/^media\//, "");

  return `${mediaBaseUrl}/${normalizedPath}`;
}
