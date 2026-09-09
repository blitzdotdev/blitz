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

### Current user

`GET /api/v1/auth/me`

Auth: platform JWT.

Success: `200`.

```json
{"user":{"id":"...","username":"player_one","email":"player@example.com","email_verified":0,"name":"Player One","avatar":null,"role":null,"status":"active","created":"...","updated":"..."}}
```

Errors: `401 authentication_required`, `401 invalid_token`, `404 user_not_found`.

## Games

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

Success: `200`.

```json
{"game":{"id":"...","owner_id":"...","slug":"my-game","name":"My Game","state":"open","visibility":"public","expires_at":"...","active_release":"...","bytes_used":123,"created_at":"...","updated_at":"...","preview_url":"..."}}
```

Errors: `401 authentication_required`, `401 invalid_token`, `404 game_not_found`, `409 game_not_open`, `410 game_expired`.

### Delete a game

`DELETE /api/v1/games/:id`

Auth: the game's deploy token or the owner's platform JWT.

Success: `200`.

```json
{"deleted":true,"game_id":"UUID","slug":"my-game"}
```

The game row, releases, and deploy tokens are removed. Shared R2 blobs are not removed.

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
  "message":"Initial release"
}
```

Paths are relative. They cannot contain empty, `.`, or `..` segments, backslashes, or NUL bytes. A path is at most 512 characters. A release has 1-2,000 files. `message` is optional and at most 500 characters. All blobs must exist and their R2 sizes must match. The default active-manifest quota is 500 MiB. Reused blob bytes count once per path in the manifest.

The server sorts paths, emits compact canonical JSON, and hashes that JSON with SHA-256. Publishing also activates the release.

Success: `201` for a new release or `200` for an idempotent existing manifest.

```json
{"release_hash":"<sha256>","preview_url":"...","files":{"index.html":{"sha256":"...","size":123}}}
```

Errors: `400 bad_request`, `400 invalid_manifest`, `400 invalid_message`, `409 missing_blobs`, `409 blob_size_mismatch`, `413 game_quota_exceeded`, plus game-auth errors.

### List releases

`GET /api/v1/games/:id/releases`

Auth: game deploy token or owner JWT.

Success: `200`.

```json
{"releases":[{"release_hash":"...","created_at":"...","message":"Initial release","files":2,"active":true}]}
```

Errors: game-auth errors.

### Activate a release

`POST /api/v1/games/:id/releases/:hash/activate`

Auth: game deploy token or owner JWT. The request has no body.

Success: `200`.

```json
{"release_hash":"<sha256>","preview_url":"...","files":2}
```

Errors: `404 release_not_found`, plus game-auth errors.

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

Success is `200`, or `206` for one valid byte range. Responses include `Content-Type`, `Content-Encoding: identity`, `ETag: "<sha256>"`, `Accept-Ranges: bytes`, `Cache-Control: public, max-age=60, must-revalidate`, and `X-Content-Type-Options: nosniff`. Identity encoding preserves byte-for-byte strong ETags on workers.dev. A matching `If-None-Match` returns `304`. An invalid or unsatisfiable range returns `416`. Missing games, releases, paths, or R2 objects return `404`. Cleaning or expired games return `410`. Creating games return `503`. Other methods return `405`.

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

Delete the walkthrough game when finished. This keeps the shared blobs for future deduplication.

```sh
curl -fsS -X DELETE "$BACKEND_URL/api/v1/games/$GAME_ID" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" | jq
```

Never log `DEPLOY_TOKEN`, `CLAIM_SECRET`, `PLATFORM_TOKEN`, or the unredacted create/register responses.
