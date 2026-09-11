# Inventory of repalash/threepipe-blueprint-editor branch codex/ai-game-prototype

Branch head 9a3c7c2, compared with Kite3D ab86a2c on 2026-09-09. Read-only analysis by a Codex pass. Paths prefixed P/ refer to that branch; B/ refers to this repo.


Compared prototype `9a3c7c2` with Kite3D `ab86a2c`; both worktrees remain clean. Paths below use:

- `P/` - [threepipe-blueprint-editor prototype](/private/tmp/claude-501/-Users-minjunes-kite3d/278f5f97-7e16-4722-b1bc-c061014966db/scratchpad/tbe-proto)
- `B/` - [current Kite3D repository](/Users/minjunes/blitz)

## 1. Prototype inventory

| Feature | Main implementation, approximate LOC | Mechanism and tests | Documented state |
|---|---|---|---|
| Companion / MCP operations | `P/scripts/kite-companion.mjs` 991; `mcp-bridge-{common,server}.mjs` 130/207; `mcp-tools.mjs` 508; `src/utils/ai/MCPBridgeClient.ts` 337; `MCPBridgeHandler.ts` 1,577; `WorkspaceCompanionClient.ts` 81 | Loopback WebSocket with role capabilities; native project rooting; revisions, operation IDs, mutation queue, batch rollback; scene/editor/project/checkpoint/runtime tools. Tested by `companion.spec.ts` 693, `checkpoint-recovery.spec.ts` 128, `milestone2-browser.spec.ts` 387, and 3B negative fixtures. | M2 and lifecycle portions validated; deterministic construction validated. Command sandbox remains provisional; fresh 3B provider generation is partial. |
| Prompt Mode | `P/src/components/AIAgentTab.tsx` 768; integration in `ThreeEditorComponent.tsx` 515 and `WindowPanesLayout.tsx` 198 | Full-editor panel for login, model/effort, prompts, activity, approvals/questions, cancellation, reset, reconnect, checkpoint restore, and completion checks. `prompt-mode.spec.ts` 243; `milestone3b-authoring.spec.ts` 384. | UI/provider loop validated in M3A. Fresh repeatable game-quality evaluation and broader onboarding remain partial. |
| Codex App Server | `P/scripts/codex-app-server.mjs` 463; `app-server-smoke.mjs` 392; `app-server-smoke-mcp.mjs` 35 | Pinned official Codex `0.153.4`, stdio JSONL, provider-owned auth/device code, model listing, thread resume/start/interrupt/archive, per-project MCP injection, `workspace-write`, approval handling. `codex-app-server.spec.ts` 87 plus live smoke. | M0 feasibility and M3A production-policy smoke validated. Account-mode UX and future client compatibility partial. |
| Module reload | `P/src/utils/modules.ts` 226; reload work in `ScriptUtil.ts` 855 | Regex-built module graph for imports/re-exports/dynamic literals; invalidates changed module and transitive importers, reserves cache versions before cyclic imports; removes/re-registers components/plugins. `module-reload.spec.ts` 24 and real-FS coverage in `crystal-vault-editor.spec.ts` 257. | Validated for first edit, re-export chains, cycles, pause, and real FS observer in M1 review. Parser remains structurally fragile. |
| `kite-dev` local workflow | `P/scripts/kite-dev.mjs` 208; `kite-alpha-doctor.mjs` 102; companion scripts above | Starts Vite and companion, generates scoped capabilities, selects the ChatGPT-bundled Codex before `PATH`, supports workspace/project modes and macOS browser launch; doctor checks Node/npm/dependencies/Codex/Chrome. `kite-dev.spec.ts` 68. | Reduced M4 local-alpha flow validated. Clean teammate checkout, normal welcome flow, and one-time folder authorization not validated. |
| Project player | `P/src/player.ts` 81; `player.html` 22; `fs-sw.ts` 57; bundle generation in `src/utils/project.ts` 536 | Browser FSA/IndexedDB project metadata plus `/fs/` service worker; dynamically generates `_setup.js`, `main.js`, and import map; enforces component-before-plugin-before-scene and one `projectReady`. `project-player.spec.ts` 86. | M1 player validated, including corrupt/missing scene cases. Explicitly a preview mechanism, not the final distribution path. |
| Web export ZIPs | `P/scripts/web-export.mjs` 165; `ExportGameTab.tsx` 128 | Companion runs pinned build. Playable ZIP contains only `dist` plus provenance; source ZIP includes code/assets/config/lock/runtime and excludes `.git`, `.kite`, `node_modules`, secrets, and `dist`; symlink checks and SHA metadata. `web-export.spec.ts` 142; `export-panel.spec.ts` 145. | M5 automated gate passes, including independent static serving and clean rebuild. Two representative manual acceptance paths remain pending. |
| Publish POC | `P/scripts/kite3d-publisher.mjs` 385; `PublishGameTab.tsx` 185; welcome actions 135 | Builds ≤8 MiB output, splits text into generated Worker modules, provisions temporary scoped project, retries uploads/commit, verifies public hashes, returns play/claim URLs. `kite3d-publisher.spec.ts` 249; `publish-game-ui.spec.ts` 142. | Fixture implementation validated; live canary blocked by authorization. Production architecture explicitly marked for replacement. |
| Inspector source editor | `P/src/components/SourceEditorPanel.tsx` 203; integration in layout/editor files above | UTF-8 allowlist, 1 MiB cap, selected-file editor, draft snapshots, stale-read rejection, typing-during-save protection, revision conflicts, Reload/Overwrite UI, external-change listener. It writes through the companion and then also through FSA when connected. `source-editor.spec.ts` 193. | Focused M4 tests pass. Failed-save retry and overwrite-disk paths are untested; dual I/O path is questionable. |
| Workspace projects | `P/WelcomeDialogProjectsTab.tsx` 54; `WelcomeDialogGameActions.tsx` 135; `projectTemplates.ts` 83; `project.ts` 536; companion provisioning | Lists/copies empty and sample projects, installs dependencies/prepares runtime, registers exact child path, then asks browser for the matching directory handle. `workspace-projects.spec.ts` 65; `copied-scaffold.spec.ts` 36; `empty-game.spec.ts` 34. | Reduced `--workspace` flow validated. Integration into normal welcome and one-time permission were explored, reverted, and deferred. |
| Empty-game template | `P/templates/empty-game/`: about 202 source/config lines plus 1,649-line lock; `AGENTS.md` 12; `package.json` 51 | Blank standalone Threepipe project with pinned runtime builder and concise representation/cleanup/persistence rules; deliberately no sample mechanics. Template tests 19 lines plus `empty-game.spec.ts` and copied-scaffold tests. | M1 build and no-gameplay contract validated; workspace copying validated. |
| Crystal Vault sample | `P/samples/crystal-vault/`: about 2,350 non-vendor/non-GLB lines plus 1,772-line lock; `create-scene.js` 505; components about 597; harness/HUD/navigation/standalone about 664 | Script-created GLB plus editable component gameplay: player, sentinel, crystals, exit gate, HUD, navigation, telemetry, standalone boot. Node tests 111 lines; `crystal-vault-editor.spec.ts` 257; manual gameplay acceptance. | Validated in M1 and exercised in M3A. One load-sensitive pause assertion flaked under the full suite. |
| Snapshot tests | `P/src/utils/EditorStructure.ts` 442; `editor-structure.spec.ts` 430; `format-comparison.spec.ts` 296; snapshots about 10,992 lines | Serializes editor state into legacy, v2, JSON, XML, compact and AI-oriented formats; normalizes UUIDs and records output sizes. | Regression machinery passes, but is not milestone acceptance evidence. Missing snapshots are created automatically and size regressions only warn. |

## 2. Recorded decisions and dead ends

### Decisions

1. Keep the browser editor as the visual host and use a local companion for native filesystem, checkpoint, build, publish, and provider responsibilities.
2. Protect loopback connections with short-lived role-specific capabilities because editor, provider bridge, and workspace launcher have different authority.
3. Treat the native project directory as authoritative; browser state is only a working representation.
4. Treat `assets/main.scene.glb` as the authoritative saved scene and `package.json` as authoritative for scene, scripts, dependencies, and runtime configuration.
5. Keep meaningful authored content beneath `modelRoot`; Play-only transients must live outside it and be removed on Stop.
6. Keep local metadata under ignored `.kite/`; retained checkpoints and exports must exclude credentials and relay capabilities.
7. Put Prompt Mode inside the full editor; a separate beginner product surface is deferred until the core loop is proven.
8. Use the official pinned Codex App Server and provider-managed authentication rather than implementing model/auth transport.
9. Pin `threepipe@0.4.4` and the shared runtime; upgrade only after a recorded compatibility pass.
10. Put supported source editing in Inspector; do not build an embedded IDE or separate Code tab.
11. Use one coordinated pre-prompt checkpoint and one latest restore action; named history/source-control UI is deferred.
12. Run completion checks internally and expose detailed evidence/repair only in debug mode until the result UX is resolved.
13. Use a special `--workspace` welcome flow with an exact child-directory grant; do not weaken the browser permission boundary.
14. Make playable and source ZIPs the M5 distribution path; desktop packaging and production hosting remain undecided.
15. Retain public Kite3D publishing only as a labeled POC; replace its split-Worker architecture before productization.
16. Do not give the provider an editable-package-script `runCommand` capability; deterministic host commands must be explicit.
17. Support three saved representation patterns: direct authored content, authored template with traceable copies, or generator with bounded preview.
18. Judge Playable, Editable, and Persisted independently; a playable runtime-only result is not an acceptable authored project.
19. Keep failed validation evidence and the original checkpoint; permit at most one bounded repair turn.
20. Require an actually useful saved Edit camera, representative edit propagation, Stop cleanup, and Save/Reload semantic equivalence.
21. Let official coding clients own credentials and inference; “subscription” must not be interpreted as unlimited use, universal model access, or free API billing.
22. Treat reported account type as authoritative; block unexpected API-key mode in subscription flow and never switch billing/provider silently.
23. Keep provider execution local and user initiated; local App Server support does not authorize hosted or pooled subscription execution.
24. Add Claude only through an unmodified official client and supported auth; never collect cookies, OAuth tokens, or emulate subscription OAuth.
25. Preserve one provider-adapter/companion boundary and one scene representation across providers.
26. Advertise provider capabilities explicitly and namespace resumable session metadata by provider, project, scene, schema, and client version.
27. Verify each provider’s real filesystem/network containment; do not assume equivalent semantics from similarly named sandbox policies.
28. Never retain credentials, device codes, auth responses, or relay capabilities in logs, checkpoints, or exports.
29. Separate authentication authority from filesystem authority so logging in never broadens project access.
30. Keep automated, manual, and deferred evidence distinct; missing live evaluation must never be reported as a pass.

### Failures, reversals, and incomplete paths

- Codex `0.142.0` failed `thread/delete` with `no such table: agent_jobs`; the apparent GPT-6 failure was actually old `PATH` selection, leading to the `0.153.4` pin.
- First clean install followed local Threepipe links and failed Cesium example preparation without a token; published `0.4.3` lacked required APIs, while `0.4.4` worked.
- Old Vite dependency exclusions caused a `stats.js` default-export failure and were removed.
- The legacy browser WebSocket MCP bridge could not serve as the provider boundary; App Server plus a local stdio MCP bridge was added.
- The original player had wrong viewer scoping, plugin lookup, `latest` dependencies, bad import-map/CDN assumptions, undeclared callbacks, and unresolved cleanup/reload.
- Companion `project.runCommand` was removed after recognizing that allowlisted npm scripts remain user-editable and are not a sandbox.
- A generated Neon game was playable but had a blank stopped scene because nearly everything was runtime-only; this drove the 3B authoring contract.
- Cave-game validation falsely accepted 1,224 nodes while the Edit camera was inside the floor; camera embedding/frustum checks were added.
- `viewer.scene.addObject()` placed a runtime root under `modelRoot`; a guarded runtime-owner helper replaced it.
- Browser and native checkpoints initially collided in one namespace; recovery was fixed after live cancellation exposed it.
- Normal welcome integration and one-time workspace permission were implemented experimentally, then reverted because FSA still requires the exact handle.
- `mcp-bridge:test` can exit zero after bind denial, so startup text is false-positive evidence.
- Large headless runs hit timing failures; one Crystal Vault pause test remained load-sensitive.
- Arbitrary hollow/deformed mesh containment is only advisory and still requires visual inspection.
- M3B has not completed a fresh provider-generated reference game or final hierarchy/persistence budgets.
- M5 lacks its two manual representative export runs.
- The publish live canary failed authorization; public URLs, claim secrets, the 8 MiB ceiling, and non-durable jobs remain POC limitations.
- Claude support was never implemented; login cancellation/retry/account-change behavior and API-key labeling remain incomplete.
- Repository-wide lint remained red throughout the milestone reports.
- The final workflow was not validated from a clean teammate checkout.

## 3. Mapping to Kite3D

No whole prototype feature qualifies as **REUSE AS-IS**: every substantial feature assumes MCP, FSA, its per-project runtime, or its temporary publishing architecture. A few pure helpers and fixtures can be copied literally, but the feature-level disposition is:

| Feature | Classification | Concrete Kite3D plan |
|---|---|---|
| Companion / MCP | **REUSE THE IDEA** | Do not port transport or tools. Extract the genre-neutral authoring validator from `P/src/utils/ai/MCPBridgeHandler.ts` into a small `B/packages/engine/src/authoringValidation.ts`; test it in `packages/engine/test/unit/`. Feed findings through existing `.kite3d/state.json`/`.kite3d/console.log`, `editor/src/App.tsx`, and server SSE. HTTP `If-Match` and `DevServerSource` already replace revisions/stale-write checks. |
| Prompt Mode | **SKIP** | Terminal Codex/Claude plus `B/packages/template/template/AGENTS.md` is the product surface. Do not port `AIAgentTab`, provider activity, approval, or repair UI. |
| Codex App Server | **SKIP** | Users run official agents in the project directory. Do not add embedded auth, threads, models, or MCP to `packages/kite3d/src/server.ts`. |
| Module reload | **REUSE THE IDEA** | Keep Kite3D’s current SHA URLs and component replacement in `engine/src/{runtime/createGame,scripts}.ts`. Port the transitive re-export/cycle regression from `P/tests/module-reload.spec.ts` into `editor/test/editor/dev-server.spec.ts`; implement dependency invalidation using a real ESM lexer/server transform, not `P/src/utils/modules.ts`’s regex parser. |
| `kite-dev` | **REUSE THE IDEA** | `B/packages/kite3d/src/server.ts` and `commands.ts` already provide `kite3d dev`. Borrow doctor-style actionable version/dependency diagnostics into `commands.ts` plus `test/cli.test.ts`; omit provider selection, FSA grants, capabilities in launch URLs, and workspace browser choreography. |
| Project player | **REUSE THE IDEA** | `B/packages/engine/src/runtime/createGame.ts` is the replacement. Port only startup-order, corrupt/missing-scene, cleanup, and visible-error cases into `engine/test/runtime/runtime.spec.ts`; do not port `player.ts`, generated `_setup.js`, IndexedDB, or `fs-sw.ts`. |
| Web export ZIPs | **REUSE THE IDEA** | Publishing supersedes the playable ZIP. Copy exclusion, symlink-race, independent-launch, and integrity test concepts into `B/packages/kite3d/src/{filesystem,publish}.ts` and `test/publish.test.ts`. A source archive would be a separate future CLI command, not an editor export panel. |
| Publish POC | **REUSE THE IDEA** | Do not port the Worker splitter. Bring its conflict/429/5xx/timeout/uncertain-write and public-hash verification matrix into `B/packages/kite3d/src/{api,publish}.ts`, `test/mockBackend.ts`, and `test/publish.test.ts`, using the existing blob/release API. |
| Source editor | **REUSE THE IDEA** | Adapt the draft/save/conflict state machine into a new `B/packages/editor/src/SourceEditorPanel.tsx`, integrated by `App.tsx`. All reads/writes go through `ProjectSource`/`DevServerSource` ETags and SSE; remove MCP/FSA and the prototype’s double-write. Port `source-editor.spec.ts` race/conflict cases. |
| Workspace projects | **SKIP** | `kite3d init`, one project per `kite3d dev`, and terminal directory navigation replace workspace copying and directory-handle authorization. Retain/init-test improvements only in `packages/kite3d/test/init.test.ts`. |
| Empty-game template | **REUSE THE IDEA** | Keep `B/packages/template/template/` and its text `main.scene.gltf`/shared `createGame`. Condense the strongest representation, cleanup, camera, and verification rules from `P/templates/empty-game/AGENTS.md` into the existing AGENTS template; port the “no sample mechanics” assertion to `kite3d/test/init.test.ts`. |
| Crystal Vault | **REUSE THE IDEA** | Convert it into an optional `B/packages/engine/test/fixtures/crystal-vault/` or example using `createGame`, text glTF, and `GeneratorComponent`. Reuse pure `src/navigation.js` nearly as-is and adapt gameplay/components/tests; omit `create-scene.js`, standalone bootstrap, runtime builder, and binary authoritative GLB. |
| Snapshot tests | **REUSE THE IDEA** | Add small, reviewed golden fixtures to `engine/test/unit/sceneSerialization.test.ts` and `kite3d/test/{journal,scene-diff}.test.ts`. Do not import the five huge AI-format snapshots, auto-creation behavior, or warning-only size benchmark. |

## 4. Focused comparisons

1. **Module reload vs F3.** Kite3D fix pass F did fix the reported direct-entry stale-class case: `createGame.ts` appends each listed file’s SHA, `scripts.ts` replaces an existing `ComponentType` constructor, and `App.tsx` disposes/recreates the active game. `dev-server.spec.ts:164–172` verifies direct `.script.js` and `.plugin.js` updates plus SHA URLs. However, it does **not** verify an unlisted dependency changed behind an unchanged entry module. The prototype’s graph invalidation and cycle test cover that remaining case. Port the test and solve it with parsed/re-written ESM dependencies or a project-wide transformed revision; the direct fix alone does not prove transitive hot reload.

2. **Inspector source editor.** Its asynchronous draft-generation model is worth retaining: it rejects late reads, snapshots the draft being saved, preserves edits typed during save, and makes conflicts explicit. Its I/O is not: when companion-connected it performs a companion write and then an FSA write. Kite3D should have exactly one ETag-aware `ProjectSource.write`, SSE for external changes, a server-defined text-file policy, and publish blocking tied to panel dirty state.

3. **Web export vs Kite3D publish.** Their playable ZIP is a last-saved build artifact transferred as base64 over WebSocket, capped at 64 MiB and requiring static HTTP. Kite3D already produces a content-addressed manifest, uploads only missing blobs, creates idempotent releases, injects installed runtime bytes, and serves through its gateway. Take packaging safety and independent-launch tests, not ZIP delivery. Their source ZIP is potentially useful later as `kite3d archive`, but it is orthogonal to deploy.

4. **Empty template and AGENTS.** Their scaffold is genuinely blank and its 12-line AGENTS file has an unusually crisp authored/template/generator contract, but it carries Vite, Node 22, a lockfile, generated runtime preparation, binary GLB authority, and Kite-specific component metadata. Kite3D’s smaller package, checked-in text glTF, shared engine, and `kite3d` CLI are the right scaffold. Distill their strongest rules into Kite3D’s 918-line AGENTS template rather than copying the project.

5. **Deterministic scene construction.** The prototype proves deterministic behavior by issuing stable-ID MCP mutations into an initially empty binary GLB and comparing semantic snapshots after save/reload. Kite3D’s model is stronger for terminal agents: `sceneSerialization.ts` emits recursively sorted text glTF, stable UUIDs, external `.bin`, and content-hashed textures; scripts can edit it directly, while `GeneratorComponent` excludes generated children until an explicit bake. Retain their semantic authoring invariants and negative fixtures, not their transport-driven builder.

6. **Playable starter runtime vs `createGame`.** The prototype has a shared helper library but still maintains generated player boot code, per-project vendored runtime preparation, and sample-specific standalone boot. Kite3D has one `createGame` sequence for editor and published execution: fixed plugin graph, same engine instance, versioned project modules, scene/nested-asset loading, generators, physics/timeline/components, and `main`. Port runtime ownership, telemetry, and validation helpers into the engine; do not add another bootstrap path.

## 5. Quality observations

Worth copying:

- End-to-end assertions that close the companion and launch output from an independent static server.
- Positive and negative authoring fixtures rather than object-count or genre-specific rules.
- Save → reload → page reopen → play/stop → semantic comparison.
- Stale revisions, duplicate operation IDs, traversal, symlink races, batch rollback, crash, cancellation, and late-mutation tests.
- Fake provider fixtures plus a small, clearly separated live-provider evidence boundary.
- Tests for component-before-plugin-before-scene ordering and user-visible startup failures.
- Explicit documentation of what automation did not prove.

Fragility/slop:

- Core behavior is concentrated in 1,577-, 991-, 855-, and 768-line files with transport, domain logic, UI, and recovery interleaved.
- `SourceEditorPanel`’s companion-plus-FSA double-write risks divergent revisions.
- Static-import parsing by regex is brittle around syntax variants and nonliteral resolution.
- `project-player.spec.ts` contains at least one ineffective bare `expect(value)` with no matcher.
- Snapshot tests silently create missing goldens; format-size regressions warn rather than fail, and fixtures exceed 10,000 lines.
- Baseline editor tests fetch network assets, reducing hermeticity.
- Three partially duplicated boot/runtime paths invite drift.
- Base64 ZIP transfer inflates memory significantly above the nominal 64 MiB limit.
- Several gameplay tests rely on short timing windows and already showed load-sensitive failures.
- Repeated repository-wide lint failures make focused regressions harder to distinguish from inherited debt.

## 6. Top 10 items worth taking

1. **3B authoring contract and negative validator fixtures** - highest value/effort; about 3–4 engine/test files.
2. **Condensed AGENTS representation and cleanup rules** - very high value/effort; 1 template file plus 1 init test.
3. **Transitive re-export/cycle hot-reload regression** - very high value/effort; 1–2 test/implementation files.
4. **Save/reopen/play/stop semantic persistence gate** - high value/effort; 2–3 engine/editor test files.
5. **Source-editor draft/conflict state machine** - high value, moderate integration; about 3 editor files plus 1 test.
6. **Publish retry, uncertain-write, symlink, and hash-verification matrix** - high value/effort; 2–3 Kite3D publish/test files.
7. **Runtime-root ownership and mandatory cleanup helper** - high value/effort; 2 engine files plus tests.
8. **Genre-neutral telemetry and project validation hooks** - good value/effort; 2–3 engine/template files.
9. **Crystal Vault as a nontrivial `createGame` fixture** - strong integration coverage, higher effort; roughly 8–12 fixture/test files.
10. **Doctor-style CLI diagnostics** - useful onboarding improvement; about 2 CLI/test files.

No files were modified.
