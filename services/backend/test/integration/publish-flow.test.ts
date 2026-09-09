import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startLocalStack, type LocalStack } from "./_helpers.js";

interface CreatedGame {
  game_id: string;
  slug: string;
  preview_url: string;
  deploy_token: string;
  claim_secret: string;
  expires_at: string;
}

const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

let stack: LocalStack;
let created: CreatedGame;
const indexBytes = new TextEncoder().encode("<!doctype html><title>Blitz integration</title><h1>hello</h1>");
const binaryBytes = Uint8Array.from([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
const indexHash = sha256(indexBytes);
const binaryHash = sha256(binaryBytes);
let firstReleaseHash: string;
const runtimeUploadToken = "integration-runtime-upload-token-with-at-least-32-bytes";
const runtimeBytes = new TextEncoder().encode("export const runtimeSmoke = true;\n");
const runtimeHash = sha256(runtimeBytes);

async function createGame(slug: string, ip: string): Promise<{ response: Response; body: CreatedGame }> {
  const response = await fetch(`${stack.backendUrl}/api/v1/new-game/${slug}`, {
    method: "POST",
    headers: { "cf-connecting-ip": ip },
  });
  const body = await response.json() as CreatedGame;
  return { response, body };
}

function gameHeaders(token: string, extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

beforeAll(async () => {
  stack = await startLocalStack();
}, 180_000);

afterAll(async () => {
  await stack?.cleanup();
});

describe("local backend and gateway publish flow", () => {
  it("creates an anonymous game with bound secrets", async () => {
    const result = await createGame(`flow-${Date.now().toString(36)}`, "198.51.100.11");
    expect(result.response.status).toBe(201);
    created = result.body;
    expect(created.deploy_token).toMatch(/^tp_/);
    expect(created.claim_secret.length).toBeGreaterThan(30);
    expect(created.preview_url).toBe(`${stack.gatewayUrl}/${created.slug}/`);

    const publishing = await fetch(created.preview_url);
    expect(publishing.status).toBe(503);
    expect(publishing.headers.get("retry-after")).toBe("2");
    expect(publishing.headers.get("cache-control")).toBe("no-store");
    expect(publishing.headers.get("x-blitz-state")).toBe("publishing");
    expect(publishing.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await publishing.text()).toContain("Publishing your game");
    expect((await fetch(`${stack.gatewayUrl}/unknown-${Date.now().toString(36)}/`)).status).toBe(404);
  });

  it("checks invalid, reserved, taken, and available slugs", async () => {
    const headers = { "cf-connecting-ip": "198.51.100.21" };
    const invalid = await fetch(`${stack.backendUrl}/api/v1/slugs/Uppercase`, { headers });
    expect(invalid.status).toBe(200);
    expect(await invalid.json()).toEqual({ slug: "Uppercase", available: false, reason: "invalid_slug" });

    const reserved = await fetch(`${stack.backendUrl}/api/v1/slugs/api`, { headers });
    expect(await reserved.json()).toEqual({ slug: "api", available: false, reason: "reserved_slug" });

    const taken = await fetch(`${stack.backendUrl}/api/v1/slugs/${created.slug}`, { headers });
    expect(await taken.json()).toEqual({ slug: created.slug, available: false, reason: "slug_taken" });

    const freeSlug = `free-${Date.now().toString(36)}`;
    const free = await fetch(`${stack.backendUrl}/api/v1/slugs/${freeSlug}`, { headers });
    expect(await free.json()).toEqual({ slug: freeSlug, available: true });
  });

  it("registers, gets, and lists runtimes with admin Bearer auth", async () => {
    const url = `${stack.backendUrl}/api/v1/runtimes/integration-runtime`;
    const unauthenticated = await fetch(url, { method: "PUT", body: runtimeBytes });
    expect(unauthenticated.status).toBe(401);

    const wrong = await fetch(url, {
      method: "PUT",
      headers: { Authorization: "Bearer wrong-runtime-token" },
      body: runtimeBytes,
    });
    expect(wrong.status).toBe(401);

    const uploaded = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${runtimeUploadToken}` },
      body: runtimeBytes,
    });
    expect(uploaded.status, await uploaded.clone().text()).toBe(201);
    expect(await uploaded.json()).toEqual({
      version: "integration-runtime",
      sha256: runtimeHash,
      size: runtimeBytes.length,
    });

    const get = await fetch(url);
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({
      version: "integration-runtime",
      sha256: runtimeHash,
      size: runtimeBytes.length,
    });
    const list = await fetch(`${stack.backendUrl}/api/v1/runtimes`);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({
      runtimes: [{ version: "integration-runtime", sha256: runtimeHash, size: runtimeBytes.length }],
    });
  });

  it("rejects an unregistered runtime hash when strict runtime checks are enabled", async () => {
    const result = await createGame(`runtime-check-${Date.now().toString(36)}`, "198.51.100.22");
    expect(result.response.status).toBe(201);
    const bytes = new TextEncoder().encode("export const unregistered = true;\n");
    const hash = sha256(bytes);
    const upload = await fetch(`${stack.backendUrl}/api/v1/games/${result.body.game_id}/blobs/${hash}`, {
      method: "PUT",
      headers: gameHeaders(result.body.deploy_token),
      body: bytes,
    });
    expect(upload.status).toBe(201);
    const publish = await fetch(`${stack.backendUrl}/api/v1/games/${result.body.game_id}/releases`, {
      method: "PUT",
      headers: gameHeaders(result.body.deploy_token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ files: { "_blitz/runtime.js": { sha256: hash, size: bytes.length } } }),
    });
    expect(publish.status).toBe(409);
    expect((await publish.json() as { error: { code: string } }).error.code).toBe("unregistered_runtime");
    expect((await fetch(`${stack.backendUrl}/api/v1/games/${result.body.game_id}`, {
      method: "DELETE",
      headers: gameHeaders(result.body.deploy_token),
    })).status).toBe(200);
  });

  it("finds and uploads two missing blobs", async () => {
    const missingResponse = await fetch(`${stack.backendUrl}/api/v1/games/${created.game_id}/blobs/missing`, {
      method: "POST",
      headers: gameHeaders(created.deploy_token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ hashes: [indexHash, binaryHash] }),
    });
    expect(missingResponse.status).toBe(200);
    expect(await missingResponse.json()).toEqual({ missing: [indexHash, binaryHash] });

    const wrongHash = "0".repeat(64);
    const mismatch = await fetch(`${stack.backendUrl}/api/v1/games/${created.game_id}/blobs/${wrongHash}`, {
      method: "PUT",
      headers: gameHeaders(created.deploy_token, { "Content-Type": "application/octet-stream" }),
      body: indexBytes,
    });
    expect(mismatch.status, await mismatch.clone().text()).toBe(422);
    expect((await fetch(`${stack.backendUrl}/api/v1/games/${created.game_id}/blobs/${wrongHash}`, {
      method: "HEAD",
      headers: gameHeaders(created.deploy_token),
    })).status).toBe(404);

    for (const [hash, bytes] of [[indexHash, indexBytes], [binaryHash, binaryBytes]] as const) {
      const response = await fetch(`${stack.backendUrl}/api/v1/games/${created.game_id}/blobs/${hash}`, {
        method: "PUT",
        headers: gameHeaders(created.deploy_token, { "Content-Type": "application/octet-stream" }),
        body: bytes,
      });
      expect(response.status, await response.clone().text()).toBe(201);
    }

    const head = await fetch(`${stack.backendUrl}/api/v1/games/${created.game_id}/blobs/${binaryHash}`, {
      method: "HEAD",
      headers: gameHeaders(created.deploy_token),
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(binaryBytes.length));
  });

  it("publishes and serves the first release with ETag, ranges, and MIME", async () => {
    const response = await fetch(`${stack.backendUrl}/api/v1/games/${created.game_id}/releases`, {
      method: "PUT",
      headers: gameHeaders(created.deploy_token, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        files: {
          "index.html": { sha256: indexHash, size: indexBytes.length },
          "models/tiny.glb": { sha256: binaryHash, size: binaryBytes.length },
        },
        message: "first release",
      }),
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const release = await response.json() as { release_hash: string; preview_url: string; files: object };
    firstReleaseHash = release.release_hash;
    expect(release.preview_url).toBe(created.preview_url);
    expect(Object.keys(release.files)).toHaveLength(2);

    const page = await fetch(created.preview_url);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(page.headers.get("etag")).toBe(`"${indexHash}"`);
    expect(await page.text()).toContain("Blitz integration");

    const ranged = await fetch(`${stack.gatewayUrl}/${created.slug}/models/tiny.glb`, {
      headers: { Range: "bytes=0-3" },
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-type")).toBe("model/gltf-binary");
    expect(ranged.headers.get("content-range")).toBe(`bytes 0-3/${binaryBytes.length}`);
    expect(Array.from(new Uint8Array(await ranged.arrayBuffer()))).toEqual(Array.from(binaryBytes.slice(0, 4)));

    const notModified = await fetch(created.preview_url, { headers: { "If-None-Match": `"${indexHash}"` } });
    expect(notModified.status).toBe(304);
  });

  it("removes a path in a second release and restores it by activation", async () => {
    const second = await fetch(`${stack.backendUrl}/api/v1/games/${created.game_id}/releases`, {
      method: "PUT",
      headers: gameHeaders(created.deploy_token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ files: { "index.html": { sha256: indexHash, size: indexBytes.length } }, message: "remove model" }),
    });
    expect(second.status, await second.clone().text()).toBe(201);
    expect((await fetch(`${stack.gatewayUrl}/${created.slug}/models/tiny.glb`)).status).toBe(404);

    const activate = await fetch(`${stack.backendUrl}/api/v1/games/${created.game_id}/releases/${firstReleaseHash}/activate`, {
      method: "POST",
      headers: gameHeaders(created.deploy_token),
    });
    expect(activate.status).toBe(200);
    expect((await fetch(`${stack.gatewayUrl}/${created.slug}/models/tiny.glb`)).status).toBe(200);
  });

  it("authorizes a one-time claim secret and claims with a platform JWT", async () => {
    stack.executeSql(`UPDATE games SET claim_secret_hash = NULL WHERE id = '${created.game_id}'`);
    const authorize = await fetch(`${stack.backendUrl}/api/v1/games/${created.game_id}/authorize-claim-secret`, {
      method: "POST",
      headers: gameHeaders(created.deploy_token),
    });
    expect(authorize.status).toBe(201);
    const authorized = await authorize.json() as { claim_secret: string };

    const duplicate = await fetch(`${stack.backendUrl}/api/v1/games/${created.game_id}/authorize-claim-secret`, {
      method: "POST",
      headers: gameHeaders(created.deploy_token),
    });
    expect(duplicate.status).toBe(409);

    const username = `user${Date.now().toString(36)}`;
    const register = await fetch(`${stack.backendUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${username}@example.com`, username, password: "correct-horse-battery-staple" }),
    });
    expect(register.status, `${await register.clone().text()}\n${stack.logs.slice(-40).join("")}`).toBe(201);
    const account = await register.json() as { token: string };
    expect(account.token).toBeTruthy();

    const claim = await fetch(`${stack.backendUrl}/api/v1/games/${created.slug}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${account.token}` },
      body: JSON.stringify({ secret: authorized.claim_secret }),
    });
    expect(claim.status).toBe(200);

    const detail = await fetch(`${stack.backendUrl}/api/v1/games/${created.game_id}`, {
      headers: { Authorization: `Bearer ${account.token}` },
    });
    expect(detail.status).toBe(200);
    expect((await detail.json() as { game: { expires_at: string | null } }).game.expires_at).toBeNull();

    const mint = await fetch(`${stack.backendUrl}/api/v1/games/${created.game_id}/tokens`, {
      method: "POST",
      headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "integration-agent" }),
    });
    expect(mint.status).toBe(201);
    const minted = await mint.json() as { token: { id: string; raw_token: string } };
    expect(minted.token.raw_token).toMatch(/^tp_/);
    expect((await fetch(`${stack.backendUrl}/api/v1/games/${created.game_id}`, {
      headers: gameHeaders(minted.token.raw_token),
    })).status).toBe(200);

    const revoke = await fetch(`${stack.backendUrl}/api/v1/games/${created.game_id}/tokens/${minted.token.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${account.token}` },
    });
    expect(revoke.status).toBe(200);
    expect((await fetch(`${stack.backendUrl}/api/v1/games/${created.game_id}`, {
      headers: gameHeaders(minted.token.raw_token),
    })).status).toBe(401);

    const remove = await fetch(`${stack.backendUrl}/api/v1/games/${created.game_id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${account.token}` },
    });
    expect(remove.status).toBe(200);
    expect(await remove.json()).toMatchObject({ deleted: true, game_id: created.game_id });
    expect((await fetch(created.preview_url)).status).toBe(404);
  });

  it("marks an expired game 410, then cleanup makes it 404", async () => {
    const expiring = await createGame(`expiry-${Date.now().toString(36)}`, "198.51.100.12");
    expect(expiring.response.status).toBe(201);
    const bytes = new TextEncoder().encode(`expiring-release-${Date.now()}`);
    const hash = sha256(bytes);
    expect((await fetch(`${stack.backendUrl}/api/v1/games/${expiring.body.game_id}/blobs/${hash}`, {
      method: "PUT",
      headers: gameHeaders(expiring.body.deploy_token),
      body: bytes,
    })).status).toBe(201);
    expect((await fetch(`${stack.backendUrl}/api/v1/games/${expiring.body.game_id}/releases`, {
      method: "PUT",
      headers: gameHeaders(expiring.body.deploy_token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ files: { "index.html": { sha256: hash, size: bytes.length } } }),
    })).status).toBe(201);
    stack.executeSql(`UPDATE games SET expires_at = datetime('now', '-1 minute') WHERE id = '${expiring.body.game_id}'`);
    expect((await stack.scheduled()).status).toBe(200);
    expect((await fetch(expiring.body.preview_url)).status).toBe(410);

    stack.executeSql(`UPDATE games SET updated_at = datetime('now', '-2 minutes') WHERE id = '${expiring.body.game_id}'`);
    expect((await stack.scheduled()).status).toBe(200);
    expect((await fetch(expiring.body.preview_url)).status).toBe(404);
    expect((await stack.scheduled("*/10 * * * *")).status).toBe(200);
    expect(stack.r2BlobExists(hash)).toBe(false);
  });

  it("sweeps unreferenced blobs, preserves references and runtimes, prunes retention, and reconciles R2", async () => {
    const gc = await createGame(`gc-${Date.now().toString(36)}`, "198.51.100.31");
    expect(gc.response.status).toBe(201);
    const unreferencedBytes = new TextEncoder().encode(`unreferenced-${Date.now()}`);
    const unreferencedHash = sha256(unreferencedBytes);
    const uploadUnreferenced = await fetch(`${stack.backendUrl}/api/v1/games/${gc.body.game_id}/blobs/${unreferencedHash}`, {
      method: "PUT",
      headers: gameHeaders(gc.body.deploy_token),
      body: unreferencedBytes,
    });
    expect(uploadUnreferenced.status).toBe(201);
    expect(stack.r2BlobExists(unreferencedHash)).toBe(true);
    expect((await stack.scheduled("*/10 * * * *")).status).toBe(200);
    expect(stack.r2BlobExists(unreferencedHash)).toBe(false);

    const referencedBytes = new TextEncoder().encode(`referenced-${Date.now()}`);
    const referencedHash = sha256(referencedBytes);
    expect((await fetch(`${stack.backendUrl}/api/v1/games/${gc.body.game_id}/blobs/${referencedHash}`, {
      method: "PUT",
      headers: gameHeaders(gc.body.deploy_token),
      body: referencedBytes,
    })).status).toBe(201);
    const publishReferenced = await fetch(`${stack.backendUrl}/api/v1/games/${gc.body.game_id}/releases`, {
      method: "PUT",
      headers: gameHeaders(gc.body.deploy_token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ files: {
        "index.html": { sha256: referencedHash, size: referencedBytes.length },
        "copy.html": { sha256: referencedHash, size: referencedBytes.length },
      } }),
    });
    expect(publishReferenced.status, await publishReferenced.clone().text()).toBe(201);
    expect((await stack.scheduled("*/10 * * * *")).status).toBe(200);
    expect(stack.r2BlobExists(referencedHash)).toBe(true);
    expect((await fetch(`${stack.backendUrl}/api/v1/games/${gc.body.game_id}`, {
      method: "DELETE",
      headers: gameHeaders(gc.body.deploy_token),
    })).status).toBe(200);
    expect((await stack.scheduled("*/10 * * * *")).status).toBe(200);
    expect(stack.r2BlobExists(referencedHash)).toBe(false);

    const retention = await createGame(`retention-${Date.now().toString(36)}`, "198.51.100.32");
    expect(retention.response.status).toBe(201);
    const releaseHashes: string[] = [];
    for (let index = 0; index < 11; index += 1) {
      const bytes = new TextEncoder().encode(`retained-release-${index}-${Date.now()}`);
      const hash = sha256(bytes);
      releaseHashes.push(hash);
      expect((await fetch(`${stack.backendUrl}/api/v1/games/${retention.body.game_id}/blobs/${hash}`, {
        method: "PUT",
        headers: gameHeaders(retention.body.deploy_token),
        body: bytes,
      })).status).toBe(201);
      const published = await fetch(`${stack.backendUrl}/api/v1/games/${retention.body.game_id}/releases`, {
        method: "PUT",
        headers: gameHeaders(retention.body.deploy_token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ files: { "index.html": { sha256: hash, size: bytes.length } }, message: `release ${index}` }),
      });
      expect(published.status, await published.clone().text()).toBe(201);
    }
    const releaseList = await fetch(`${stack.backendUrl}/api/v1/games/${retention.body.game_id}/releases`, {
      headers: gameHeaders(retention.body.deploy_token),
    });
    expect((await releaseList.json() as { releases: unknown[] }).releases).toHaveLength(10);
    expect((await stack.scheduled("*/10 * * * *")).status).toBe(200);
    expect(stack.r2BlobExists(releaseHashes[0])).toBe(false);
    expect(stack.r2BlobExists(releaseHashes[10])).toBe(true);

    stack.executeSql(`UPDATE blobs SET ref_count = 0 WHERE sha256 = '${releaseHashes[10]}'`);
    expect((await stack.scheduled("0 0 * * *")).status).toBe(200);
    expect((await stack.scheduled("*/10 * * * *")).status).toBe(200);
    expect(stack.r2BlobExists(releaseHashes[10])).toBe(true);

    const orphanBytes = new TextEncoder().encode(`reconcile-orphan-${Date.now()}`);
    const orphanHash = sha256(orphanBytes);
    stack.putR2Blob(orphanHash, orphanBytes);
    expect(stack.r2BlobExists(orphanHash)).toBe(true);
    expect((await stack.scheduled("*/10 * * * *")).status).toBe(200);
    expect(stack.r2BlobExists(orphanHash)).toBe(true);
    expect((await stack.scheduled("0 0 * * *")).status).toBe(200);
    expect((await stack.scheduled("*/10 * * * *")).status).toBe(200);
    expect(stack.r2BlobExists(orphanHash)).toBe(false);

    expect(stack.r2BlobExists(runtimeHash)).toBe(true);
    expect((await stack.scheduled("*/10 * * * *")).status).toBe(200);
    expect(stack.r2BlobExists(runtimeHash)).toBe(true);
  }, 120_000);

  it("rate-limits the eleventh create from one IP", async () => {
    const ip = "198.51.100.99";
    const prefix = Date.now().toString(36);
    for (let index = 0; index < 10; index += 1) {
      const response = await fetch(`${stack.backendUrl}/api/v1/new-game/rate-${prefix}-${index}`, {
        method: "POST",
        headers: { "cf-connecting-ip": ip },
      });
      expect(response.status).toBe(201);
    }
    const limited = await fetch(`${stack.backendUrl}/api/v1/new-game/rate-${prefix}-10`, {
      method: "POST",
      headers: { "cf-connecting-ip": ip },
    });
    expect(limited.status).toBe(429);
    expect((await limited.json() as { error: { code: string } }).error.code).toBe("rate_limited");
  });
});
