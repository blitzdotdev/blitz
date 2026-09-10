# Blitz Games publish API

The backend owns accounts, games, blobs, and releases. The gateway serves the active release. JSON errors use this shape:

```json
{"error":{"code":"machine_code","message":"Short explanation."}}
```

## Authentication

Game APIs accept either token type in `Authorization: Bearer <token>`.

- A deploy token starts with `tp_`. It can access one game.
- A platform JWT can access games owned by that user.
- Claiming requires a platform JWT.

Deploy tokens and claim secrets are returned as raw values only when issued. Store them securely. The database stores SHA-256 hashes.

## Platform accounts

### Health

`GET /health`

Auth: none.

Success: `200`.

```json
{"status":"ok","service":"blitz-backend"}
```

### Register

`POST /api/v1/auth/register`

Auth: none.

Request:

```json
{"email":"player@example.com","username":"player_one","password":"at-least-8-characters","name":"Player One"}
```

`name` is optional. Usernames start with a letter and contain only letters, digits, and `_`.

Success: `201`.

```json
{"user":{"id":"...","username":"player_one"},"token":"JWT","refresh_token":"JWT"}
```

Errors: `400 invalid_registration`; auth-library validation or conflict errors for duplicate email or username.

### Log in

`POST /api/v1/auth/login`

Auth: none.

Request:

```json
{"identity":"player@example.com","password":"at-least-8-characters"}
```

`identity` may be the email or username.

Success: `200`, with the same body shape as register.

Errors: `400 invalid_login`; auth-library authentication errors for bad credentials.

### Sign in with Google Identity Services

`POST /api/v1/table/users/auth/google-login`

Auth: none. This is the teenybase framework route exposed by the backend's `/api` mount. It uses the existing teenyapp Google OAuth client and the Google Identity Services ID-token flow; there is no Google client secret.

Content type: `application/x-www-form-urlencoded`.

Form fields:

- `credential`: required GIS JWT credential.
- `g_csrf_token`: required double-submit CSRF value.
- `select_by`: optional GIS selection metadata.

The request must also carry a `g_csrf_token` cookie whose value exactly matches the form field. A missing form value returns `400`; a missing or mismatched cookie returns `403`. Let GIS perform its form POST directly, or use a credentialed request that preserves the cookie. On success the JSON includes the platform `token`, `refresh_token`, and user `record`. This backend does not currently configure teenybase `authCookie`, so clients must use the returned token as the Bearer token.

The Google Cloud OAuth client must list the sign-in page origins as authorized JavaScript origins: `https://blitz.dev`, plus `https://blitz-backend.blitzapp.workers.dev` for workers.dev testing.

### Current user

`GET /api/v1/auth/me`

Auth: platform JWT.

Success: `200`.

```json
{"user":{"id":"...","username":"player_one","email":"player@example.com","email_verified":0,"name":"Player One","avatar":null,"role":null,"status":"active","created":"...","updated":"..."}}
```

Errors: `401 authentication_required`, `401 invalid_token`, `404 user_not_found`.

## Games

### List published games

`GET /api/v1/games?limit=<1-100>&cursor=<opaque-cursor>`

Auth: none. The list contains only claimed games that are listed and have an active release. Anonymous games are never returned. Games are ordered by active-release creation time, newest first. `limit` defaults to `24`; pass the returned `next_cursor` unchanged to fetch the next page.

Success: `200`.

```json
{
  "games":[{
    "slug":"my-game",
    "name":"My Game",
    "description":"A tiny adventure",
    "author":"player_one",
    "thumbnail_url":"https://blitz-game-gateway.<subdomain>.workers.dev/my-game/thumbnail.png",
    "preview_url":"https://blitz-game-gateway.<subdomain>.workers.dev/my-game/",
    "updated_at":"YYYY-MM-DD HH:MM:SS"
  }],
  "next_cursor":null
}
```

When the active manifest does not contain `thumbnail.png` at its root, `thumbnail_url` is a `data:image/svg+xml,...` placeholder. Errors: `400 invalid_limit`, `400 invalid_cursor`.

### Check a slug

`GET /api/v1/slugs/:slug`

Auth: none. This uses the same per-IP rate limiter as anonymous creation. The slug namespace is owned by this backend's D1 database and is independent of teenyapp.

Success: `200`.

```json
{"slug":"my-game","available":true}
```

Unavailable:

```json
{"slug":"my-game","available":false,"reason":"slug_taken"}
```

`reason` is `invalid_slug`, `reserved_slug`, or `slug_taken`. Rate limiting returns `429 rate_limited` with `Retry-After: 60`.

### Create an anonymous game

`POST /api/v1/new-game/:slug?name=<name>&source=<slug>`

Auth: none.

The slug is 3-49 lowercase letters, digits, or hyphens. It cannot begin or end with a hyphen, contain `--`, or use a reserved name. `name` is optional and has a 100-character limit. `source` is optional. A source must be a public, open, unexpired game. A fork shares the source release blobs; no objects are copied.

Success: `201`.

```json
{
  "game_id":"UUID",
  "slug":"my-game",
  "name":"My Game",
  "state":"open",
  "expires_at":"YYYY-MM-DD HH:MM:SS",
  "preview_url":"https://blitz-game-gateway.<subdomain>.workers.dev/my-game/",
  "deploy_token":"tp_...",
  "claim_secret":"...",
  "claim_url":"https://<backend>/api/v1/games/my-game/claim"
}
```

Anonymous games expire after 12 hours. Limits are 10 creates per IP per minute and 100 creates per ASN per minute. The KV tripwire also enforces the IP/ASN windows and supports an emergency lockdown key.

Errors: `400 invalid_slug`, `400 reserved_slug`, `400 invalid_name`, `400 invalid_source`, `404 source_not_found`, `409 slug_taken`, `429 rate_limited`, `503 service_unavailable`.

### Get a game

`GET /api/v1/games/:id`

Auth: the game's deploy token or the owner's platform JWT.

`:id` may be the game ID or slug. Slugs are resolved first. The same applies to the blob, release, and deploy-token routes below.

Success: `200`.

```json
{"game":{"id":"...","owner_id":"...","slug":"my-game","name":"My Game","description":"A tiny adventure","listed":true,"state":"open","visibility":"public","expires_at":"...","active_release":"...","bytes_used":123,"created_at":"...","updated_at":"...","preview_url":"..."}}
```

Errors: `401 authentication_required`, `401 invalid_token`, `404 game_not_found`, `409 game_not_open`, `410 game_expired`.

### Update a game

`PATCH /api/v1/games/:id`

Auth: the game's deploy token or the owner's platform JWT. `:id` may be the game ID or slug.

Request fields are optional, but at least one is required:

```json
{"name":"My Game","description":"A tiny adventure","listed":true}
```

`name` is 1-100 characters after trimming. `description` is a string of at most 500 characters; an empty string clears the visible text. `listed` is boolean. Anonymous games remain absent from the store even when `listed` is true. Claiming a game resets `listed` to true.

Success: `200`, with the same `game` object shape as Get a game; `listed` is returned as a boolean from this endpoint.

Errors: `400 bad_request`, `400 invalid_update`, `400 invalid_name`, `400 invalid_description`, `400 invalid_listed`, plus game-auth errors.

### Delete a game

`DELETE /api/v1/games/:id`

Auth: the game's deploy token or the owner's platform JWT.

Success: `200`.

```json
{"deleted":true,"game_id":"UUID","slug":"my-game"}
```

The game row, releases, and deploy tokens are removed atomically with release-reference decrements. Shared R2 blobs remain during the grace period and are removed by GC only after their global release count reaches zero.

Errors: `401 authentication_required`, `401 invalid_token`, `404 game_not_found`, `409 game_not_open`, `410 game_expired`.

## Deploy tokens

These management endpoints require the owner's platform JWT. A newly minted raw token is shown once.

### Mint a deploy token

`POST /api/v1/games/:id/tokens`

Request:

```json
{"name":"build-agent"}
```

The name is 1-80 characters. Success: `201`.

```json
{"token":{"id":"UUID","name":"build-agent","token_prefix":"tp_ab12C","raw_token":"tp_..."}}
```

Errors: `400 invalid_token_name`, `401 authentication_required`, `401 invalid_token`, `404 game_not_found`, `409 game_not_open`, `410 game_expired`.

### List deploy tokens

`GET /api/v1/games/:id/tokens`

Success: `200`. Raw tokens and hashes are never listed.

```json
{"tokens":[{"id":"UUID","name":"build-agent","token_prefix":"tp_ab12C","last_used_at":null,"revoked":0,"created_at":"..."}]}
```

Errors: platform-auth errors and `404 game_not_found`.

### Revoke a deploy token

`DELETE /api/v1/games/:id/tokens/:tokenId`

Success: `200`. Revocation is a soft delete and takes effect on the next request.

```json
{"token":{"id":"UUID","revoked":true}}
```

Errors: platform-auth errors, `404 game_not_found`, `404 token_not_found`, `409 game_not_open`, `410 game_expired`.

## Blobs

Blob hashes are lowercase 64-character SHA-256 hex strings. Blob objects are global and content-addressed at `blobs/<sha256>`.

### Check one blob

`HEAD /api/v1/games/:id/blobs/:sha256`

Auth: game deploy token or owner JWT.

Success: `200` with `Content-Length` and `ETag`. Missing: `404`. Invalid hash: `400 invalid_hash`.

### Download a blob

`GET /api/v1/games/:id/blobs/:sha256`

Auth: game deploy token or owner JWT. Success streams the bytes with `Content-Type: application/octet-stream`, `Content-Length`, and `ETag`. Blobs are global, but this route requires game auth and is not a public mirror.

### Check missing blobs

`POST /api/v1/games/:id/blobs/missing`

Auth: game deploy token or owner JWT.

Request:

```json
{"hashes":["<sha256>","<sha256>"]}
```

Success: `200`.

```json
{"missing":["<sha256>"]}
```

The request accepts at most 2,000 hashes. Errors: `400 bad_request`, `400 invalid_hash`, `413 too_many_hashes`, plus game-auth errors.

### Upload a blob

`PUT /api/v1/games/:id/blobs/:sha256`

Auth: game deploy token or owner JWT. The body is raw bytes. Send an exact `Content-Length`.

Success for a new object: `201`.

```json
{"sha256":"<sha256>","size":123,"uploaded":true}
```

An existing object is idempotent and returns `200` with `uploaded:false`. The default per-blob limit is 100 MiB.

Every successful upload also upserts the D1 blob inventory row without changing an existing release reference count. A newly uploaded, unreferenced object starts at `ref_count = 0` and receives the GC grace period.

Errors: `400 invalid_hash`, `400 invalid_content_length`, `400 body_required`, `411 content_length_required`, `413 blob_too_large`, `422 hash_mismatch`, plus game-auth errors.

## Releases

### Publish a release

`PUT /api/v1/games/:id/releases`

Auth: game deploy token or owner JWT.

Request:

```json
{
  "files": {
    "index.html": {"sha256":"<sha256>","size":123,"mime":"text/html; charset=utf-8"},
    "models/scene.glb": {"sha256":"<sha256>","size":456}
  },
  "message":"Initial release",
  "base_release":"<previous-active-release-hash>",
  "metadata":{"description":"A tiny adventure"}
}
```

`base_release` is optional. Send the release hash you last pulled. If it is not the current active release, the server returns `409 release_moved` with `error.active_release`. Pull that release before publishing again. A malformed value returns `400 invalid_base_release`. `metadata` is optional. When `metadata.description` is present, it must be a string of at most 500 characters and is copied to the game.

Paths are relative. They cannot contain empty, `.`, or `..` segments, backslashes, or NUL bytes. A path is at most 512 characters. A release has 1-2,000 files. `message` is optional and at most 500 characters. All blobs must exist and their R2 sizes must match. The default active-manifest quota is 500 MiB. Reused blob bytes count once per path in the manifest.

`_blitz/runtime.js` is accepted like any other file. When `REQUIRE_REGISTERED_RUNTIME=true`, its SHA-256 must exist in the runtime registry or publishing returns `409 unregistered_runtime`.

The server sorts paths, emits compact canonical JSON, and hashes that JSON with SHA-256. Publishing also activates the release.

Success: `201` for a new release or `200` for an idempotent existing manifest.

```json
{"release_hash":"<sha256>","preview_url":"...","files":{"index.html":{"sha256":"...","size":123}}}
```

Errors: `400 bad_request`, `400 invalid_manifest`, `400 invalid_message`, `400 invalid_metadata`, `400 invalid_description`, `409 missing_blobs`, `409 blob_size_mismatch`, `409 unregistered_runtime` when strict runtime registration is enabled, `413 game_quota_exceeded`, plus game-auth errors.

Publishing increments each distinct blob SHA-256 once per new release in the same atomic D1 batch that inserts and activates the release. The backend retains at most `RELEASE_RETENTION` releases per game (default `10`). A publish beyond the limit removes the oldest inactive releases and decrements their references in that same batch; the active release is never pruned. Re-publishing an identical manifest is idempotent and does not add references.

### List releases

`GET /api/v1/games/:id/releases`

Auth: game deploy token or owner JWT.

Success: `200`.

```json
{"releases":[{"release_hash":"...","created_at":"...","message":"Initial release","files":2,"active":true}]}
```

Errors: game-auth errors.

### Get a release

`GET /api/v1/games/:id/releases/:hash`

Auth: game deploy token or owner JWT.

Success: `200`.

```json
{"release_hash":"...","files":{"index.html":{"sha256":"...","size":123}},"message":"Initial release","created_at":"...","active":true}
```

Errors: `404 release_not_found`, plus game-auth errors.

### Activate a release

`POST /api/v1/games/:id/releases/:hash/activate`

Auth: game deploy token or owner JWT. The request has no body.

Success: `200`.

```json
{"release_hash":"<sha256>","preview_url":"...","files":2}
```

Errors: `404 release_not_found`, plus game-auth errors.

## Runtime registry

Runtime blobs use the same content-addressed `blobs/<sha256>` R2 namespace. Every runtime registry row is a GC root, whether or not a release references its hash. The registry is keyed by SHA-256, so one version can retain multiple engine builds.

### Upload a runtime build

`PUT /api/v1/runtimes/:version`

Auth: `Authorization: Bearer <RUNTIME_UPLOAD_TOKEN>`. The body is raw bytes and requires an exact `Content-Length`. Versions are 1-128 letters, digits, dots, underscores, or hyphens. The backend computes SHA-256, uploads the content-addressed object, ensures the blob inventory row exists, and upserts the `(sha256, version)` registry row. Uploading the same bytes again is idempotent and preserves `created_at`; uploading different bytes for the same version retains both builds.

Success: `201`.

```json
{"version":"1.2.3","sha256":"<sha256>","size":123456}
```

Errors: `400 invalid_runtime_version`, `400 invalid_content_length`, `400 content_length_mismatch`, `400 body_required`, `401 invalid_runtime_token`, `409 runtime_blob_conflict`, `411 content_length_required`, `413 runtime_too_large`.

### Get a runtime version

`GET /api/v1/runtimes/:version`

Auth: none. Success: `200`. `runtimes` contains every registered hash for the version, newest first. The top-level `sha256` is the newest runtime's hash and remains present for compatibility with current CLI clients.

```json
{
  "version":"1.2.3",
  "sha256":"<newest-sha256>",
  "runtimes":[
    {"sha256":"<newest-sha256>","size":123456,"created_at":"YYYY-MM-DD HH:MM:SS"},
    {"sha256":"<older-sha256>","size":123000,"created_at":"YYYY-MM-DD HH:MM:SS"}
  ]
}
```

Missing: `404 runtime_not_found`.

The CLI's "installed runtime differs from registered" check should consider the installed runtime registered when its SHA-256 matches **any** entry in `runtimes`, not only the compatibility `sha256` field. Until that client change ships, the top-level field can cause a false warning when an installed build is registered but is not the newest build for its version.

### List runtimes

`GET /api/v1/runtimes`

Auth: none. Success: `200`.

```json
{
  "versions":[
    {
      "version":"1.2.3",
      "runtimes":[
        {"sha256":"<newest-sha256>","size":123456,"created_at":"YYYY-MM-DD HH:MM:SS"},
        {"sha256":"<older-sha256>","size":123000,"created_at":"YYYY-MM-DD HH:MM:SS"}
      ]
    }
  ]
}
```

Versions are ordered lexically; each version's runtime builds are newest first.

### Delete a runtime build

`DELETE /api/v1/runtimes/:version/:sha256`

Auth: `Authorization: Bearer <RUNTIME_UPLOAD_TOKEN>`.

Success: `200`.

```json
{"deleted":true,"version":"1.2.3","sha256":"<sha256>"}
```

Deleting the registry row does not immediately remove its R2 blob. If no release references the hash, the blob becomes eligible for the normal grace-period sweep.

Errors: `400 invalid_runtime_version`, `400 invalid_hash`, `401 invalid_runtime_token`, `404 runtime_not_found`.

## Blob lifecycle and garbage collection

`blobs.ref_count` counts a SHA-256 once per release, including inactive releases retained for rollback. Forked release rows add their own references. Explicit game deletion, expiry cleanup, and retention pruning decrement counts in their row-deletion transactions.

Every 10 minutes, GC considers at most 500 zero-reference blobs older than `BLOB_GRACE_SECONDS` (default `86400`, 24 hours). Runtime hashes are excluded. R2 deletion uses batches of at most 1,000 keys and D1 rows are removed conditionally after a final zero-reference/runtime check.

Daily reconciliation lists at most `RECONCILE_BATCH` R2 objects (default `500`) and stores its continuation cursor in the existing KV namespace. It inventories objects missing from D1 using their R2 upload time, repairs release-derived reference counts, and logs one structured summary per run.

## Claiming

Anonymous creation already binds and returns `claim_secret`. The separate authorization endpoint exists for clients that created an anonymous game without one.

### Authorize a claim secret

`POST /api/v1/games/:id/authorize-claim-secret`

Auth: game deploy token. The request has no body.

Success: `201`. The raw secret is returned once.

```json
{"game_id":"UUID","slug":"my-game","claim_secret":"..."}
```

Errors: `409 already_authorized`, `409 not_anonymous`, `410 game_expired`, plus game-auth errors.

### Claim a game

`POST /api/v1/games/:slug/claim`

Auth: platform JWT.

Request:

```json
{"secret":"<claim_secret>"}
```

Success: `200`. Claiming atomically transfers ownership and clears the expiry and claim secret.

```json
{"game_id":"UUID","slug":"my-game","owner_id":"USER_UUID","claimed":true}
```

Errors: `400 claim_secret_required`, `403 invalid_claim_secret`, `404 game_not_found`, `409 already_claimed`, `409 claim_not_authorized`, `409 claim_conflict`, `410 game_expired`, plus platform-auth errors.

## Gateway

Production path form: `https://<slug>.app.blitz.dev/<path>`.

workers.dev and local path form: `https://<gateway>/<slug>/<path>`.

`/` and every path ending in `/` map to `index.html`. Other paths match the manifest exactly. Only `GET` and `HEAD` are accepted.

Success is `200`, or `206` for one valid byte range. Responses include `Content-Type`, `Content-Encoding: identity`, `ETag: "<sha256>"`, `Accept-Ranges: bytes`, `Cache-Control: public, max-age=60, must-revalidate`, and `X-Content-Type-Options: nosniff`. Identity encoding preserves byte-for-byte strong ETags on workers.dev. A matching `If-None-Match` returns `304`. An invalid or unsatisfiable range returns `416`. Missing games, releases, paths, or R2 objects return `404`. Cleaning or expired games return `410`. Creating games return `503`. An open game with no active release returns the publishing spinner described below. Other methods return `405`.

The publishing spinner returns `503` with `Retry-After: 2`, `Cache-Control: no-store`, `X-Blitz-State: publishing`, and `X-Content-Type-Options: nosniff`. Its centered HTML page says "Publishing your game" and polls the current URL every two seconds with `cache: 'no-store'`; it reloads once the response no longer has `X-Blitz-State`. This behavior is the same in custom-host mode and workers.dev/local path mode. Unknown slugs remain `404`.

Known extensions include HTML, JavaScript, CSS, JSON, GLB, glTF, BIN, KTX2, Basis, Wasm, HDR, EXR, PNG, JPEG, WebP, SVG, MP3, Ogg, WAV, MP4, WebM, WOFF2, TXT, and Markdown. An explicit manifest `mime` wins. Unknown files use `application/octet-stream`.

## Complete curl walkthrough

Set the deployed origins. Do not add a trailing slash.

```sh
BACKEND_URL='https://blitz-backend.<your-subdomain>.workers.dev'
GATEWAY_URL='https://blitz-game-gateway.<your-subdomain>.workers.dev'
SLUG="walkthrough-$(date +%s)"
```

Create a game. Save the response because the two raw secrets appear only here.

```sh
CREATE_JSON=$(curl -fsS -X POST "$BACKEND_URL/api/v1/new-game/$SLUG?name=Walkthrough")
GAME_ID=$(printf '%s' "$CREATE_JSON" | jq -r .game_id)
DEPLOY_TOKEN=$(printf '%s' "$CREATE_JSON" | jq -r .deploy_token)
CLAIM_SECRET=$(printf '%s' "$CREATE_JSON" | jq -r .claim_secret)
PREVIEW_URL=$(printf '%s' "$CREATE_JSON" | jq -r .preview_url)
printf '%s\n' "$CREATE_JSON" | jq '{game_id,slug,name,state,expires_at,preview_url,claim_url}'
```

Compute file hashes and sizes.

```sh
INDEX_FILE='./index.html'
MODEL_FILE='./scene.glb'
INDEX_HASH=$(shasum -a 256 "$INDEX_FILE" | awk '{print $1}')
MODEL_HASH=$(shasum -a 256 "$MODEL_FILE" | awk '{print $1}')
INDEX_SIZE=$(wc -c < "$INDEX_FILE" | tr -d ' ')
MODEL_SIZE=$(wc -c < "$MODEL_FILE" | tr -d ' ')
```

Ask which blobs are missing.

```sh
curl -fsS -X POST "$BACKEND_URL/api/v1/games/$GAME_ID/blobs/missing" \
  -H "Authorization: Bearer $DEPLOY_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "{\"hashes\":[\"$INDEX_HASH\",\"$MODEL_HASH\"]}" | jq
```

Upload the missing blobs.

```sh
curl -fsS -X PUT "$BACKEND_URL/api/v1/games/$GAME_ID/blobs/$INDEX_HASH" \
  -H "Authorization: Bearer $DEPLOY_TOKEN" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary "@$INDEX_FILE" | jq
curl -fsS -X PUT "$BACKEND_URL/api/v1/games/$GAME_ID/blobs/$MODEL_HASH" \
  -H "Authorization: Bearer $DEPLOY_TOKEN" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary "@$MODEL_FILE" | jq
```

Publish and activate the manifest.

```sh
RELEASE_JSON=$(curl -fsS -X PUT "$BACKEND_URL/api/v1/games/$GAME_ID/releases" \
  -H "Authorization: Bearer $DEPLOY_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "{\"files\":{\"index.html\":{\"sha256\":\"$INDEX_HASH\",\"size\":$INDEX_SIZE},\"scene.glb\":{\"sha256\":\"$MODEL_HASH\",\"size\":$MODEL_SIZE}},\"message\":\"First release\"}")
printf '%s\n' "$RELEASE_JSON" | jq
```

Open or inspect the game. In workers.dev mode, the slug is the first path segment.

```sh
open "$PREVIEW_URL"
curl -i "$PREVIEW_URL"
curl -i -H 'Range: bytes=0-3' "$GATEWAY_URL/$SLUG/scene.glb"
curl -i -H "If-None-Match: \"$INDEX_HASH\"" "$PREVIEW_URL"
```

Register a platform account, then claim the game.

```sh
ACCOUNT_JSON=$(curl -fsS -X POST "$BACKEND_URL/api/v1/auth/register" \
  -H 'Content-Type: application/json' \
  --data '{"email":"player@example.com","username":"player_one","password":"change-this-password"}')
PLATFORM_TOKEN=$(printf '%s' "$ACCOUNT_JSON" | jq -r .token)
curl -fsS -X POST "$BACKEND_URL/api/v1/games/$SLUG/claim" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "{\"secret\":\"$CLAIM_SECRET\"}" | jq
```

Delete the walkthrough game when finished. Its release references drop immediately; blobs remain available for deduplication during the 24-hour GC grace period and survive longer if another release or runtime still references them.

```sh
curl -fsS -X DELETE "$BACKEND_URL/api/v1/games/$GAME_ID" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq
```

Never log `DEPLOY_TOKEN`, `CLAIM_SECRET`, `PLATFORM_TOKEN`, or the unredacted create/register responses.
