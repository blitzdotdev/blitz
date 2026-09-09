# Review of the NOW items in PLAN.md

Date: 2026-09-09. Code reviewed: threepipe-blueprint-editor @ 342be7f, threepipe @ 52c3ec1, uiconfig-blueprint @ 82cf3d0, and the teenybase monorepo at ~/superapp/teenybase. Paths are relative to each repo. Line numbers are from the unrenamed commits.

This file is a review, not the plan. PLAN.md stays the source of truth.

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
5. **Exact version in the manifest, and a bootstrapper.** Write `"blitz": { "version": "0.12.0" }` in package.json. Today the template writes `"threepipe": ">=0.4.2"` and standalone generation falls back to `threepipe@latest` from esm.sh, so the same files run on different engines over time. `src/data/projectTemplates.ts:27-40`, `src/utils/project.ts:346-360`. The deploy script already uploads `versions/<editor version>/` to R2. `scripts/upload-r2.mjs:27-37`. The missing piece is a small bootstrapper page at blitz.dev. It reads package.json from the picked folder first, then loads `/editor/<version>/`. Policy: exact match. Newer than available: error. Older: offer "upgrade project", which rewrites the version and runs migrations. One version string covers editor, engine, runtime, template, and agents.md.
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
