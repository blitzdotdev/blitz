export interface GatewayTarget {
  slug: string;
  requestPath: string;
}

function pathModeHost(host: string): boolean {
  return host.endsWith(".workers.dev") || host === "localhost" || host === "127.0.0.1";
}

export function resolveGatewayTarget(url: URL, appDomain: string): GatewayTarget | null {
  const host = url.hostname.toLowerCase();
  if (pathModeHost(host)) {
    const pieces = url.pathname.split("/").filter(Boolean);
    if (!pieces[0]) return null;
    let slug: string;
    try { slug = decodeURIComponent(pieces[0]); } catch { return null; }
    const prefixLength = url.pathname.indexOf(pieces[0]) + pieces[0].length;
    const requestPath = url.pathname.slice(prefixLength) || "/";
    return { slug, requestPath: requestPath.startsWith("/") ? requestPath : `/${requestPath}` };
  }

  const suffix = `.${appDomain.toLowerCase()}`;
  if (!host.endsWith(suffix)) return null;
  const slug = host.slice(0, -suffix.length);
  if (!slug || slug.includes(".")) return null;
  return { slug, requestPath: url.pathname };
}

export function mapRequestPath(pathname: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes("\\") || decoded.includes("\0")) return null;
  const withIndex = decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  const relative = withIndex.replace(/^\/+/, "");
  if (!relative) return "index.html";
  const segments = relative.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return relative;
}
