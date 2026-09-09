export function previewUrl(env: Env, slug: string): string {
  const gateway = env.GATEWAY_ORIGIN?.replace(/\/+$/, "");
  if (gateway) {
    const host = new URL(gateway).hostname;
    if (host.endsWith(".workers.dev") || host === "localhost" || host === "127.0.0.1") {
      return `${gateway}/${encodeURIComponent(slug)}/`;
    }
  }
  return `https://${slug}.${env.APP_DOMAIN}/`;
}
