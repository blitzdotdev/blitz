# E2E session review, run 3, 2026-09-10

Scope: audit of agent session `aa34d4bf3ce26d8b5` (11:53Z to 12:29Z, 36 minutes, 58 Bash, 12 Write, 13 Edit, 15 Read calls, one tool error). The agent built `FPS Range` in `/Users/minjunes/blitz-games/fps-range` from the 04:52 tarballs and published it twice. The tarballs match monorepo commit `f2eea7d` byte for byte in every source file I compared. Main is now `7ce6b93` (P2 and P6 merged after the tarballs). This review verifies the session, re-checks F1 to F17 and G1 to G15, checks the six gaps the agent reported, and checks the live game. Nothing was fixed. No process was killed. No deploy token, claim secret, or editor session token appears in this file; `?t=<REDACTED>` marks the editor URL.

Sources: the transcript, the project folder, the monorepo at `main`, `/Users/minjunes/blitz-cloud`, the backend API (deploy token read from `.blitz/deploys.json` in memory), and five headless Playwright runs (one live boot, four editor probes). Line numbers point at `main` unless the path starts with `node_modules` or the text says `f2eea7d`.

## Summary

1. The game published in two tries and plays live with zero console errors, zero failed requests, and a manifest that matches the folder 16 of 16.
2. All six agent-reported gaps are real. Five are still present on main. Gap 6 (transitive hot reload) is fixed on main by P2 (`24c8d5c`), by code.
3. The worst new finding is H5: the editor marks the scene dirty with nothing to save, so `blitz publish` refuses with `Save the unsaved editor draft before publishing.` for up to 15 seconds after every Check.
4. The second worst is H7: the headless Editable check measures the started game, the editor check measures the stopped scene. The agent changed its game design to satisfy the headless one.
5. Fix passes F and G held: 29 of the 32 earlier findings are fixed or addressed (F3, F5, F17 by code only, not exercised here). F12 (no lighting guidance) is the only one still present. F13 and F15 did not reproduce.

## 1. New findings

| id | severity | area | what happened | evidence | repro | root cause | suggested fix | fixed on main after f2eea7d? |
|---|---|---|---|---|---|---|---|---|
| H1 | major | editor + check + docs | `blitz.scripts` entries written as `scripts/X.script.js` pass `blitz check` and run live, but the editor cannot load them. The project never loads in the editor. | Transcript 257: `[pageerror] Failed to resolve module specifier 'scripts/PlayerController.script.js'`. `.blitz/console.log` holds the same error five times with the stack `importProjectModule` / `registerProjectScripts` / `prepareEditViewer`. Transcript 232: the static rows for the same paths print `script PASS`. The agent's editor Check waited 90 s and timed out. | Write `"scripts": ["scripts/A.script.js"]` in `package.json`, open the editor. | `packages/editor/src/utils/ViewerInstanceManager.ts:1119-1121` (`isBareModule` is true for any path without `./` or `/`), `:375-376` (bare paths go to `import(path)`). The runtime resolves with `new URL(path, base)`: `packages/engine/src/runtime/createGame.ts:269`. The check accepts both forms: `packages/blitz/src/check.ts:369-385`. The editor's own UI writes `'./' + path`: `packages/editor/src/components/AddProjectScript.tsx:6`. `AGENTS.md:136` says "listed under `blitz.scripts`" and shows no example path. | Treat a path as bare only when it matches a declared dependency key; otherwise resolve it as a project file. Make `blitz check` fail or normalize the form. Show one `./scripts/...` example in AGENTS.md. | No. `isBareModule` is unchanged. |
| H2 | major | editor + engine | The editor-hosted Editable check validates the editor viewport camera, not the saved camera, and its message says "saved camera". The viewport camera sits at (0, 0, 10) after every load, so a floor whose top face is at y = 0 fails. | Transcript 285 and 302: `CAMERA_NOT_USEFUL`, `The saved camera is inside 1 visible authored mesh(es).` while the saved camera was at (0, 5.5, 17). Transcript 343: the check passed after the agent moved the floor top to y = -0.001. | Author a box whose top face is at y = 0. Run Check in the editor. Run `npx blitz check` headless: passes. | `packages/engine/src/authoringValidation.ts:169` (`scene.mainCamera || scene.defaultCamera`), `:472` (message). The editor passes its edit viewer: `ViewerInstanceManager.ts:642`. The edit viewer's main camera is `EditModePlugin.cameraPerspective`, reset to (0, 0, 10): `packages/editor/src/utils/EditModePlugin.ts:395-401`, activated at `:424-425`. `Box3.containsPoint` is inclusive, so a camera on a face counts as inside: `authoringValidation.ts:448`. | In the editor, validate `scene.defaultCamera`, or activate the scene camera for the report. Treat a point on a face as outside. Name the camera in the message. | No. |
| H3 | major | editor | The editor ignores `blitz.viewer.camera` and `blitz.viewer.backgroundColor`. The runtime and the headless check apply them. The stopped view and the published view differ until the scene file carries its own `WEBGI_viewer` config. The agent wrote `tools/build-scene.mjs --camera` to copy the package camera into the saved scene. | Transcript 273: the editor-saved scene stored `defaultCamera.position {x:0,y:0,z:5}` and `backgroundColor {r:1,g:1,b:1}` although `package.json` sets `[0, 5.5, 17]` and `#9cc0e4`. My live boot: `bg: "#9cc0e4"`. | Set `blitz.viewer.backgroundColor` and open the editor. | `ViewerInstanceManager.ts:291-300` builds `new ThreeViewer({container, debug, rgbm, msaa, ...})` with fixed options and never reads `config.viewer`. The runtime spreads it: `createGame.ts:105-107`; threepipe applies camera and background at `ThreeViewer.ts:506-509` and `:548` (node_modules copy). `AGENTS.md:419` documents the keys without this caveat. | Apply `config.viewer.camera` and `backgroundColor` to the edit viewer after load, or say in AGENTS.md that the editor uses only the scene's saved viewer config. | No. |
| H4 | minor | blitz journal | The journal logs a component `state` change when only the key order differs, and a `position` transform with `new` missing when a tool writes `translation` and the editor re-saves `matrix`. | Transcript 350, entry 12:17:19Z: five `change: "state"` records whose `old` and `new` hold the same values in a different order, plus `{"property":"position","old":[0,0,10.5]}` with no `new`. Entry 12:18:50Z repeats it in the other direction. | Write a node with `translation` by script, then Save in the editor. Read `.blitz/journal.jsonl`. | `packages/blitz/src/scene-diff.ts:270` (`JSON.stringify(left) === JSON.stringify(right)`), used at `:141-149`; transforms compare only `translation`, `rotation`, `scale` at `:96-98` and `:50`. | Canonicalize key order before comparing. Decompose `matrix` when TRS fields are absent. | No. |
| H5 | major | editor + blitz publish | `state.json` reports `dirty: true` with nothing to save after every editor Check, and after some plain loads. The Save button lights up. With a fresh heartbeat, `blitz publish` refuses. The agent lost one publish attempt and slept 16 s. | Transcript 343: `blitz: Save the unsaved editor draft before publishing.` Transcript 350: `"dirty": true`, `"updatedAt": "2026-09-10T12:22:16.727Z"` written 6 s after `Check passed`. Final agent state 12:26:44Z: `dirty: true` again. My probes: Save enabled at the moment the status read `Project loaded` in 2 of 4 plain loads, and after Check in 2 of 2. A forced save then produced no semantic change (journal entries with empty summaries). | Open the editor, click Check, wait for `Check passed`, read `.blitz/state.json`, run `npx blitz publish` within 15 s. | `ViewerInstanceManager.ts:413-418` marks the scene dirty on any `sceneUpdate` outside the `loadingScene` window. The window closes at `:401` right after `GeneratorComponent.waitForViewer` (`packages/engine/src/plugins/GeneratorComponent.ts:55-58`). Generator output is added to the node before `markGenerated` tags it (`GeneratorComponent.ts:155` then `:163`), so a generator run that lands after the window marks the scene dirty as an authored edit. `performCheck` forces `loadedNeedsSave = true` (`:639`) and reloads through the same path. The gate: `packages/blitz/src/commands.ts:328-352` (`EDITOR_HEARTBEAT_FRESH_MS = 15_000`, `editor_dirty`). | Tag generator children before adding them, or ignore `addedToParent` for children of generator nodes. Close the loading window only after every generator run. Do not force `loadedNeedsSave` in `performCheck`. Let the gate compare the scene hash instead of the flag. | No. |
| H6 | minor | editor + blitz journal + pull | Every editor Check re-saves the scene, and the re-save is not byte-stable. Two viewer-owned ids change per session. The scene then differs from the last release with no semantic change, and `blitz pull` will report it `modified locally, kept`. Each Check also appends a journal entry with an empty summary. | Diff of the published scene against the local file after two of my Checks: only `WEBGI_viewer.scene.defaultCamera.object.uuid` and the root `extras.gltfUUID` (`rootSceneModelRoot`) differ. Journal entries 12:22:10Z, 12:26:39Z, 12:46:46Z, 12:50:09Z: `components=0`, `transforms=[]`. | Run Check twice in two editor sessions, diff the scene file. | `packages/engine/src/sceneSerialization.ts:51-52` exports with `viewerConfig: true` and `preserveUUIDs: true`, but the default camera and the model root are new objects in every viewer. `ViewerInstanceManager.ts:639` forces the save. | Pin the two ids from the loaded file, or drop volatile ids from the export. Skip journal entries whose summary is empty. | No. |
| H7 | major | blitz check | The headless Editable check runs on the started game. The editor Editable check runs on the stopped scene. A component that hides its authored preview in `start()` fails headless with `GENERATOR_PREVIEW_MISSING` while the summary still says "Stopped-mode authored representation". The agent rewrote `TargetSpawner` so previews stay visible until the drill starts. | Transcript 232 and 239: `Editable FAIL GENERATOR_PREVIEW_MISSING`, `visibleRenderableCount: 37`, `generatorPreviewCount: 1` with all eight preview targets present but hidden by `start()`. Transcript 247 to 257: the agent's rewrite, then `Editable PASS` with `visibleRenderableCount: 85`. | In a component, set `preview.visible = false` in `start()`. Run `npx blitz check`: fails. Run Check in the editor: passes by code. | `packages/blitz/src/server.ts:724-725` calls `authoringQualityReport(first.viewer)` right after `createGame`, which has already run `start()` and `main` (`AGENTS.md:190`). The editor validates the edit viewer where components never start: `ViewerInstanceManager.ts:642`. | Validate a stopped viewer in headless mode (load without starting components), or label the outcome as "running-game representation". | No. |
| H8 | paper cut | blitz | `.blitz/deploys.json` holds the deploy token and claim secret and is written mode 0644. `.blitz/dev.json` is 0600. | `ls -la .blitz`: `-rw-r--r-- deploys.json`, `-rw------- dev.json`. | Publish, then `ls -l .blitz`. | `packages/blitz/src/node-filesystem.ts:76` writes with the default mode; `server.ts:1007` writes `dev.json` with `mode: 0o600`. | Write `deploys.json` with `0o600`. | No. |
| H9 | paper cut | blitz check | A fresh `blitz init` project fails its own check, and the failure line uses an em dash. | Transcript 165 on the untouched template: `Editable   FAIL     NO_VISIBLE_AUTHORED_CONTENT, CAMERA_NOT_USEFUL — 2 authoring check(s) failed.` and `Check failed (0 static row(s)).` | `blitz init x && cd x && npm install && npx blitz check`. | `packages/blitz/src/check.ts:184` (the dash); the template scene has no nodes. | Replace the dash with a colon. Make the empty-scene case a warning, or ship one authored object. | No. |
| H10 | minor (unpinned) | editor | The editor prints `ICamera: cannot calculate aspect ratio without canvas/container` twice per load, and with this project `GL_INVALID_OPERATION: glDrawElements: Active draw buffers with missing fragment shader outputs` two to four times per load under swiftshader. The live runtime prints neither. | Transcript 257 and 273 (the agent's Playwright console capture). My live boot console: only the threepipe banner and GPU stall notices. | Open the editor headless with this project. | Not pinned. The edit viewer is built with a detached container: `ViewerInstanceManager.ts:275-300`. The GL warning is likely the GBuffer multi-target pass with an editor helper. | Attach the container before constructing the viewer. Reproduce the MRT warning with the editor grid or widgets disabled. | No. |

### Timeline of problems, with the exact text

- 11:53:42Z `cat` of three memory notes exits 1: `reference_blitzdev_engine_gotchas.md: No such file or directory`. The agent read the project note and the Playwright recipe.
- 11:54:09Z install: `added 87 packages ... in 12s`, all four packages in `devDependencies`. `exit=` printed empty (zsh, agent bug).
- 11:54:40Z `Blitz editor: http://127.0.0.1:4326/?t=<REDACTED>` (4321 to 4325 busy, no `--port` needed).
- 11:54:50Z to 12:06:49Z twelve minutes of source reading: engine authoring, check.ts, editor manager, threepipe camera and viewer config, EntityComponentPlugin, dev server token handling.
- 11:59:46Z `npx blitz check` on the empty template fails (H9).
- 12:12:30Z first real check: `Editable FAIL GENERATOR_PREVIEW_MISSING` (H7). 12:14:30Z headless passes after the design change.
- 12:14:42Z to 12:14:52Z editor: `Failed to resolve module specifier 'scripts/PlayerController.script.js'` five times (H1). Editor Check harness times out after 90 s.
- 12:16:56Z `sed -i '' 's#"scripts/#"./scripts/#g' package.json`. Editor loads. Editor Check: `CAMERA_NOT_USEFUL` (H2). Scene now carries `WEBGI_viewer` with camera (0, 0, 5) and white background (H3).
- 12:18:16Z `--camera` tool written. 12:19:06Z editor Check still `CAMERA_NOT_USEFUL`. 12:19:43Z editor Play test passes (27 of 29 hits, HUD removed on Stop).
- 12:21:50Z floor top moved to y = -0.001 with a comment naming the cause. 12:22:26Z editor and headless checks pass.
- 12:22:26Z `blitz: Save the unsaved editor draft before publishing.` (H5). `exit=0` printed because `$?` followed `tail`.
- 12:23:20Z harness `save` command times out (Save button disabled in a fresh session). 12:23:52Z after `sleep 16`, publish succeeds: `Published c4c43245...`.
- 12:24:45Z live test passes, published `package.json` has no `devDependencies`.
- 12:26:03Z lighting and field of view changes. 12:27:13Z `pull` keeps two locally modified files, `Published 2861fd86...`. Live test: expiry, results card, restart all pass.
- 12:28:45Z driver saved as `tools/playtest.mjs`. 12:29:23Z report with six gaps.

## 2. The six agent-reported gaps

| gap | verdict | root cause | fixed on main? |
|---|---|---|---|
| 1. `blitz.scripts` without `./` loads in the runtime, fails in the editor | Confirmed (H1). The check passes both forms, the runtime resolves both, the editor only `./`. | `ViewerInstanceManager.ts:1119-1121`, `createGame.ts:269`, `check.ts:369-385`, `AddProjectScript.tsx:6` | No |
| 2. Editor Editable validates the viewport camera, not the saved camera | Confirmed (H2). The agent's diagnosis (`resetView()` to (0, 0, 10)) is exact. Add: containment is inclusive, so a face at y = 0 counts as inside. | `authoringValidation.ts:169`, `:448`, `:472`; `EditModePlugin.ts:395-401`, `:424-425`; `ViewerInstanceManager.ts:642` | No |
| 3. Editor does not apply `blitz.viewer` camera or background | Confirmed (H3). | `ViewerInstanceManager.ts:291-300` versus `createGame.ts:105-107` | No |
| 4. Journal logs state changes on key order alone | Confirmed (H4). Add: a `position` change with `new` missing when `translation` becomes `matrix`. | `scene-diff.ts:270`, `:141-149`, `:96-98` | No |
| 5. `state.json` stayed `dirty: true` for 15 s after the editor check and blocked publish | Confirmed and root-caused (H5). The flag is wrong, not slow. It flips back only when a new session loads clean. The 15 s is the gate's heartbeat window. | `ViewerInstanceManager.ts:413-418`, `:401`, `:639`; `GeneratorComponent.ts:55-58`, `:155`, `:163`; `commands.ts:328-352` | No |
| 6. Edits to non-listed modules do not hot reload | Confirmed at f2eea7d by code: the f2eea7d editor reloads only listed scripts and generator modules (`isListedModule` branch; the agent read it at transcript 264). The agent did not exercise it; its statement came from reading the code. | f2eea7d `ViewerInstanceManager.ts:896-919` | Yes, by P2 (`24c8d5c`): any `.js` change bumps `moduleRevision` and re-registers every listed script (`ViewerInstanceManager.ts` `applyProjectFileChange`), and the dev server rewrites relative imports with `?v=<sha>&r=<revision>` (`packages/blitz/src/module-rewriter.ts`, `server.ts` `serveProjectFile`). Tests: `packages/blitz/test/server.test.ts`, `packages/editor/test/editor/dev-server.spec.ts`. Not exercised by this run. |

## 3. F1 to F17 status

| id | status | evidence |
|---|---|---|
| F1 | FIXED | Live `meta name="blitz-runtime"` is `0.12.0 1e01d7c3...`. Gateway `_blitz/runtime.js` ETag `1e01d7c3...` equals the installed `node_modules/@blitzdev/engine/dist/runtime.js`. The registry is keyed by hash and listed `1e01d7c3...` at 11:20:15Z, before the run. |
| F2 | FIXED | Every command ran with `file:` pins: `dev`, `check` (10 runs), `pull` (2), `publish` (3), `status`, `journal`. |
| F3 | FIXED (run 2), NOT EXERCISED | The agent never saved a listed script with the editor open and watched it reload. It reloaded the page for each run. |
| F4 | FIXED | Live import map: five keys, all `./_blitz/runtime.js`. No esm.sh, no `file:`. |
| F5 | FIXED by code, NOT EXERCISED | No extra `dependencies` in this project. |
| F6 | FIXED | No `Multiple instances of Three.js` in the agent's editor console captures (transcript 257, 273, 294) or in my probes. |
| F7 | FIXED, EXERCISED | Transcript 392: `package.json: modified locally, kept`, `scripts/PlayerController.script.js: modified locally, kept`, `updated 0 file(s)`. Before the first publish: `There is nothing to pull before the first publish.` |
| F8 | FIXED, EXERCISED | Second publish used only `--message`; live title stayed `FPS Range`; backend `name` is `FPS Range`. |
| F9 | FIXED | `.blitz/console.log` header: `levels: console.warn, console.error, uncaught errors`. The editor's uncaught import errors landed there with stacks. |
| F10 | FIXED | Port 4326 chosen automatically with 4321 to 4325 busy. |
| F11 | ADDRESSED (docs) | `AGENTS.md:323` states the focus rule. The agent kept a cursor-aim fallback and simulated the locked path. No headed test this run. |
| F12 | STILL PRESENT (docs) | The first live build was too dark near the floor; the agent raised the hemisphere light from 1.0 to 1.8 and lightened two materials (transcript 378 to 380). `AGENTS.md:419` lists viewer keys but gives no lighting or exposure guidance. |
| F13 | NOT REPRODUCED | Drill timers consistent with wall time in every run (for example `timeLeft: 48.8` after about 11 s of play). |
| F14 | FIXED | `<link rel="icon" href="./icon.svg">`; zero 4xx in the agent's runs and mine. Gateway root `/favicon.ico` is still 404 but nothing requests it. |
| F15 | NOT REPRODUCED | No `texImage3D` warning in any capture. |
| F16 | FIXED | Default excludes (G7). `AGENTS.md`, `tools/*`, `samples/*`, `package-lock.json` return 404 live. |
| F17 | FIXED, NOT EXERCISED | `playState` was `stopped` in every state file read. |

## 4. G1 to G15 status

| id | status | evidence |
|---|---|---|
| G1 | FIXED | `registerProjectScripts` loops `config.scripts` only; `FilesPanel.tsx` carries `unlisted-script-warning`. The H1 failure proves the editor imports exactly the listed entries. |
| G2 | FIXED | Header line and `console.warn` level in `.blitz/console.log`. |
| G3 | FIXED | My probe: `GET /files/does-not-exist.js` returns `404 {"error":{"code":"not_found","message":"File not found."}}`. |
| G4 | FIXED | `GET /api/v1/runtimes/0.12.0` lists four hashes under `0.12.0`, including the shipped `1e01d7c3...`; `a0686cb5...` (12:32:43Z) is the rebuild after P2 and P6. |
| G5 | FIXED | `GET /api/state?t=<token>` returns 200; without a token 401. Documented at `AGENTS.md:46`. |
| G6 | FIXED | `packages/blitz/src/cli.ts:150-151` prints the message without throwing; documented at `AGENTS.md:967`. |
| G7 | FIXED, EXERCISED | `filesystem.ts:4-14` excludes `AGENTS.md`, `samples/**`, `tools/**`, `*.md`, the lockfile. The release has 16 files. Published `package.json` has no `devDependencies`. |
| G8 | FIXED | `state.json` carries `clientId`; heartbeat every 5 s; `pagehide` writes `stopped`. New wrong-flag variant: H5. |
| G9 | FIXED (docs) | `AGENTS.md:419` documents `blitz.viewer` keys. The editor ignores two of them: H3. |
| G10 | FIXED | No `[log] true` in my live boot console. |
| G11 | FIXED | `GET /files/.blitz/deploys.json` returns 403 `invalid_path`; `/api/files` lists 24 entries without `deploys.json` or `dev.json`. |
| G12 | FIXED | Backend game record: `"description": "First-person shooting range. ..."`. |
| G13 | FIXED | `blitz check` exists with static rows and three outcomes; the agent ran it ten times. Residuals: H7, H9. |
| G14 | FIXED | `blitz status` prints `Dev server: pid 46737, port 4326, age 34m 29s, http://127.0.0.1:4326/`. |
| G15 | FIXED in the repo | `docs/agents.md` and the template are identical (984 lines). The backend `/agents.md` serves a 553 byte page, so the cloud copy still differs. |

## 5. What worked

- `init`, tarball install (87 packages, 12 s), `dev` on a free port with the URL in `.blitz/dev.json` (mode 600).
- `blitz check` headless: 2 to 5 s per run, a static table plus three outcomes, `.blitz/check.json` and a summary line in `.blitz/console.log`. The editor Check writes the same file.
- The feedback loop caught the editor's import failure: five stack traces in `.blitz/console.log` within a second of each load.
- Two `Generator` components (range and targets) ran in the editor and live; generator modules imported `../lib/*.js` with relative paths.
- The journal recorded the tool's scene writes as `external` with the four node additions.
- `pull` kept locally modified files. Publish streamed `[verifying] n/16` progress, printed the release hash and the URL, and wrote `last_publish` into `deploys.json`.
- The published `package.json` is sanitized: no `devDependencies`, no `file:` specs. `description` reached the backend.
- The runtime registry accepted the shipped build before the run, so no registry warning was possible.
- Live: `text/javascript` for scripts and the runtime, `model/gltf+json`, strong ETags, identity encoding, 404 for every excluded and dotfile path.
- The runtime cleanup report after Stop: `trackedObjectCount: 0`, `outsideRenderableCount: 0`; zero HUD elements after Stop.
- The agent's driver: editor Play, live drill, simulated pointer lock, target expiry, results card, restart, all passing, saved as `tools/playtest.mjs`.

## 6. Live game check

URL: `https://blitz-game-gateway.blitzapp.workers.dev/fps-range/`. Game `a697c191-4858-4de3-925a-e8c0c8e22dd1`, two releases (`c4c43245...` initial, `2861fd86...` active, `lighting, field of view 60`), `listed: true`, unclaimed, expires `2026-09-11 00:23:47` UTC.

- `index.html`: all paths relative (`./_blitz/runtime.js`, `./icon.svg`, `base: new URL('./', location.href)`). Import map has five keys, all to `./_blitz/runtime.js`. `meta name="blitz-runtime"` carries the version and the hash.
- `_blitz/runtime.js`: 200, `text/javascript; charset=utf-8`, 3,007,303 B, ETag `1e01d7c3...`, equal to the installed runtime.
- Headless boot (swiftshader): `phase: ready` in 1.6 s, title `FPS Range`, `window.viewer` present, 110 objects under `modelRoot` (106 generated, 85 meshes, 5 lights), top level `Range, Targets, Player, Game`, one HUD, camera at (0, 1.7, 10.5), background `#9cc0e4`. Console: the threepipe banner and swiftshader GPU stall notices only. Zero errors, zero failed requests, zero 4xx.
- Excluded: `AGENTS.md`, `tools/build-scene.mjs`, `tools/playtest.mjs`, `samples/Spin.script.js`, `package-lock.json`, `.blitz/deploys.json`, `.blitz/dev.json`, `.blitz/state.json`, `.gitignore`, `node_modules/...`, `README.md`, `assets/main.scene.bin`: all 404.
- Manifest versus folder through the API (token read in memory): 16 of 16 entries match the local hashes. `package.json` and `index.html` match the live bytes; the local `package.json` differs only because the published copy is sanitized. `deploys.json` `last_release_hash` equals `active_release`.

## 7. Project check against the AGENTS rules

- Representation: two `Generator` nodes (`generators/range.js`, 98 children; `generators/targets.js`, 8 preview targets), tagged `blitzAuthoring` with stable ids `a1f2c3d4-000n-...` and stable component keys (`range-generator`, `target-spawner`, `player-controller`, `game-manager`). Three components listed in `blitz.scripts`.
- Stopped mode: `start()` creates the HUD, audio, runtime target holders, and listeners; `stop()` removes them. Verified by the editor cleanup report and by `hud elements after stop: 0`.
- Scene: text glTF, pretty JSON, four nodes, no buffers. Written by `tools/build-scene.mjs` (merges by name, keeps foreign extras) and re-saved by the editor. Nine journal entries.
- Time base: the components use `e.deltaTime`; no wall-clock workaround this run.
- Workarounds a normal user would not have done: the `./` rewrite (H1), the floor top at y = -0.001 (H2), the `--camera` tool (H3), the preview-visibility redesign (H7), the 16 s sleep before publish (H5).

## 8. Agent quality

- Fresh-ish. It read `project_blitz_games.md` and the Playwright recipe first; the engine gotchas note no longer existed. No earlier project was opened. It read the full AGENTS.md (48 KB) and then spent 12 of 36 minutes reading sources for things AGENTS.md does not say: how Editable is measured, the `WEBGI_viewer` camera format, the editor camera, the token header, which three.js names the runtime exports.
- Good: every fix was seen to fail first, then pass. It tested in the editor and live, simulated the locked-mouse path, exercised expiry, results, and restart, kept the dev server alive, hid the token when printing `dev.json`, and reported six gaps that all verify.
- Prompt drift: the prompt it received (transcript line 1) said `When it plays, publish it: npx blitz publish.` The paste block in `docs/testing-with-an-agent.md` has said `run npx blitz check and fix every failure` since 02:19 local (`860bf5f`). The agent found `check` on its own through `AGENTS.md:75`.
- Weak: `exit=${PIPESTATUS[0]}` printed empty for the third run in a row (zsh uses `pipestatus`), and `exit=$?` after a `| tail` reported `tail`. It never saw an exit code for `npm install`, `pull`, or either publish. `tail -15` hid the head of every publish log.
- It absorbed two platform defects as its own work instead of reporting them: the preview-visibility redesign (H7) and the 1 mm floor offset (H2, reported, but the geometry change stayed in the game).
- Gap 6 came from reading the code, not from a test, and the report does not say so.
- One harness command (`save`) timed out because the Save button was disabled; the agent read that as proof that a save updates the file. The state it then saw came from a fresh load, not from a save.
- The transcript's thinking blocks are empty except six short summaries, so the reasoning cannot be audited.
- The final report printed the editor URL with its token because the prompt asked for the URL. The transcript also carries it in the `blitz dev` log. Nothing else leaked: `deploys.json` was read only through a key-listing script.

## 9. State left behind

- Running: pid 46737 `blitz dev --no-open` on 4326 for `fps-range` (kept, as asked). Earlier servers on 4321 to 4325 belong to other sessions.
- The agent's scratchpad: `drive.mjs`, `blitz-dev.log` (contains the tokenized URL), about 20 PNG screenshots.
- This review's probes changed project state through the editor's normal paths: `.blitz/state.json` (now `dirty: false`, client from probe 4), `.blitz/check.json` (now `mode: editor`, 12:50Z, all pass), `.blitz/console.log` (four more header and check lines), `.blitz/journal.jsonl` (two more empty-summary entries), and `assets/main.scene.gltf` re-saved twice. The scene now differs from the published copy in the two volatile ids of H6 and in nothing else. `blitz pull` will report it `modified locally, kept`.
- Review scratch files live in `scratchpad/review3/`: `index.mjs`, `dump.mjs`, `manifest-check.mjs`, `live-boot.mjs`, `editor-probe.mjs`, `editor-probe2.mjs`, `editor-probe3.mjs`, `editor-probe4.mjs`, `live-boot.png`, `live-scene.gltf`, `index.txt`, `agents-md-as-seen.txt`.
