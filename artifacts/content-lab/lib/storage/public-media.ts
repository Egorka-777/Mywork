/**
 * Resolves a path under the Next.js `public/` folder to an absolute public URL
 * (needed for Threads image_url and for SeedDream references).
 */
export function publicFileUrl(
  publicPath: string,
  baseUrl: string = process.env.NEXT_PUBLIC_APP_URL ?? "",
) {
  const p = publicPath.startsWith("/") ? publicPath : `/${publicPath}`;
  if (!baseUrl) {
    return p;
  }
  return baseUrl.replace(/\/$/, "") + p;
}

export function isPublicHttpsUrl(s: string) {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
