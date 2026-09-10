# Review of the NOW items in PLAN.md

Date: 2026-09-09. Code reviewed: threepipe-blueprint-editor @ 342be7f, threepipe @ 52c3ec1, uiconfig-blueprint @ 82cf3d0, and the teenybase monorepo at ~/superapp/teenybase. Paths are relative to each repo. Line numbers are from the unrenamed commits.

This file is a review, not the plan. PLAN.md stays the source of truth.

## Status board (2026-09-09, evening)

BUILT means done, verified, and on `main` unless a branch is named. RUNNING means a Codex pass is on it now. UNBUILT means not started. This board is the source of truth for what exists; the sections below are the review.

| Item | Status | Evidence |
|---|---|---|
| Workspace: one repo, subtrees for threepipe and uiconfig-blueprint, `packages/editor`, `services/*`, root build and typecheck | BUILT | `git log` on main; `npm run build`, `npm run typecheck` pass |
| Rename Kite to Blitz; MCP bridge and in-editor AI chat removed; `.blitz/` gitignore paths fixed | BUILT | commit `42fa7a9`; tsc and vite build pass |
| Editor online | BUILT | https://blitz-editor.blitzapp.workers.dev/ ; headless load shows zero console errors, service worker registered |
| Games backend on workers.dev: anonymous 12 h games, rate limits, `tp_` tokens, claim with secret, email sign-in, content-addressed blobs, releases with activate, fork by `source`, delete, expiry and cleanup crons | BUILT | https://blitz-backend.blitzapp.workers.dev ; 17 local tests; curl walkthrough in `docs/backend-build-report-2026-09-09.md` |
| Game gateway on workers.dev: path mode, MIME map, ETag and 304, Range and 206, lazy expiry 410, 404 | BUILT | https://blitz-game-gateway.blitzapp.workers.dev/<slug>/ |
| API contract for agents | BUILT | `docs/publish-api.md` |
| E2E gate plan | BUILT (plan only) | `docs/e2e-test-plan.md` |
| Blob GC: refcounts, ten-release retention, 24 h grace sweep, daily reconciliation, runtimes as roots | BUILT | commit `d8e9aec`; live on workers.dev; 12 integration tests; design in `services/backend/BLOB-GC.md` |
| Slug check `GET /api/v1/slugs/:slug`; spinner page for a game without a release; runtime registry `PUT/GET /api/v1/runtimes/:version`; Google sign-in with the teenyapp client id | BUILT | commits `dbd5be3`, `ac43e74`, `af38c90`; verified live; Google needs the editor origin in the OAuth client |
| Phase A runtime: `createGame({base, canvas})`, `dist/runtime.js` (2.75 MiB, plugins bundled), sample project, Playwright runtime test with two negative controls, `main.js` text in the AGENTS template | BUILT, merged into main | commits `26d4fa1`, `973bea0`; test passes; note: editor play mode does not run `main.js`, only the published runtime does |
| NOW-1 as rebuilt by C1: `blitz dev` local server watches the folder, serves files with hashes and `If-Match`, streams change events with writer ids; the editor uses one `DevServerSource`; File System Access, IndexedDB, service worker, fetch proxy deleted; play mode through `createGame` | BUILT, merged | merge `0baecd5`; suites: 12 server tests, editor Playwright against a real `blitz dev`, runtime, publish; my manual run of init, dev, PUT, SSE, 401, traversal |
| NOW-1 IndexedDB | DONE by deletion | no IndexedDB remains in the editor |
| Version pinning | BUILT differently | the project pins `@blitzdev/blitz` as a devDependency; `npx blitz` runs that version; no bootstrapper |
| Journal and agent mirrors | BUILT | journal in C2a; `.blitz/state.json` and `.blitz/console.log` written by the editor through the dev server (C1) |
| NOW-2 as revised (C2a): deterministic text glTF at `mainScene` with external `.bin` and hashed textures, validation with errors to `.blitz/console.log`, `Generator` component with generated children excluded from export, scoped `blitz bake` with refusal rules, `.blitz/journal.jsonl` semantic diff of human edits, `blitz journal`, agent docs | BUILT, merged | commits `52b73b7`..`1a49f93`; 19 server tests, 2 editor Playwright tests, runtime test |
| Phase B part 1: framework-free publish module (walk, hash, manifest, index.html with relative paths, API client, deploys.json, publish and pull orchestration), `agents.md` served with a page pointer, slug-or-id lookup, `base_release` guard, pull endpoints, gateway CORS, runtime registration on deploy | BUILT, merged | commits `aa5568f`..`cb32c12`; live proof: curl-only publish of the sample project plays on workers.dev; package-pinned runtime registered |
| Phase B part 2 (C2b): "Open game" publish and claim dialog in the local editor through server proxies (slug check, register, login, claim, deploys, publish with SSE progress); CLI polish: `--help` everywhere, unknown flags rejected, `publish --slug --name --message`, `blitz status`, `blitz claim` | BUILT, merged | commits `72995c4`..`448fe1c`; 25 server tests, 3 editor Playwright tests; live publish from a temp project proven |
| Follow mode and the hosted editor | DROPPED (evening) | no hosted editor; the editor runs only from `blitz dev` |
| Storefront (phase D): listed and description columns, listing rule, server-rendered grid with 60 s edge cache, public JSON list, PATCH unlist, thumbnail convention, `agents.md` and `llms.txt` served by the backend, runtime DELETE | BUILT, merged | commit `c059f4e`; live at https://blitz-backend.blitzapp.workers.dev/ ; verified: anonymous games never listed |
| Runtime handler API: scripted input, tick stepping (plan DEFER) | UNBUILT | |
| Agent connection: websocket or CLI (plan DEFER) | UNBUILT | |
| Open-source split: `@blitzdev/engine`, `@blitzdev/editor`, `@blitzdev/blitz`, `@blitzdev/template`, Apache-2.0, `src/` shipped | BUILT as packages, NOT on npm yet | packaging proof: `npm pack` + local install + `blitz init` + `blitz dev` + `blitz sources` (threepipe src present); publishing to npm is one command on your go |
| `services/asset-library-proxy` deployed for the editor's asset library | UNBUILT | worker not created |
| Blitz logo and artwork | UNBUILT | editor still shows the kite artwork |
| Per-game backend logic on D1 (auth, economy) | UNBUILT | later |
| Staging wildcard `*.games.blitz.dev` and `editor-staging.blitz.dev` for host-mode tests | UNBUILT | proposal in `docs/e2e-test-plan.md` |
| E2E gate execution | UNBUILT | after the running passes and Phase B |
| Live agent path with the real command: `blitz init`, `blitz publish` (8 files, release, live URL), headless load shows the viewer with zero console errors | BUILT, proven | run by the reviewer on 2026-09-09 late evening against the sandbox backend; test game deleted afterwards |
| Release tooling: `scripts/set-version.mjs` (lockstep version + exact pins + lock refresh), `scripts/release.mjs` (dry run by default; publish in dependency order with `--access public`; runtime registration; tag), root scripts `release:dry`, `release`, `release:patch/minor/major`, `version:set`; GitHub Actions `ci.yml` (all suites) and `release.yml` (on `v*` tags, needs NPM_TOKEN, RUNTIME_UPLOAD_TOKEN, BLITZ_BACKEND_URL secrets); `docs/releasing.md` | BUILT, merged | commit `f7a1969`; `npm run release:dry` passes: 4 tarballs, src and dist included, no secrets or test junk; nothing published yet |
| Pass E: versions from manifests (`/api/state` reports blitz, editor, engine), `BLITZ_SERVER_CLIENT_ID` constant, `blitz init` copies the whole template with stamped versions, version pin rule (delegate to the project's installed `blitz`, refuse when missing, `BLITZ_IGNORE_VERSION_PIN` bypass), `blitz publish` uses the project pin, `blitz upgrade` with migrations and journal, dev server on Hono `LinearRouter`, gateway accepts local editor origins, asset library proxy deployed | BUILT, merged | merge `837f968`; 34 server tests, 8 publish, runtime, 3 editor; proxy at https://blitz-asset-library-proxy.blitzapp.workers.dev |
| CI lock file fix: patched `@types/three` as a root devDependency with the override scoped to threepipe; CI and release use `npm install --ignore-scripts` on npm 11.19 | BUILT | commit `9646204`; fresh-clone install verified on npm 10 and 11 |
| Runtime registry hygiene: 0.12.0 re-registered with the current build (`4c2d97fb…`, 2,915,976 bytes) after the real-user run hit a stale runtime | DONE, root cause open | the registry is keyed by version; engine changes without a bump go stale; fix pass F makes publish ship the project's installed runtime bytes |
| Real-user E2E: a fresh agent with only the paste-ready prompt built and published "Target Rush", a playable FPS, in 57 minutes | DONE; session review running | live at https://blitz-game-gateway.blitzapp.workers.dev/fps-shooter/ (12 h anonymous); ten reported problems feed fix pass F |
| Fix pass F for the real-user E2E findings: non-semver pins resolve from the installed package; publish ships the installed runtime bytes; one shared import map for dev and published games with `@blitzdev/*` and non-semver specs skipped; script hot reload with cache busting and forced re-registration; editor play mode uses its own engine graph (no duplicate three.js); safe `pull` with `--force`; name kept on updates; favicon; Play gated on load with one update loop; free-port selection; console forwarding to `.blitz/console.log`; publish excludes and `blitz.publish.exclude` | BUILT, merged | commit `71483c7`; 52 server tests, 18 publish, runtime 6+1, 4 editor Playwright; review in `docs/e2e-session-review-2026-09-10.md` |
| Private repo split: `services/` moved to `/Users/minjunes/blitz-cloud` with filtered history; monorepo without services still builds; backend deploys from the new repo | BUILT, on GitHub (private): https://github.com/blitzdotdev/blitz and https://github.com/blitzdotdev/blitz-cloud | monorepo commit `1650bda`; cloud repo 14 commits; caveat: the cloud backend serves a COPY of `docs/agents.md`; sync it from the published `@blitzdev/template` once packages are on npm |
| Domain cutover: `blitz.dev` to the store, `editor.blitz.dev` to the editor, `*.app.blitz.dev` to the gateway | BLOCKED | another agent detaches the domains from teenybase; then gated on the E2E pass; map in `docs/storefront-plan.md` |
| Google Cloud: add editor origins to the OAuth client | USER ACTION | client id `118090436804-rqddo4q5qof92bejmslrrtglnrtb23k1.apps.googleusercontent.com` |

### Plan items mapped to the board

| Plan item | Status | What is built | What is not |
|---|---|---|---|
| NOW-1 Project source of truth | UNBUILT | folder-backed projects and script hot reload existed before this work | whole-folder watcher, hash echo, conflict rule, scene and asset reload, IndexedDB trim, exact version and bootstrapper, undo journal, agent mirror files |
| NOW-2 glb to glTF | UNBUILT | nothing; the scene is still `assets/main.scene.glb` | text glTF, no binary in the scene, stable names, deterministic output, validation, threepipe `.bin` exporter option |
| NOW-3 Publishing | SERVER BUILT, CLIENT UNBUILT, DOMAIN BLOCKED | anonymous game creation, 12 h expiry, claim on sign-in, blobs in R2, manifests in D1, serving at the workers.dev path URL, forks for parallel versions, the curl contract | the editor "Open game" button and deploy client (Phase B), the generated `index.html` and the runtime that makes a release play (Phase A running, Phase B), the `<game>.app.blitz.dev` host form (cutover blocked), follow mode |
| DEFER Runtime state controller | LOAD HALF RUNNING | `createGame` load-and-run is Phase A | handler API: scripted input, tick stepping |
| DEFER Agent connection | UNBUILT | file-based mirrors are proposed in NOW-1 | websocket or CLI |

### Status update, 2026-09-10 morning

- Anti-slop reviews done in both repos; deslop passes applied 30 of 31 public findings (`ProjectSource` kept for the planned cloud source) and all 26 cloud findings, including the manifest-derived blob sweep that replaced refcounts (migrations 0003 and 0004 applied to production, all three workers redeployed, live smoke passed).
- Second real-user E2E run built and published FPS Drill; session review in `docs/e2e-session-review-2026-09-10-run2.md`: 11 of 17 earlier findings fixed, 15 new findings G1 to G15, none blocking. Runtime registry re-registered (G4). E2E agents' memory notes moved into the repo so later runs start fresh.
- Found that the C1 pass (commit a2b7ebf) had replaced the entire upstream editor UI with a 525-line minimal app. DONE: the upstream editor is restored on the dev-server source (merge `11b0a01`): 57 components, Open game beside Play, play through `createGame` on an overlay, text glTF save, agent plumbing kept. Verified by suites and a headless screenshot.
- DONE: fix pass G (merge `0855660`): all 15 run-2 findings plus the F residuals fixed, `blitz check` (paths, imports, component types, generators) gates publish, `blitz status` shows the live dev server, credentials hidden from file APIs, viewport chrome parity restored, AGENTS template consolidated with the verified gotchas, `docs/agents.md` generated from it. 62 CLI tests, 7 editor Playwright tests.
- DONE: P1 (merge `08df708`): `packages/engine/src/authoring.ts` (roles direct, template, generator; `RuntimeObjectOwner`), `authoringValidation.ts` (quality, cleanup, persistence reports with the failure codes; 12-fixture matrix), `blitz check` with Playable, Editable, Persisted headless or through the open editor, result cards in the editor, AGENTS rules. Verified on a copy of FPS Drill: all three outcomes pass.
- DONE: cloud runtime registry keyed by hash (cloud `a5840f5`, migration 0005, deployed).
- RUNNING: P3 publish hardening, `/api/publish` progress over SSE, the publish and claim dialog states, the check fallback when an old dev server is running (branch `p3-publish`). Then P2, P5, P6, P4, then E2E run 3 and the gate.

Build order agreed (revised, evening): Phase A done, Phase B part 1 running, then C1 blitz command, local dev server, editor source, then C2 cloud source, dialog, glTF model. See `docs/local-dev-server-plan.md`.

## 0. Findings that change all three items

### 0.1 The manifest is package.json, not kite.json

- `settingsKey = "kite"` names a nested block in package.json (`plugins`, `imports`, `scripts`, `viewer`). It also sets the asset URL prefix `/kite/` and the folder `.kite/`. `src/utils/project.ts:6-12`, `src/utils/project.ts:286-335`
- `kite.json` exists only as a filename the file panel refuses to open. `src/components/FilesPanel.tsx:523-527`
- So "add the engine version in manifest" means: add it under the `blitz` block in package.json. After the rename the block, the URL prefix, and the folder all become `blitz`.
- Bug: the generated .gitignore lists `./kite/backups`, `./kite/running`, `./kite/thumbs` (no leading dot). The code writes `.kite/...`. Projects commit their backups and thumbnails. `src/data/projectTemplates.ts:55-61`, `src/utils/projectUtils.ts:128-131`, `src/utils/PlayModeHelper.ts:47`

### 0.2 Removing MCP removes the only live-state channel

- The bridge exposed 22 tools: scene hierarchy, selection, focus, play/stop, editor state, project info. `scripts/mcp-tools.mjs:5-337`
- After removal, agents can only write files. They cannot see runtime errors, play state, or what the human selected.
- Cheapest replacement, no protocol: the editor writes read-only mirror files into `.blitz/`. `state.json` (editor version, play state, selection, last load error) and `console.log` (runtime console and errors, rotated). Agents read them after each edit. The scene hierarchy needs no mirror. The scene file is the hierarchy.
- This is a small addition to NOW-1. It gives agents a feedback loop until the deferred agent connection exists.

### 0.3 The loading half of createGame() is not deferrable

- Publishing needs a page that boots a project from a URL. No such runtime exists today.
- The standalone generator does not register project scripts before the scene loads, and its plugin codegen has a scoping bug. `src/utils/project.ts:396-451`
- `player.ts` destructures `{viewer}` from a Promise and `public/player.html` never imports it. `src/player.ts:50-62`, `public/player.html:21-24`
- Editor play mode works, but inside the editor viewer. `src/utils/PlayModeHelper.ts:20-109`
- Recommendation: split the deferred item. NOW: `createGame({ source, canvas })` that loads and runs a project from a directory handle or a base URL. DEFER: the handler API (scripted input, tick stepping).

## 1. Project source of truth (NOW)

### What exists

- Projects are already folder-backed. "Open folder" calls `showDirectoryPicker({mode: "readwrite"})`, keeps the handle, and writes through `FileSystemWritableFileStream`. Nothing is copied into IndexedDB. `src/components/WelcomeDialogCreateProjectActions.tsx:19-70`, `src/utils/fsApi.ts:4-75`
- IndexedDB stores the recent-project list, directory handles, metadata, fallback single-file projects, and previews. `src/utils/BrowserFileStore.ts:5-42`, `src/utils/project.ts:119-180`
- Script hot reload exists. It uses `FileSystemObserver` when the browser has it, drains events every 2 s, and has no fallback. `src/utils/ScriptUtil.ts:577-605`
- `/kite/@id/...` asset URLs resolve through a `fetch` monkey-patch and object URLs. `src/utils/FetchProxy.ts:9-51`, `src/utils/ViewerInstanceManager.ts:1098-1142`
- Modules load through the `/fs/` service worker. `src/utils/fsImporter.ts:6-85`, `public/fs-sw.js:1-39`

### Status of the five "on change" bullets

| Bullet | Status | Evidence |
|---|---|---|
| scripts -> auto-reload | partial: only registered roots and their deps, only with FileSystemObserver | `src/utils/ScriptUtil.ts:235-305` |
| settings/asset-map -> re-read | partial: handlers exist, files are not observed, settings apply is a TODO, asset map only swaps the parsed manifest | `src/utils/ViewerInstanceManager.ts:1303-1343`, `src/utils/ProjectSettingsManager.ts:128-175` |
| scene file -> reload | missing: `reloadScene` is a TODO, load returns early for the current file | `src/utils/ViewerInstanceManager.ts:1602-1623`, `:1817-1819` |
| assets -> refetch on next use | missing end to end: `AssetTracker` can update, nothing calls it on disk change | `src/utils/AssetTracker.ts:304-328` |
| ignore own echo | partial: sender-id suppression across tabs only, no content or version compare | `src/utils/fsApi.ts:77-103`, `src/utils/ViewerInstanceManager.ts:145-179` |

### Recommendations

1. **One project watcher, one event bus.** Move watching out of ScriptUtil into the project layer. Use `FileSystemObserver` on the project root when present. Otherwise poll a small set: package.json, assets.json, the scene file, and registered scripts. Compare `lastModified` and size. Emit `{path, kind, hash}`. Scripts, settings, scene, and assets subscribe. Keep the 2 s debounce. Assets stay lazy: mark stale, refetch on next use, as the plan says.
2. **Echo suppression by content hash.** On every editor write, keep `sha256(bytes)` per path. On a change event, hash the file. Equal means echo, ignore. Different means external change. Sender ids cannot tell an echo from an agent write that landed in between. Also make writers bump `assets.json.version`. Today they do not. `src/utils/ViewerInstanceManager.ts:792-834`
3. **Add a conflict policy. The plan has none.** "Scene file -> reload" discards unsaved human edits. Rule: not dirty, reload silently. Dirty, keep the editor state and show "changed on disk: reload or keep mine". Never write a file whose on-disk hash differs from the hash last read. On mismatch, reload and ask. Debounce scene writes to transaction ends (pointer up, property commit), never per frame.
4. **IndexedDB: remove as a project store, keep for handles.** Directory handles persist only in IndexedDB. Without it the user picks the folder again after every reload and the recent list is gone. Keep two records: recent projects and their handles. Delete the fallback single-file store, previews, and chat history. Thumbnails already live in `.blitz/thumbs`.
5. **Exact version in the manifest, and a bootstrapper.** Write `"blitz": { "version": "<exact-version>" }` in package.json. Today the template writes `"threepipe": ">=0.4.2"` and standalone generation falls back to `threepipe@latest` from esm.sh, so the same files run on different engines over time. `src/data/projectTemplates.ts:27-40`, `src/utils/project.ts:346-360`. The deploy script already uploads `versions/<editor version>/` to R2. `scripts/upload-r2.mjs:27-37`. The missing piece is a small bootstrapper page at blitz.dev. It reads package.json from the picked folder first, then loads `/editor/<version>/`. Policy: exact match. Newer than available: error. Older: offer "upgrade project", which rewrites the version and runs migrations. One version string covers editor, engine, runtime, template, and agents.md.
6. **Undo via a file-level journal, with the in-memory stack as a cache.** Today undo is the engine `UndoManagerPlugin` over `JSUndoManager`: closures, 1000 commands, not serializable, registered ad hoc in UI paths, no central mutation layer, and nothing clears it on project load. `threepipe/src/plugins/interaction/UndoManagerPlugin.ts:15-125`, `src/utils/ViewerInstanceManager.ts:1662-1725`. Instrumenting every mutation into serializable commands is a large refactor. Instead record undo at save granularity: `.blitz/journal.jsonl` with `{ts, path, beforeHash, afterHash, patch}` for every file the editor writes. Undo applies the reverse patch only if the current hash equals `afterHash`. Otherwise it refuses with "changed since". Keep the in-memory stack for edits between saves. Answer to the plan's question: yes, keep it, as a cache. Agent edits are not undoable by the editor. Agents own their git history. Bonus: agents can read the journal to see what the human did.

### Risks

- `FileSystemObserver` and `showDirectoryPicker` are Chromium APIs. The editor is Chrome-only by design. Check the current Chrome status of `FileSystemObserver` for local directories before relying on it. The code already guards for its absence. `src/utils/ScriptUtil.ts:600`
- Requiring `readwrite` permission during resolution blocks read-only opens. `src/utils/project.ts:142-164`

## 2. main.scene.glb to glTF (NOW)

### What exists

- Save exports `viewer.scene.modelRoot` with `preserveUUIDs: true`, `viewerConfig: true`, binary for `.glb`. `src/utils/ViewerInstanceManager.ts:868-941`
- The exporter can emit JSON. JSON output is one blob: the buffer becomes a base64 data URI and images become data URLs. `threepipe/src/assetmanager/export/GLTFWriter2.ts:122-165`, `threepipe/src/assetmanager/export/GLTFExporter2.ts:138-187`
- Custom extensions: `WEBGI_object3d_extras`, `WEBGI_material_extras`, `WEBGI_light_extras`, `WEBGI_viewer` (viewer settings plus plugin `toJSON()`). Entity components travel as `userData.EntityComponentPlugin` = `{ id: {type, state} }`. Script source is not embedded. `threepipe/src/assetmanager/gltf/*.ts`, `threepipe/src/plugins/extras/EntityComponentPlugin.ts:200-259`
- Referenced assets (`assets/*.glb`) are stored as a reference plus overrides. Editor-created primitives embed geometry. Cross-asset material and geometry restoration on load is marked unimplemented. `src/utils/assetTrackerUtils.ts:280-371`
- Play mode already exports JSON glTF and re-imports it in memory on every play. The JSON round trip runs today. `src/utils/PlayModeHelper.ts:46-85`
- The loader accepts `.gltf` with external `.bin` and textures. `threepipe/src/assetmanager/import/GLTFLoader2.ts:135-179`

### Assessment

The direction is right. The current JSON export is not agent-friendly. Requirements for an agent-editable scene file:

1. **No binary in the scene file.** Geometry and textures live in `assets/`. The scene file holds nodes, transforms, components, material references, lights, cameras, and viewer config. Editor-created primitives either keep generator params (the geometry-generator plugin does this) or get exported to `assets/generated/<uuid>.glb` on save. The scene file then stays small and diffable.
2. **Stable, named references.** Keep `preserveUUIDs`. Name every node. Agents address nodes by name or uuid, never by index.
3. **Deterministic output.** Pretty-printed, stable key and node order. Git diffs become line-level. Hash-based echo and conflict checks see no spurious changes.
4. **Validation on load with visible errors.** Write load errors into `.blitz/console.log`. An agent must learn when its edit broke the file.
5. **External `.bin` support in the exporter.** If any buffer remains, write `main.scene.bin` next to the file instead of base64. This is an engine change. It is the first reason to keep threepipe in the workspace.

Document the extension payloads in agents.md. They are the agent API now. Rejected alternative: a separate higher-level `scene.json` compiled to glTF. Two formats, a compile step, and drift. Try requirements 1 to 3 first.

## 3. Publishing (NOW)

### What exists in teenybase, verified

- Anonymous creation: `POST /api/v1/new-project/:slug`, no auth. Returns `project_id`, `slug`, `expires_at`, `agent_link` (embeds the `tp_` token), `claim_url`, `preview_url`. The request host picks teenyapp.com or blitz.dev. `backend/src/routes/anon-projects.ts:76-275`
- TTL is 12 hours. A cron marks projects `cleaning` (gateway returns 410), then deletes them (404). `backend/src/utils/anon-constants.ts:23`, `backend/src/cron/expiry.ts:71-212`
- `*.app.blitz.dev/*` already routes to `teenybase-project-gateway`. `project-gateway/wrangler.prod.jsonc:10`
- The gateway runs the project's Worker bundle through the Workers Loader with per-project D1 and R2 over REST adapters. It has no R2 binding and no static-file path. `project-gateway/src/index.ts:165-311`
- File API: text only, one file per PUT, 1 MiB per file, project-wide integer `If-Match`. A save triggers a build and a live swap. `backend/src/routes/project-files.ts:14-15`, `:240-241`
- Forks: `?source=<slug>` copies another public project's source into a new project. Caps: 256 files, 16 MiB total, 1 MiB per file. `backend/src/routes/projects.ts:48-50`
- Claim: the JSON claim path is atomic. The SSR path is incomplete. Without a claim secret any logged-in user can claim a project. `authorize-claim-secret` exists. `backend/src/routes/anon-claim-bind.ts:34`, `backend/src/routes/dashboard.ts:1493`
- Rate limits: 10 creations per IP per minute, 100 per ASN, plus a global tripwire. `backend/wrangler.prod.jsonc:70-74`

### Assessment

"Copy teenyapp.com backend" should become "reuse it". The anonymous lifecycle, expiry, claim, rate limits, domains, and `*.app.blitz.dev` routing already exist in the workers that serve blitz.dev. A copy would need the same routes, and one zone cannot give them twice. Add a "game" project kind instead. These are the exceptions the plan asked for:

1. **Binary asset upload.** Today text only, 1 MiB per file. Add content-addressed blobs: `PUT /games/:id/blobs/:sha256` with a binary body, a per-file limit (for example 100 MB), and a per-project quota. Add a release manifest: `path -> {sha256, size, mime}`. Deploy = upload the manifest plus missing blobs, like git push.
2. **Static serving in the gateway.** Path -> manifest -> R2 object from one shared game-assets bucket bound to the gateway. MIME map for glb, gltf, ktx2, wasm, hdr, audio. Immutable cache headers for hashed blobs. ETag. Range/206 for audio and video. `index.html` at `/`. No SPA fallback needed. COOP/COEP off unless a game uses wasm threads.
3. **No per-project D1 and R2 for static games.** teenyapp provisions both per project after the 201. A static game gets a row and a manifest only. Provision D1 on first use of auth or economy features.
4. **Release pointer.** The manifest hash is the release id. Keep old manifests. Rollback is a pointer change. Parallel versions share blobs, so a version costs a row and a manifest.
5. **Claim secret by default.** Right after creation, call `authorize-claim-secret`. Store `{project_id, tp_token, claim_secret, preview_url, expires_at}` in `.blitz/deploys.json`, gitignored. The "open game" button reads `preview_url` from it. On sign-up the editor claims every project in the file. Sign-up alone preserves nothing.
6. **Runtime bootstrap in the published page.** Generate `index.html` at deploy time. It loads `https://blitz.dev/runtime/<version>/runtime.js` and calls `createGame({ base: '/' })`. No build step in the browser. Project files upload as they are. Scripts run as ES modules from the same origin. Replace the editor's `/fs/` rewriting and the esm.sh `@latest` fallback with exact versions.
7. **Slugs are global across teenyapp and blitz.** A collision returns 409. Rules: 3 to 49 chars, lowercase, digits, hyphens, no `--`. `backend/src/utils/validation.ts:6`
8. **Expiry is minute-level.** The gateway does not check `expires_at`. A game can outlive its deadline by a few minutes. Acceptable.

Dependencies: publishing needs the runtime loader (0.3), the blob upload, and the static route. It does not need NOW-1's watcher or NOW-2's glTF. The editor can upload from its directory handle today, and the runtime can load `.glb`.

## 4. Bugs found in passing

- `.gitignore` template paths lack the leading dot. `src/data/projectTemplates.ts:55-61`
- `player.ts` destructures a Promise; `player.html` never imports it. `src/player.ts:50-62`
- Standalone generator skips script registration and has a plugin codegen scoping bug. `src/utils/project.ts:396-451`
- `assets.json.version` is never incremented. `src/utils/ViewerInstanceManager.ts:792-834`
- No project-load call clears the undo stack. Stale object references survive project switches.
- AGENTS.md template says `.kite/samples` exists and hot reload is automatic. Neither is fully true. `src/data/AgentsMdTemplate.md:11-15`

## 5. Proposed edits to PLAN.md (your call)

1. NOW-1: "Rm indexDB" -> "IndexedDB keeps only directory handles and the recent list".
2. NOW-1: add the content-hash echo rule, the conflict policy, and debounced scene writes.
3. NOW-1: manifest = the `blitz` block in package.json, exact version, bootstrapper at blitz.dev.
4. NOW-1: journal = file-level reverse patches at save granularity; in-memory stack stays as a cache; add `.blitz/state.json` and `.blitz/console.log` mirrors.
5. NOW-2: add the five requirements above, including the external `.bin` exporter change.
6. NOW-3: "copy" -> "reuse teenybase, add a game project kind"; list the eight exceptions.
7. Move the loading half of `createGame()` from DEFER to NOW. Keep the handler API deferred.

## 6. Questions only you can answer

1. Chrome-only editor: acceptable?
2. Published games: bundle all plugins into the runtime build, or keep esm.sh imports? This decides offline play and version pinning.
3. Blob size and quota numbers for anonymous games.
4. Do first-version games need any backend (D1)? If not, the static kind is enough.

## 7. Publish dialog spec (docs/publish-dialog.md)

Added 2026-09-09 after the backend shipped. The spec in `docs/publish-dialog.md` (written with another agent) covers the release convention, the runtime `createGame({base, canvas})`, and the editor "Open game" dialog. It matches this review where they overlap:

- The deploy secrets live in `.blitz/deploys.json`, gitignored, with `claim_secret` for later sign-in (section 5.6 there, item 5 in section 3 here).
- The runtime ships inside the release as `_blitz/runtime.js`, content-addressed and uploaded once per version (section 4.2 there). This keeps every game same-origin and makes the runtime a GC root. It replaces the `blitz.dev/runtime/<version>/` idea in item 6 of section 3 here. Prefer the spec.
- The runtime version equals the editor version, written into `package.json` on first deploy (one version string, section 1.5 here).
- Its ordering rules for component registration, plugins, and the timeline (section 4.4 there) match the engine facts in section 2 here.

Things the spec must change or add before build:

1. **Absolute paths break the workers.dev preview.** The generated `index.html` uses `/_blitz/runtime.js` and `base: '/'`. Until the `*.app.blitz.dev` route exists, the gateway serves games at `https://<gateway>/<slug>/`, so those paths resolve to the gateway root and 404. Use relative paths: `./_blitz/runtime.js` in the import map and the module script, and `base: new URL('./', location.href).href`. Relative paths work in both modes.
2. **Keep runtime code separable.** The spec builds the runtime as a second Vite input inside `packages/editor`. Fine for Phase A, but put the new modules under `packages/editor/src/runtime/` with no imports from React, Blueprint, or uiconfig. Then the later move to `packages/engine` (section 0 of the layout discussion) is a directory move.
3. **esm.sh at play time.** The import map pulls `@threepipe/*` plugins from esm.sh. A published game then depends on a third-party CDN. Bundle the runtime plugin set into `runtime.js` for v1 and keep esm.sh only for project-declared extra dependencies.
4. **main.js contract.** The release requires `main.js` and the runtime calls `main({viewer})`, but the AGENTS.md template tells agents that `main.js` is unused in development. Fix the template text when the Deploy section is written (section 6 there).
5. **Backend additions are in progress here:** `GET /api/v1/slugs/:slug`, the spinner branch (503 with `X-Blitz-State`), the `runtimes` table and routes with `RUNTIME_UPLOAD_TOKEN`, GC roots for runtimes, and Google sign-in with the existing teenyapp client id. Blob GC itself was a gap in the shipped backend and is being built now (refcounts, release retention, grace-period sweep, bounded reconciliation).
6. **Answers to its open questions.** 1: yes, a `RUNTIME_UPLOAD_TOKEN` secret. 2: yes, reject an unregistered `_blitz/runtime.js` once Phase A ships. 3: mirror the editor now, exact pins under the version policy. 4: agreed, COOP and COEP stay off.

7. **Follow mode decided (evening).** The agent builds in its own folder and publishes; the editor opens `?game=<slug>#token=…`, loads from the gateway, refreshes on each release, and its Save publishes. Folder mode stays as the one-click path for hands-on editing. Rule for agents: pull before publish; the API rejects a publish whose `base_release` is not the active release. `agents.md` is served from the editor origin with a pointer in the page HTML.

8. **Scene model proposed by the owner (evening, pending confirmation).** `assets/main.scene.gltf` plus `main.scene.bin` is the single source of truth, text. The human edits it in the editor. The agent edits it with scripts (gltf-transform in JS, pygltflib in Python), never by hand. Procedural content is scoped: a `Generator` component on a node holds `{module, params}`, runs at load in the editor and the runtime, and fills that node's children, which are tagged generated and excluded from save. Bake is explicit and scoped to one generator node and refuses when the node has non-generated children or human edits since the last bake, unless forced. `.blitz/journal.jsonl` records human edits as a semantic diff per save. This replaces the loose `scene.js` and the writable `scene.json` ideas. Cost: an editor post-process of the JSON export (external `.bin`, stable ids, stable key order) instead of a threepipe exporter change.

9. **blitz.dev is the store (evening decision).** blitz.dev lists published games, consumer facing, dead simple: a grid of cards with a Play button, served by the backend worker with a 60 s edge cache. Listed means claimed, active release, and `listed` true. Anonymous games stay link-only. The hosted editor moves to `editor.blitz.dev` for follow mode. The canonical `agents.md` is served by blitz.dev. Plan: `docs/storefront-plan.md`, phase D, backend only, in parallel with C1.

10. **Open-source split like PlayCanvas (evening decision).** Engine, editor, the `blitz` command, and the template are open (Apache-2.0) npm packages that ship their `src/`, so a project's `node_modules` holds everything an agent may grep. The cloud services stay closed. Unlike PlayCanvas, the editor runs standalone from `blitz dev` with no cloud. There is no hosted editor and no follow mode. Plan: `docs/open-source-split.md`.

11. **Layout agreed (evening).** Public `blitzdotdev/blitz` with `packages/engine`, `editor`, `blitz`, `template`; private `blitzdotdev/blitz-cloud` from `services/` with history. Apache-2.0 confirmed by the owner for the editor. Exact engine contents in `docs/layout.md`.
