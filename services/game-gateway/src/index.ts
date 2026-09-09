import { expiredPage, notFoundPage, provisioningPage } from "./errors.js";
import { mimeForPath } from "./mime.js";
import { mapRequestPath, resolveGatewayTarget } from "./path.js";
import { parseRangeHeader } from "./range.js";

interface GameRecord {
  id: string;
  state: "creating" | "open" | "cleaning";
  expires_at: string | null;
  active_release: string | null;
}

interface ManifestFile {
  sha256: string;
  size: number;
  mime?: string;
}

interface ReleaseManifest {
  files: Record<string, ManifestFile>;
}

const manifestCache = new Map<string, ReleaseManifest>();
const MAX_MANIFEST_CACHE_ENTRIES = 128;

function cacheManifest(hash: string, manifest: ReleaseManifest): void {
  if (manifestCache.size >= MAX_MANIFEST_CACHE_ENTRIES) {
    const oldest = manifestCache.keys().next().value;
    if (typeof oldest === "string") manifestCache.delete(oldest);
  }
  manifestCache.set(hash, manifest);
}

async function loadManifest(env: Env, gameId: string, releaseHash: string): Promise<ReleaseManifest | null> {
  const cached = manifestCache.get(releaseHash);
  if (cached) return cached;
  const row = await env.DB.prepare(
    "SELECT manifest_json FROM releases WHERE game_id = ? AND release_hash = ? LIMIT 1",
  ).bind(gameId, releaseHash).first<{ manifest_json: string }>();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.manifest_json) as ReleaseManifest;
    if (!parsed.files || typeof parsed.files !== "object") return null;
    cacheManifest(releaseHash, parsed);
    return parsed;
  } catch {
    return null;
  }
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const url = new URL(request.url);
  const target = resolveGatewayTarget(url, env.APP_DOMAIN);
  if (!target) return notFoundPage();
  const path = mapRequestPath(target.requestPath);
  if (!path) return new Response("Invalid path", { status: 400 });

  const game = await env.DB.prepare(
    "SELECT id, state, expires_at, active_release FROM games WHERE slug = ? LIMIT 1",
  ).bind(target.slug).first<GameRecord>();
  if (!game) return notFoundPage();
  if (game.state === "cleaning") return expiredPage();
  if (game.expires_at && game.expires_at <= new Date().toISOString().slice(0, 19).replace("T", " ")) return expiredPage();
  if (game.state === "creating") return provisioningPage();
  if (!game.active_release) return notFoundPage();

  const manifest = await loadManifest(env, game.id, game.active_release);
  const file = manifest?.files[path];
  if (!file) return notFoundPage();

  const etag = `"${file.sha256}"`;
  if (request.headers.get("if-none-match")?.split(",").map((value) => value.trim()).includes(etag)) {
    return new Response(null, {
      status: 304,
      headers: responseHeaders(path, file, etag),
      encodeBody: "manual",
    });
  }

  const rangeHeader = request.headers.get("range");
  const range = rangeHeader ? parseRangeHeader(rangeHeader, file.size) : null;
  if (rangeHeader && !range) {
    const headers = responseHeaders(path, file, etag);
    headers.set("Content-Range", `bytes */${file.size}`);
    return new Response(null, { status: 416, headers });
  }

  const object = await env.BLOBS.get(
    `blobs/${file.sha256}`,
    range ? { range: { offset: range.offset, length: range.length } } : undefined,
  );
  if (!object) return notFoundPage();

  const headers = responseHeaders(path, file, etag);
  if (range) {
    headers.set("Content-Range", `bytes ${range.offset}-${range.end}/${file.size}`);
    headers.set("Content-Length", String(range.length));
  } else {
    headers.set("Content-Length", String(file.size));
  }
  return new Response(request.method === "HEAD" ? null : object.body, {
    status: range ? 206 : 200,
    headers,
    // Preserve byte-for-byte bodies and strong content-addressed ETags.
    encodeBody: "manual",
  });
}

function responseHeaders(path: string, file: ManifestFile, etag: string): Headers {
  return new Headers({
    "Content-Type": mimeForPath(path, file.mime),
    "Content-Encoding": "identity",
    "ETag": etag,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=60, must-revalidate",
    "X-Content-Type-Options": "nosniff",
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error(JSON.stringify({
        event: "gateway_error",
        path: new URL(request.url).pathname,
        message: error instanceof Error ? error.message : String(error),
      }));
      return new Response("Internal Server Error", { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
