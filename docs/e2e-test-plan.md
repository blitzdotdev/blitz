# E2E gate before the blitz.dev cutover

Status: plan, revised late 2026-09-09 for the final architecture: the editor runs only from `blitz dev`, blitz.dev is the store, the cloud lives in the private repo. Every row is a pass or fail with evidence. The cutover waits for a full pass.

## Test domains

- Editor: local, from `blitz dev` at `http://127.0.0.1:<port>/?t=<token>`. No hosted editor. The `blitz-editor` worker on workers.dev is a leftover test artifact to delete.
- Backend and store: `https://blitz-backend.blitzapp.workers.dev` (repo blitz-cloud).
- Gateway, path mode: `https://blitz-game-gateway.blitzapp.workers.dev/<slug>/`.
- Gateway, host mode: needs one custom domain on the blitz.dev zone, for example `<slug>.games.blitz.dev` with `APP_DOMAIN=games.blitz.dev`. A wildcard needs a DNS record the wrangler token cannot create; a single custom domain wrangler can create itself. Additive, does not touch the teenybase routes.

## Automated suites that count as evidence

| Suite | Command | Repo |
|---|---|---|
| Server: manifest, MIME, ETag and If-Match, path guards, token and Host rejection, SSE classification | `npm run test:blitz` | blitz |
| Publish module: walk exclusions, manifest parity golden, index.html import map, deploys.json, publish order, pull | `npm run test:publish` | blitz |
| Runtime: createGame boots scripts, main, nested assets | `npm run test:runtime` | blitz |
| Editor against a real `blitz dev`: project load, script hot reload, scene save round trip at `mainScene`, play mode, state file | `npm run test:editor` | blitz |
| Backend: anonymous games, blobs, releases, GC, retention, reconciliation, slug check, runtime registry, claim, storefront listing rule, PATCH | `npm run test:backend` | blitz-cloud |
| Gateway: MIME, range, ETag, spinner, CORS | `npm run test:gateway` | blitz-cloud |
| Live agent path: curl-only publish of the sample project plays on workers.dev, stale base 409, pull | `packages/blitz/test/live-e2e.sh` | blitz |

## 1. Editor

| # | Step | Expect |
|---|---|---|
| E1 | `blitz init`, `blitz dev`, open the URL | Editor loads the project. No console errors. |
| E2 | `blitz init` output | `package.json` with the `@blitzdev/blitz` devDependency, `assets.json`, `main.js`, `assets/`, `AGENTS.md`, `.gitignore` with `.blitz/` paths. |
| E3 | Restart `blitz dev` in an existing project | Loads the same project. |
| E4 | Add a `.script.js` from an external editor | Component type appears in the editor without a manual refresh, via the server event stream. |
| E5 | Attach the component, press play, stop | Update runs in play. Stop restores the scene. |
| E6 | Save scene | `assets/main.scene.glb` written. Backup and thumbnail under `.blitz/`. |
| E7 | Drop a glb into the canvas | Asset in `assets/`, entry in `assets.json`, loads via `/blitz/@id/`. |
| E8 | Asset library panel | Polyhaven list loads through the deployed asset proxy. |
| E9 | Reload the editor tab | Project reopens with no prompt. |
| E10 | Existing Playwright suite in `packages/editor/tests` | Passes, or each failure is triaged as pre-existing. |

## 2. Publish from the editor (Phase B)

| # | Step | Expect |
|---|---|---|
| P1 | Open game, slug prefilled | Availability shows free, taken, reserved, invalid as typed. |
| P2 | Create live game | New tab opens at once. Spinner page 503 with `X-Blitz-State`. Progress from the local server. Game plays when the release lands. |
| P3 | `.blitz/deploys.json` | Entry with token, secret, URL, expiry. Gitignored. |
| P4 | Publish update after a script change | New release hash. Reload shows the change. Old release listed. |
| P5 | Slug taken race | 409 returns to the slug field, blank tab closed. |
| P6 | Popup blocked | Link shown in the dialog. |
| P7 | Network loss during hashing | Dialog stays open with retry. Nothing sent. |
| P8 | Upload fails mid-way, retry | Spinner keeps polling. Retry completes with deduped blobs. |
| P9 | Sign in with email, then Google, then claim | Claim clears expiry. The dialog shows no expiry. |
| P10 | Copy prompt | Text contains the slug and no secrets. |

## 3. Agent path

| # | Step | Expect |
|---|---|---|
| A1 | Follow `docs/publish-api.md` with curl on a real project | Game plays at the preview URL in path mode. |
| A2 | Same game in host mode | Plays at `https://<slug>.games.blitz.dev/`. Relative paths hold in both modes. |
| A3 | `GET /api/v1/runtimes/<editor version>` | Returns the sha256 that the release references. |
| A4 | Fork with `?source=` | New game plays. `blobs/missing` reports nothing missing. |

## 4. Backend on the real deployment

| # | Step | Expect |
|---|---|---|
| B1 | Set `expires_at` in the past on a test game with `d1 execute` | Within two minutes: 410, then 404 after cleanup. Rows gone. |
| B2 | Age a test blob's `created_at` past the grace period | Next sweep deletes the R2 object and the row. |
| B3 | Runtime blob aged the same way | Never swept. |
| B4 | Delete a game that shares blobs with a fork | Refcounts drop by one. Objects stay. |
| B5 | Token of game A used on game B | 401 or 404, never data. |
| B6 | Claim secret used twice | Second use 403 or 409. |
| B7 | 11 creates from one IP in a minute | 429 on the 11th. |
| B8 | Manifest path with `..`, backslash, or leading slash | 400. |
| B9 | Upload without `Content-Length`, with wrong hash, over the limit | 411, 422, 413. No residual object. |
| B10 | Reconciliation cron after an orphan object is put in R2 | Row created, then swept after grace. |

## 5. Gateway on a real zone (host mode)

| # | Step | Expect |
|---|---|---|
| G1 | HTML with `If-None-Match` | 304 with the SHA-256 ETag intact through Cloudflare. |
| G2 | Range request on a file over 50 MB | 206 with the right `Content-Range`. |
| G3 | New release, then request within 60 s | Old body at most 60 s, then new. |
| G4 | Unknown slug, cleaning game, expired game | 404, 410, 410. |
| G5 | Every MIME in the table | Correct `Content-Type`, `nosniff` present. |

## 6. Regression suites

- `npm run test:backend`, `npm run test:gateway`, `npm run test:runtime`, the Phase B dialog tests, and `packages/editor/tests`.
- Run them before and after each deploy to the test domains.

## Exit rule

All rows pass, or each failure has an issue with an owner. Then the cutover: attach `blitz.dev` to `blitz-backend` (the store and the API) and `*.app.blitz.dev/*` to `blitz-game-gateway` from the prod configs, and set `APP_DOMAIN=app.blitz.dev`. See `docs/storefront-plan.md` for the domain map.
