# Blitz Games build and deployment report

Date: 2026-09-09
Cloudflare account: `Blitz Development Sandbox` (`d25a778b256fb6ef6eea554d77c40f27`)

Both new Workers are deployed to workers.dev. No route or custom-domain configuration was deployed. No file under `/Users/minjunes/superapp`, any `threepipe*` directory, `uiconfig-blueprint`, `PLAN.md`, or `PLAN-REVIEW.md` was modified. No commit was made.

## 1. Directory trees

Two-level tree for `backend/`:

```text
backend/
├── .dev.vars.example
├── .gitignore
├── BLOB-GC.md
├── migrations/
│   └── 0000_initial.sql
├── package-lock.json
├── package.json
├── src/
│   ├── cron/
│   ├── index.ts
│   ├── middleware/
│   ├── routes/
│   ├── types.ts
│   └── utils/
├── teenybase.ts
├── test/
│   ├── fixtures/
│   ├── integration/
│   ├── unit/
│   ├── vitest.config.ts
│   └── vitest.integration.config.ts
├── tsconfig.json
├── worker-configuration.d.ts
├── wrangler.jsonc
└── wrangler.prod.jsonc
```

Top-level file purposes:

- `.dev.vars.example` documents the local JWT secret needed for account auth.
- `.gitignore` excludes dependencies, Wrangler state, and local secrets.
- `BLOB-GC.md` records the content-addressed blob lifecycle and future mark-and-sweep plan.
- `package.json` defines the backend dependencies and dev, test, typecheck, and deploy commands.
- `package-lock.json` locks the installed dependency graph.
- `teenybase.ts` declares the users/auth, games, game tokens, and releases schema for the teenybase plugin.
- `tsconfig.json` configures strict Worker TypeScript checks.
- `worker-configuration.d.ts` contains Wrangler-generated binding and runtime types.
- `wrangler.jsonc` is the only deployable config. It targets the sandbox account and workers.dev, with no routes.
- `wrangler.prod.jsonc` holds the future `blitz.dev/api/*` route and is explicitly marked not to deploy yet.

Two-level tree for `game-gateway/`:

```text
game-gateway/
├── .gitignore
├── package-lock.json
├── package.json
├── src/
│   ├── errors.ts
│   ├── index.ts
│   ├── mime.ts
│   ├── path.ts
│   └── range.ts
├── test/
│   └── gateway-utils.test.ts
├── tsconfig.json
├── vitest.config.ts
├── worker-configuration.d.ts
├── wrangler.jsonc
└── wrangler.prod.jsonc
```

Top-level file purposes:

- `.gitignore` excludes dependencies, Wrangler state, and local secrets.
- `package.json` defines the gateway test, typecheck, dev, and deploy commands.
- `package-lock.json` locks the installed dependency graph.
- `tsconfig.json` configures strict Worker TypeScript checks.
- `vitest.config.ts` configures the gateway unit suite.
- `worker-configuration.d.ts` contains Wrangler-generated binding and runtime types.
- `wrangler.jsonc` is the only deployable config. It targets the sandbox account and workers.dev, with no routes.
- `wrangler.prod.jsonc` holds the future `*.app.blitz.dev/*` route and is explicitly marked not to deploy yet.

The contract is at `docs/publish-api.md`.

## 2. Reference mechanics copied and dropped

Copied and adapted:

- `teenybase/backend/teenybase.ts` -> `backend/teenybase.ts`: kept teenybase schema/auth mechanics; renamed projects to games and commits to releases.
- `teenybase/backend/src/routes/anon-projects.ts` -> `backend/src/routes/anon-games.ts`: kept anonymous creation, TTL, rate limiting, KV tripwire, source-fork, and one-time token mechanics.
- `teenybase/backend/src/middleware/agent-auth.ts` -> `backend/src/middleware/agent-auth.ts`: kept hashed `tp_` Bearer-token lookup and added owned-game platform JWT access.
- `teenybase/backend/src/routes/anon-claim-bind.ts` plus the JSON claim path in `dashboard.ts` -> `backend/src/routes/claims.ts`: kept one-time secret binding and atomic claim transfer; omitted the SSR page.
- `teenybase/backend/src/routes/dashboard.ts` auth handlers -> `backend/src/routes/auth.ts`: kept JSON register, login, and current-user flows only.
- `teenybase/backend/src/routes/project-tokens.ts` and `src/utils/agent-tokens.ts` -> `backend/src/routes/tokens.ts` and `src/utils/crypto.ts`: kept hash-only token mint/list/revoke behavior without encrypted token recovery.
- `teenybase/backend/src/cron/expiry.ts` -> `backend/src/cron/expiry.ts`: kept bounded expiry selection and the `cleaning` transition.
- `teenybase/backend/src/cron/cleanup.ts` -> `backend/src/cron/cleanup.ts`: kept two-phase cleanup and cascaded relational deletion; R2 deletion was deliberately removed.
- `teenybase/backend/src/utils/validation.ts` -> `backend/src/utils/validation.ts`: kept strict slug and reserved-name validation and added manifest path/hash validation.
- `teenybase/project-gateway/src/index.ts` and `src/error-pages.ts` -> `game-gateway/src/index.ts`, `errors.ts`, `path.ts`, `mime.ts`, and `range.ts`: kept host parsing and response pages, then replaced dynamic Worker forwarding with D1-manifest/R2-object serving.
- `teenybase/backend/test/vitest*.ts` and integration helpers -> `backend/test/vitest*.ts` and `backend/test/integration/_helpers.ts`: kept the Vitest plus real local `wrangler dev` pattern.

Dropped:

- Dropped `@cloudflare/worker-bundler`, Workers Loader, `gateway_entry`, and bundle-KV mechanics.
- Dropped per-project D1/R2 provisioning and every `cf-resource-*` helper.
- Dropped app templates and `src/templates`.
- Dropped tools catalog, skills, and install routes.
- Dropped SSR dashboard and admin pages.
- Dropped X/DM flows.
- Dropped usage accounting cron and other teenyapp-only branches.

## 3. `teenybase` dependency decision

Decision: npm `teenybase@^0.0.14`.

Evidence:

```text
$ npm ls teenybase --depth=0
blitz-backend@0.1.0 /Users/minjunes/blitz/backend
└── teenybase@0.0.14
```

The installed package exports both `./worker` and `./scaffolds/*`. Its shipped files expose `$Database`, `D1Adapter`, `teenyHono`, `fields`, `authFields`, `baseFields`, and `createdTrigger`. Both Wrangler bundle dry-runs, all local Worker tests, the remote deployment, register/claim flow, and remote smoke passed with npm 0.0.14. No copied import was missing, so the read-only `file:/Users/minjunes/superapp/teenybase` fallback was not used.

One packaging caveat: importing `teenybase/worker` directly in plain Node 26 fails on its extensionless internal ESM specifiers. Wrangler/Vite resolves those specifiers correctly. This did not affect Worker builds, tests, or the deployed runtime.

## 4. Resources created and command audit

Name preflight found no resource or Worker with any requested target name. `wrangler whoami` confirmed the OAuth session and the `Blitz Development Sandbox` account ID. The unscoped R2 list was rejected because the login can see multiple accounts; it was rerun with the exact account ID.

Created resources:

| Type | Name | ID / identifier | Creation command |
|---|---|---|---|
| D1 | `blitz-games-platform-db` | `a6bc6a7c-aed6-4072-a1ef-35b86cc1ac13` | `npx wrangler d1 create blitz-games-platform-db` |
| R2 | `blitz-games-blobs` | bucket name is the identifier | `CLOUDFLARE_ACCOUNT_ID=d25a778b256fb6ef6eea554d77c40f27 npx wrangler r2 bucket create blitz-games-blobs` |
| KV | `blitz-games-anon-tripwire` | `33977401172a43a6a5b803022594421b` | `CLOUDFLARE_ACCOUNT_ID=d25a778b256fb6ef6eea554d77c40f27 npx wrangler kv namespace create blitz-games-anon-tripwire` |

Worker names created by secret/deploy operations:

- `blitz-backend`
- `blitz-game-gateway`

Both configs bind only the resources above. Rate-limit namespace IDs are `2001` and `2002`. Every Wrangler config contains `account_id: d25a778b256fb6ef6eea554d77c40f27`.

Read-only preflight and proof commands run:

```sh
npx wrangler whoami
npx wrangler d1 list --json
npx wrangler d1 info blitz-games-platform-db
npx wrangler kv namespace list
npx wrangler deployments list --name blitz-backend
npx wrangler deployments list --name blitz-game-gateway
npx wrangler r2 bucket list --json
npx wrangler r2 bucket list
CLOUDFLARE_ACCOUNT_ID=d25a778b256fb6ef6eea554d77c40f27 npx wrangler r2 bucket list
CLOUDFLARE_ACCOUNT_ID=d25a778b256fb6ef6eea554d77c40f27 npx wrangler r2 bucket info blitz-games-blobs
npx wrangler versions list
npx wrangler deployments list
npx wrangler secret list
npx wrangler rollback --help
```

The first R2 command failed because `--json` is unsupported. The second failed safely because no account was selected. Both were read-only. The account-scoped list/info commands succeeded.

Mutating remote Wrangler commands run:

```sh
npx wrangler d1 create blitz-games-platform-db
CLOUDFLARE_ACCOUNT_ID=d25a778b256fb6ef6eea554d77c40f27 npx wrangler r2 bucket create blitz-games-blobs
CLOUDFLARE_ACCOUNT_ID=d25a778b256fb6ef6eea554d77c40f27 npx wrangler kv namespace create blitz-games-anon-tripwire
npx wrangler d1 migrations apply blitz-games-platform-db --remote
openssl rand -hex 48 | npx wrangler secret put PLATFORM_AUTH_JWT_SECRET
npx wrangler deploy
```

`npx wrangler deploy` was run only from `backend/` and `game-gateway/`, always with the default `wrangler.jsonc`. It was rerun after final gateway ETag handling and token-management changes. The generated JWT value was piped directly to Wrangler and was never displayed.

Remote smoke cleanup touched only the new D1 database:

```sh
npx wrangler d1 execute blitz-games-platform-db --remote --command "SELECT id, username FROM users WHERE id = 'GuGJmeEZTiiehwbfCpdPgg';"
npx wrangler d1 execute blitz-games-platform-db --remote --command "DELETE FROM users WHERE id = 'GuGJmeEZTiiehwbfCpdPgg';"
npx wrangler d1 execute blitz-games-platform-db --remote --command "SELECT COUNT(*) AS remaining FROM users WHERE id = 'GuGJmeEZTiiehwbfCpdPgg';"
npx wrangler d1 execute blitz-games-platform-db --remote --command "SELECT (SELECT COUNT(*) FROM games) AS games, (SELECT COUNT(*) FROM releases) AS releases, (SELECT COUNT(*) FROM game_tokens) AS tokens, (SELECT COUNT(*) FROM users) AS users;"
```

Final row counts were `games=0`, `releases=0`, `tokens=0`, and `users=1`. The one user is the checked-in anonymous sentinel.

Local-only Wrangler commands were issued by the integration harness against a fresh temporary Miniflare persistence directory:

```sh
npx wrangler d1 migrations apply blitz-games-platform-db --local --persist-to <temporary-directory>
npx wrangler dev --local --test-scheduled --ip 127.0.0.1 --port <port> --persist-to <temporary-directory> --var PLATFORM_AUTH_JWT_SECRET:<test-only-value> --var GATEWAY_ORIGIN:http://127.0.0.1:<port>
npx wrangler dev --local --ip 127.0.0.1 --port <port> --persist-to <temporary-directory>
npx wrangler d1 execute blitz-games-platform-db --local --persist-to <temporary-directory> --command <test-SQL>
```

Build/proof commands included `npx wrangler types` and `npx wrangler deploy --dry-run --outdir <temporary-output>` in both Worker directories.

No delete command targeted a Cloudflare resource. No existing Worker, D1 database, R2 bucket, KV namespace, route, or domain was bound or modified. The only remote SQL and secret mutations targeted the new Blitz resources.

## 5. Test results

Commands:

```sh
cd /Users/minjunes/blitz/backend
npm run typecheck
npm test

cd /Users/minjunes/blitz/game-gateway
npm run typecheck
npm test
```

Final backend output:

```text
> tsc --noEmit

Test Files  2 passed (2)
     Tests  4 passed (4)

Test Files  1 passed (1)
     Tests  7 passed (7)
```

Final gateway output:

```text
> tsc --noEmit

Test Files  1 passed (1)
     Tests  6 passed (6)
```

No tests were skipped.

The backend integration suite starts both real local Workers with Wrangler and shared local D1/R2/KV state. Its seven cases cover:

- anonymous create and automatically bound deploy/claim secrets;
- missing checks, checksum-mismatch rejection with no residual object, two uploads, and blob `HEAD`;
- release canonicalization and publishing;
- gateway HTML, ETag, 304, GLB MIME, and four-byte range behavior;
- second-release removal and first-release activation;
- authorize-once claim secret, account registration, atomic claim, token mint/revoke, and delete;
- expiry mark (`410`) followed by cleanup (`404`);
- 11th anonymous create from one IP returning `429` through the local rate-limit/KV protection path.

The unit suites cover slug validation, manifest canonicalization/hash, path mapping, MIME mapping, and byte-range parsing.

Dry-run summaries:

```text
backend: Total Upload 1235.30 KiB / gzip 226.33 KiB; dry-run exit 0
gateway: Total Upload 8.74 KiB / gzip 3.08 KiB; dry-run exit 0
route guard: PASS: no routes in deployable wrangler.jsonc files
```

## 6. Remote smoke transcript

Origins used:

```sh
BACKEND_URL='https://blitz-backend.blitzapp.workers.dev'
GATEWAY_URL='https://blitz-game-gateway.blitzapp.workers.dev'
SLUG='remote-smoke-1788985855'
INDEX_FILE='./backend/test/fixtures/index.html'
MODEL_FILE='./backend/test/fixtures/tiny.glb'
```

The exact curl sequence used shell variables for raw secrets. Secret-bearing responses were parsed in memory and printed only through redacting `jq` projections.

```sh
CREATE_JSON=$(curl -fsS -X POST "$BACKEND_URL/api/v1/new-game/$SLUG?name=Remote%20Smoke")
GAME_ID=$(printf '%s' "$CREATE_JSON" | jq -r .game_id)
DEPLOY_TOKEN=$(printf '%s' "$CREATE_JSON" | jq -r .deploy_token)
CLAIM_SECRET=$(printf '%s' "$CREATE_JSON" | jq -r .claim_secret)
PREVIEW_URL=$(printf '%s' "$CREATE_JSON" | jq -r .preview_url)

INDEX_HASH=$(shasum -a 256 "$INDEX_FILE" | awk '{print $1}')
MODEL_HASH=$(shasum -a 256 "$MODEL_FILE" | awk '{print $1}')
INDEX_SIZE=$(wc -c < "$INDEX_FILE" | tr -d ' ')
MODEL_SIZE=$(wc -c < "$MODEL_FILE" | tr -d ' ')

MISSING_BODY=$(jq -cn --arg a "$INDEX_HASH" --arg b "$MODEL_HASH" '{hashes:[$a,$b]}')
curl -fsS -X POST "$BACKEND_URL/api/v1/games/$GAME_ID/blobs/missing" \
  -H "Authorization: Bearer $DEPLOY_TOKEN" -H 'Content-Type: application/json' \
  --data "$MISSING_BODY"

curl -fsS -X PUT "$BACKEND_URL/api/v1/games/$GAME_ID/blobs/$INDEX_HASH" \
  -H "Authorization: Bearer $DEPLOY_TOKEN" -H 'Content-Type: application/octet-stream' \
  --data-binary "@$INDEX_FILE"
curl -fsS -X PUT "$BACKEND_URL/api/v1/games/$GAME_ID/blobs/$MODEL_HASH" \
  -H "Authorization: Bearer $DEPLOY_TOKEN" -H 'Content-Type: application/octet-stream' \
  --data-binary "@$MODEL_FILE"

RELEASE_BODY=$(jq -cn --arg ih "$INDEX_HASH" --argjson iz "$INDEX_SIZE" \
  --arg mh "$MODEL_HASH" --argjson mz "$MODEL_SIZE" \
  '{files:{"index.html":{sha256:$ih,size:$iz},"models/tiny.glb":{sha256:$mh,size:$mz}},message:"remote first release"}')
FIRST_RELEASE=$(curl -fsS -X PUT "$BACKEND_URL/api/v1/games/$GAME_ID/releases" \
  -H "Authorization: Bearer $DEPLOY_TOKEN" -H 'Content-Type: application/json' \
  --data "$RELEASE_BODY")
FIRST_HASH=$(printf '%s' "$FIRST_RELEASE" | jq -r .release_hash)

curl -i "$PREVIEW_URL"
curl -i -H 'Range: bytes=0-3' "$GATEWAY_URL/$SLUG/models/tiny.glb"
curl -i -H "If-None-Match: \"$INDEX_HASH\"" "$PREVIEW_URL"

SECOND_BODY=$(jq -cn --arg ih "$INDEX_HASH" --argjson iz "$INDEX_SIZE" \
  '{files:{"index.html":{sha256:$ih,size:$iz}},message:"remote remove model"}')
curl -fsS -X PUT "$BACKEND_URL/api/v1/games/$GAME_ID/releases" \
  -H "Authorization: Bearer $DEPLOY_TOKEN" -H 'Content-Type: application/json' \
  --data "$SECOND_BODY"
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' "$GATEWAY_URL/$SLUG/models/tiny.glb"
curl -fsS -X POST "$BACKEND_URL/api/v1/games/$GAME_ID/releases/$FIRST_HASH/activate" \
  -H "Authorization: Bearer $DEPLOY_TOKEN"
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' "$GATEWAY_URL/$SLUG/models/tiny.glb"

SMOKE_USER="remote$(date +%s)"
SMOKE_EMAIL="$SMOKE_USER@example.com"
SMOKE_PASSWORD=$(openssl rand -base64 24)
ACCOUNT_JSON=$(curl -fsS -X POST "$BACKEND_URL/api/v1/auth/register" \
  -H 'Content-Type: application/json' \
  --data "$(jq -cn --arg e "$SMOKE_EMAIL" --arg u "$SMOKE_USER" --arg p "$SMOKE_PASSWORD" '{email:$e,username:$u,password:$p}')")
PLATFORM_TOKEN=$(printf '%s' "$ACCOUNT_JSON" | jq -r .token)
CLAIM_BODY=$(jq -cn --arg secret "$CLAIM_SECRET" '{secret:$secret}')
curl -fsS -X POST "$BACKEND_URL/api/v1/games/$SLUG/claim" \
  -H "Authorization: Bearer $PLATFORM_TOKEN" -H 'Content-Type: application/json' \
  --data "$CLAIM_BODY"
curl -fsS -X DELETE "$BACKEND_URL/api/v1/games/$GAME_ID" \
  -H "Authorization: Bearer $PLATFORM_TOKEN"
```

Trimmed responses:

```text
POST /api/v1/new-game/remote-smoke-1788985855 -> HTTP 201
{
  "game_id": "e59c044a-7ac9-4fce-a480-c562b215bff2",
  "slug": "remote-smoke-1788985855",
  "name": "Remote Smoke",
  "state": "open",
  "expires_at": "2026-09-10 08:30:57",
  "preview_url": "https://blitz-game-gateway.blitzapp.workers.dev/remote-smoke-1788985855/",
  "deploy_token": "[REDACTED]",
  "claim_secret": "[REDACTED]",
  "claim_url": "https://blitz-backend.blitzapp.workers.dev/api/v1/games/remote-smoke-1788985855/claim"
}

POST blobs/missing -> HTTP 200
{"missing":["0869fd26ce63d0cdfab4d9005413cbcc43e0b9e9eae55695a2f45e9d67177d89","887517902c5efefdb6c65d5d95b3043f8b99a80eaf5c143c7e247871cd3f13bd"]}

PUT index blob -> HTTP 201
{"sha256":"0869fd26ce63d0cdfab4d9005413cbcc43e0b9e9eae55695a2f45e9d67177d89","size":99,"uploaded":true}

PUT GLB blob -> HTTP 201
{"sha256":"887517902c5efefdb6c65d5d95b3043f8b99a80eaf5c143c7e247871cd3f13bd","size":5,"uploaded":true}

PUT first release -> HTTP 201
{"release_hash":"a723b6964aff1caafa350ad75a0ce1cc0e28f9c5e58aec8d93f552478b4abf01","files":{"index.html":{"sha256":"0869...7d89","size":99},"models/tiny.glb":{"sha256":"8875...f13bd","size":5}}}

GET preview -> HTTP 200
content-type: text/html; charset=utf-8
content-length: 99
content-encoding: identity
etag: "0869fd26ce63d0cdfab4d9005413cbcc43e0b9e9eae55695a2f45e9d67177d89"
accept-ranges: bytes
cache-control: public, max-age=60, must-revalidate
x-content-type-options: nosniff

GET models/tiny.glb, Range: bytes=0-3 -> HTTP 206
content-type: model/gltf-binary
content-length: 4
content-range: bytes 0-3/5
etag: "887517902c5efefdb6c65d5d95b3043f8b99a80eaf5c143c7e247871cd3f13bd"
body: glTF

GET preview, If-None-Match -> HTTP 304
etag: "0869fd26ce63d0cdfab4d9005413cbcc43e0b9e9eae55695a2f45e9d67177d89"

PUT second release -> HTTP 201
{"release_hash":"000656ddd830bd410e974c96b6aae02690b0e9f5009e4dd349153ee09a709cdd","files":{"index.html":{"sha256":"0869...7d89","size":99}}}

GET removed models/tiny.glb -> HTTP 404
POST activate/a723...bf01 -> HTTP 200
{"release_hash":"a723b6964aff1caafa350ad75a0ce1cc0e28f9c5e58aec8d93f552478b4abf01","files":2}
GET restored models/tiny.glb -> HTTP 200

POST auth/register -> HTTP 201
{"user":{"id":"GuGJmeEZTiiehwbfCpdPgg"},"token":"[REDACTED]","refresh_token":"[REDACTED]"}

POST claim -> HTTP 200
{"game_id":"e59c044a-7ac9-4fce-a480-c562b215bff2","slug":"remote-smoke-1788985855","owner_id":"GuGJmeEZTiiehwbfCpdPgg","claimed":true}

DELETE game -> HTTP 200
{"deleted":true,"game_id":"e59c044a-7ac9-4fce-a480-c562b215bff2","slug":"remote-smoke-1788985855"}
GET preview after delete -> HTTP 404
```

The first end-to-end pass exposed workers.dev removing a strong ETag from compressible HTML while still honoring the Worker-generated 304. The gateway was changed to identity encoding and redeployed. A second real create/publish probe produced the `200` and `304` ETag headers shown above. That probe game was also deleted.

The claimed smoke game was deleted through `DELETE /api/v1/games/:id`. The disposable user was then removed by exact ID from the new D1 database. Shared smoke blobs were intentionally retained.

## 7. Deployment and rollback

Deployed URLs:

- Backend: `https://blitz-backend.blitzapp.workers.dev`
- Game gateway: `https://blitz-game-gateway.blitzapp.workers.dev`

Current versions:

- Backend: `3acbf658-d8f7-4b3f-b5f3-972dd0f41781`
- Game gateway: `b11b6b32-d8a4-426d-9c29-0982049e4b05`

Redeploy commands:

```sh
cd /Users/minjunes/blitz/backend
npx wrangler deploy

cd /Users/minjunes/blitz/game-gateway
npx wrangler deploy
```

Do not pass `--config wrangler.prod.jsonc` until the existing domain routes are detached and explicitly approved.

Version inspection and exact rollback commands to the immediately preceding known-good copies of the final code:

```sh
cd /Users/minjunes/blitz/backend
npx wrangler versions list
npx wrangler rollback c5f01d1c-64f7-4448-92e1-3650e58e40f9 --yes --message "Rollback blitz-backend"

cd /Users/minjunes/blitz/game-gateway
npx wrangler versions list
npx wrangler rollback 8a678400-c458-44df-8e0a-b31b10882575 --yes --message "Rollback blitz-game-gateway"
```

The rollback commands are documented but were not executed.

## 8. Known gaps and judgment calls

- Blob GC is intentionally out of scope. Expiry and explicit game deletion remove games, releases, and tokens, but never remove shared R2 objects. `backend/BLOB-GC.md` outlines a future mark-and-sweep design.
- Google authentication is off. The active surface is email/password register, login, and me. No Google client ID is required.
- `bytes_used` is the sum of file sizes in the active manifest. Uploading an unattached blob does not consume a game's quota. The same hash used at multiple manifest paths is counted once per path. There is no per-owner physical-storage or bandwidth quota.
- Uploads require `Content-Length`. This allows the Worker and account limit to reject an oversized streamed body before sending it to R2. R2's native SHA-256 checksum validation provides atomic mismatch rejection.
- Manifest bodies are stored in D1. There is no R2 manifest-pointer mode yet.
- Gateway manifest caching uses a bounded 128-entry isolate-memory map keyed by release hash. It does not use the distributed Cache API.
- The npm 0.0.14 package declares Wrangler as a dependency. `npm audit --omit=dev` therefore reports four high-severity findings through `wrangler -> miniflare -> sharp`. The Worker bundle is tree-shaken and the live path passed, but the upstream dependency graph should be refreshed when teenybase publishes a newer compatible release.
- Strong HTML ETags on workers.dev required `Content-Encoding: identity`; otherwise the edge removed the strong header during automatic transformation. The final remote 200/304 proof includes the exact SHA-256 ETag.
- No production route was deployed. Intended routes remain only in the warning-marked `wrangler.prod.jsonc` files.
