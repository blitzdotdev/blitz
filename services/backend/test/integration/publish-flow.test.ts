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
    stack.executeSql(`UPDATE games SET expires_at = datetime('now', '-1 minute') WHERE id = '${expiring.body.game_id}'`);
    expect((await stack.scheduled()).status).toBe(200);
    expect((await fetch(expiring.body.preview_url)).status).toBe(410);

    stack.executeSql(`UPDATE games SET updated_at = datetime('now', '-2 minutes') WHERE id = '${expiring.body.game_id}'`);
    expect((await stack.scheduled()).status).toBe(200);
    expect((await fetch(expiring.body.preview_url)).status).toBe(404);
  });

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
