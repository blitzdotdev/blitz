import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startLocalStack, type LocalStack } from "./_helpers.js";

interface CreatedGame {
  game_id: string;
  slug: string;
  preview_url: string;
  deploy_token: string;
  claim_secret: string;
}

interface PublicGame {
  slug: string;
  name: string;
  description: string | null;
  author: string;
  thumbnail_url: string;
  preview_url: string;
  updated_at: string;
}

interface PublicGamesResponse {
  games: PublicGame[];
  next_cursor: string | null;
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const headers = (token: string, json = false): Headers => {
  const result = new Headers({ Authorization: `Bearer ${token}` });
  if (json) result.set("Content-Type", "application/json");
  return result;
};

let stack: LocalStack;
let platformToken: string;
let userId: string;
let username: string;
let anonymous: CreatedGame;
let newestSlug: string;
let olderSlug: string;
const indexBytes = new TextEncoder().encode("<!doctype html><title>Store test</title>");
const indexHash = sha256(indexBytes);

async function publicGames(query = ""): Promise<PublicGamesResponse> {
  const response = await fetch(`${stack.backendUrl}/api/v1/games${query}`);
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json() as Promise<PublicGamesResponse>;
}

beforeAll(async () => {
  stack = await startLocalStack();
  const unique = Date.now().toString(36);
  username = `store${unique}`;
  const register = await fetch(`${stack.backendUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `${username}@example.com`,
      username,
      password: "correct-horse-battery-staple",
    }),
  });
  expect(register.status, await register.clone().text()).toBe(201);
  const account = await register.json() as { token: string; user: { id: string } };
  platformToken = account.token;
  userId = account.user.id;

  const slug = `anonymous-${unique}`;
  const create = await fetch(`${stack.backendUrl}/api/v1/new-game/${slug}?name=Anonymous%20release`, {
    method: "POST",
    headers: { "cf-connecting-ip": "198.51.100.70" },
  });
  expect(create.status, await create.clone().text()).toBe(201);
  anonymous = await create.json() as CreatedGame;
  const upload = await fetch(`${stack.backendUrl}/api/v1/games/${anonymous.game_id}/blobs/${indexHash}`, {
    method: "PUT",
    headers: headers(anonymous.deploy_token),
    body: indexBytes,
  });
  expect(upload.status, await upload.clone().text()).toBe(201);
  const invalidMetadata = await fetch(`${stack.backendUrl}/api/v1/games/${anonymous.game_id}/releases`, {
    method: "PUT",
    headers: headers(anonymous.deploy_token, true),
    body: JSON.stringify({
      files: { "index.html": { sha256: indexHash, size: indexBytes.length } },
      metadata: { description: "x".repeat(501) },
    }),
  });
  expect(invalidMetadata.status).toBe(400);
  expect((await invalidMetadata.json() as { error: { code: string } }).error.code).toBe("invalid_description");
  const publish = await fetch(`${stack.backendUrl}/api/v1/games/${anonymous.game_id}/releases`, {
    method: "PUT",
    headers: headers(anonymous.deploy_token, true),
    body: JSON.stringify({
      files: { "index.html": { sha256: indexHash, size: indexBytes.length } },
      metadata: { description: "Published description" },
    }),
  });
  expect(publish.status, await publish.clone().text()).toBe(201);

  newestSlug = `newest-${unique}`;
  olderSlug = `older-${unique}`;
  const newestId = randomUUID();
  const olderId = randomUUID();
  const unlistedId = randomUUID();
  const unreleasedId = randomUUID();
  const newestRelease = "1".repeat(64);
  const olderRelease = "2".repeat(64);
  const unlistedRelease = "3".repeat(64);
  const thumbnailManifest = JSON.stringify({ files: {
    "index.html": { sha256: indexHash, size: indexBytes.length },
    "thumbnail.png": { sha256: "4".repeat(64), size: 20 },
  } });
  const basicManifest = JSON.stringify({ files: {
    "index.html": { sha256: indexHash, size: indexBytes.length },
  } });
  await stack.executeSql(`
    INSERT INTO games (id, owner_id, slug, name, description, state, visibility, active_release, listed)
    VALUES ('${newestId}', '${userId}', '${newestSlug}', 'Newest Game', 'Newest description', 'open', 'public', '${newestRelease}', 1);
    INSERT INTO releases (id, release_hash, game_id, manifest_json, created_at)
    VALUES ('${randomUUID()}', '${newestRelease}', '${newestId}', '${thumbnailManifest}', '2026-01-03 00:00:00');
    INSERT INTO games (id, owner_id, slug, name, state, visibility, active_release, listed)
    VALUES ('${olderId}', '${userId}', '${olderSlug}', 'Older Game', 'open', 'public', '${olderRelease}', 1);
    INSERT INTO releases (id, release_hash, game_id, manifest_json, created_at)
    VALUES ('${randomUUID()}', '${olderRelease}', '${olderId}', '${basicManifest}', '2026-01-02 00:00:00');
    INSERT INTO games (id, owner_id, slug, name, state, visibility, active_release, listed)
    VALUES ('${unlistedId}', '${userId}', 'unlisted-${unique}', 'Unlisted Game', 'open', 'public', '${unlistedRelease}', 0);
    INSERT INTO releases (id, release_hash, game_id, manifest_json, created_at)
    VALUES ('${randomUUID()}', '${unlistedRelease}', '${unlistedId}', '${basicManifest}', '2026-01-04 00:00:00');
    INSERT INTO games (id, owner_id, slug, name, state, visibility, listed)
    VALUES ('${unreleasedId}', '${userId}', 'unreleased-${unique}', 'Unreleased Game', 'open', 'public', 1);
  `);
}, 180_000);

afterAll(async () => {
  await stack?.cleanup();
});

beforeEach(async () => {
  await stack.ready();
});

describe("storefront", () => {
  it("excludes anonymous, unlisted, and unreleased games and orders active releases", async () => {
    const body = await publicGames();
    expect(body.games.map((game) => game.slug)).toEqual([newestSlug, olderSlug]);
    expect(body.games[0]).toMatchObject({
      name: "Newest Game",
      description: "Newest description",
      author: username,
      preview_url: `${stack.gatewayUrl}/${newestSlug}/`,
      thumbnail_url: `${stack.gatewayUrl}/${newestSlug}/thumbnail.png`,
    });
    expect(body.games[1].thumbnail_url).toMatch(/^data:image\/svg\+xml,/);
    expect(body.games.some((game) => game.slug === anonymous.slug)).toBe(false);
    expect(body.games.some((game) => game.name === "Unlisted Game")).toBe(false);
    expect(body.games.some((game) => game.name === "Unreleased Game")).toBe(false);
  });

  it("paginates public game JSON with a stable cursor", async () => {
    const first = await publicGames("?limit=1");
    expect(first.games.map((game) => game.slug)).toEqual([newestSlug]);
    expect(first.next_cursor).toBeTruthy();
    const second = await publicGames(`?limit=1&cursor=${encodeURIComponent(first.next_cursor ?? "")}`);
    expect(second.games.map((game) => game.slug)).toEqual([olderSlug]);
    expect(second.next_cursor).toBeNull();

    expect((await fetch(`${stack.backendUrl}/api/v1/games?limit=0`)).status).toBe(400);
    expect((await fetch(`${stack.backendUrl}/api/v1/games?cursor=not-a-cursor`)).status).toBe(400);
  });

  it("renders cards and Play links with cache headers and client-side search", async () => {
    const response = await fetch(`${stack.backendUrl}/?test=initial-store`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Newest Game");
    expect(html).toContain(`href=\"${stack.gatewayUrl}/${newestSlug}/\">Play</a>`);
    expect(html).not.toContain(anonymous.slug);
    expect(html).toContain("id=\"search\"");

    const agents = await fetch(`${stack.backendUrl}/agents.md`);
    expect(agents.status).toBe(200);
    expect(agents.headers.get("content-type")).toContain("text/markdown");
    expect(await agents.text()).toContain("# Blitz agent guide");
    const llms = await fetch(`${stack.backendUrl}/llms.txt`);
    expect(llms.status).toBe(200);
    expect(await llms.text()).toContain("https://blitz.dev/agents.md");
  });

  it("copies publish metadata and validates deploy-token and owner PATCH access", async () => {
    const beforePatch = await fetch(`${stack.backendUrl}/api/v1/games/${anonymous.game_id}`, {
      headers: headers(anonymous.deploy_token),
    });
    expect((await beforePatch.json() as { game: { description: string } }).game.description).toBe("Published description");

    const endpoint = `${stack.backendUrl}/api/v1/games/${anonymous.game_id}`;
    expect((await fetch(endpoint, { method: "PATCH" })).status).toBe(401);
    expect((await fetch(endpoint, { method: "PATCH", headers: headers("wrong-token", true), body: "{}" })).status).toBe(401);
    for (const [body, code] of [
      [{ name: "x".repeat(101) }, "invalid_name"],
      [{ description: "x".repeat(501) }, "invalid_description"],
      [{ listed: "yes" }, "invalid_listed"],
      [{}, "invalid_update"],
    ] as const) {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: headers(anonymous.deploy_token, true),
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      expect((await response.json() as { error: { code: string } }).error.code).toBe(code);
    }

    const deployPatch = await fetch(endpoint, {
      method: "PATCH",
      headers: headers(anonymous.deploy_token, true),
      body: JSON.stringify({ name: "Claimed Game", description: "Deploy token update", listed: false }),
    });
    expect(deployPatch.status, await deployPatch.clone().text()).toBe(200);
    expect(await deployPatch.json()).toMatchObject({ game: {
      name: "Claimed Game",
      description: "Deploy token update",
      listed: false,
    } });

    const claim = await fetch(`${stack.backendUrl}/api/v1/games/${anonymous.slug}/claim`, {
      method: "POST",
      headers: headers(platformToken, true),
      body: JSON.stringify({ secret: anonymous.claim_secret }),
    });
    expect(claim.status, await claim.clone().text()).toBe(200);
    expect((await publicGames()).games.some((game) => game.slug === anonymous.slug)).toBe(true);

    const otherName = `other${Date.now().toString(36)}`;
    const other = await fetch(`${stack.backendUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${otherName}@example.com`, username: otherName, password: "another-good-password" }),
    });
    expect(other.status).toBe(201);
    const otherToken = (await other.json() as { token: string }).token;
    expect((await fetch(endpoint, {
      method: "PATCH",
      headers: headers(otherToken, true),
      body: JSON.stringify({ listed: false }),
    })).status).toBe(404);

    const ownerPatch = await fetch(endpoint, {
      method: "PATCH",
      headers: headers(platformToken, true),
      body: JSON.stringify({ listed: false }),
    });
    expect(ownerPatch.status).toBe(200);
    expect((await publicGames()).games.some((game) => game.slug === anonymous.slug)).toBe(false);
  });

  it("deletes a runtime only with runtime-upload authorization", async () => {
    const runtimeToken = "integration-runtime-upload-token-with-at-least-32-bytes";
    const runtimeBytes = new TextEncoder().encode("storefront-runtime");
    const endpoint = `${stack.backendUrl}/api/v1/runtimes/storefront-delete-test`;
    const upload = await fetch(endpoint, {
      method: "PUT",
      headers: { Authorization: `Bearer ${runtimeToken}` },
      body: runtimeBytes,
    });
    expect(upload.status, await upload.clone().text()).toBe(201);
    expect((await fetch(endpoint, { method: "DELETE" })).status).toBe(401);
    expect((await fetch(endpoint, {
      method: "DELETE",
      headers: { Authorization: "Bearer incorrect-runtime-token" },
    })).status).toBe(401);
    const deleted = await fetch(endpoint, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${runtimeToken}` },
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ deleted: true, version: "storefront-delete-test" });
    expect((await fetch(endpoint)).status).toBe(404);
  });
});
