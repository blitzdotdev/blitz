export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,47}[a-z0-9])$/;
export const SHA256_RE = /^[0-9a-f]{64}$/;

export const RESERVED_SLUGS = new Set([
  "admin", "api", "preview", "fork", "static", "assets", "health", "auth",
  "app", "www", "mail", "blog", "docs", "status", "support", "help",
  "google", "github", "microsoft", "apple", "amazon", "facebook", "meta",
  "twitter", "x", "openai", "anthropic", "claude", "chatgpt", "cursor",
  "vercel", "netlify", "cloudflare", "supabase", "firebase", "stripe",
  "paypal", "slack", "discord", "zoom", "notion", "figma", "linear",
  "replit", "bolt", "lovable", "blitz", "blitzapp", "blitzdev", "teenyapp",
  "teenybase", "teeny", "anon", "anonymous", "public", "private", "system",
  "root", "super", "superadmin", "sudo", "security", "password", "secrets",
  "tokens", "login", "signup", "register", "signin", "signout", "logout",
  "dashboard", "settings", "account", "profile", "billing", "oauth", "sso",
  "verify", "reset", "test", "demo", "example", "sample", "hello",
  "hello-world", "foo", "bar", "baz", "todo", "untitled", "project", "game",
  "dev", "prod", "production", "staging", "local", "localhost", "master",
  "main", "default", "null", "phishing", "malware", "scam", "fake",
  "official-real", "support-real", "login-real",
]);

export function slugError(slug: string): "invalid_slug" | "reserved_slug" | null {
  if (!SLUG_RE.test(slug) || slug.includes("--")) return "invalid_slug";
  if (RESERVED_SLUGS.has(slug)) return "reserved_slug";
  return null;
}

export function isValidManifestPath(path: string): boolean {
  if (!path || path.length > 512 || path.startsWith("/") || path.endsWith("/")) return false;
  if (path.includes("\\") || path.includes("//") || path.includes("\0")) return false;
  const segments = path.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
