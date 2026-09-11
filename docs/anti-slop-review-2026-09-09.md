# Anti-slop review - 2026-09-09

- Scope: 28 findings in our code; 3 findings marked INHERITED.
- S1 4 · S2 2 · S3 1 · S4 3 · S5 2.
- S6 3 · S7 8 · S8 1 · S9 5 · S10 2.
- Primary code: ~248 removable lines; INHERITED editor code: ~111 removable lines.
- Total: 31 findings; ~359 removable lines.

## Our code

S1 packages/engine/test/unit/generator.test.ts:54 - a 27-line fake reimplements Object3D add/remove/traverse for one test - use a real threepipe Group/Object3D after the existing deferred import - ~25 lines removable
S5 packages/editor/src/App.tsx:288 - the React component owns generator bake mechanics, export flags, component removal, and baked metadata - move bake into GeneratorComponent/an engine helper and leave the UI to invoke it and save - ~24 UI lines removable
S4 packages/kite3d/src/publish.ts:301 - a second four-worker upload pool duplicates Kite3dApi.uploadBlobs and its progress machinery - call the existing Kite3dApi pool and keep one upload owner - ~24 lines removable
S1 packages/editor/src/DevServerSource.ts:137 - a hand-written fetch/reader/decoder/frame parser recreates the browser SSE client - use EventSource with the existing same-origin cookie and pass the client id in the URL - ~20 lines removable
S5 packages/editor/src/App.tsx:261 - the UI parses and mutates the EntityComponentPlugin glTF storage shape, then separately mirrors it into the live component - move generator-state read/write to the engine project-format layer and reload runtime state from that result - ~15 UI lines removable
S9 packages/kite3d/src/publish.ts:17 - PublishApi exists only so tests can inject structural fakes; production has one Kite3dApi implementation - accept Kite3dApi and exercise it through the existing mock HTTP backend - ~15 lines removable
S6 packages/editor/src/publishing.ts:27 - the editor maintains a reserved-slug list and regex validator even though it immediately asks the authoritative availability endpoint - delete the local rule copy and use the debounced endpoint result - ~14 lines removable
S1 packages/editor/src/ProjectSource.ts:21 - ProjectSource has one implementation and its optional methods force impossible capability checks in App - use DevServerSource directly and make bake/commandResult ordinary required methods - ~12 lines removable
S7 packages/kite3d/src/server.ts:49 - assetLibraryProxyUrl is defaulted, returned by /api/state, typed by the editor, and copied to a DOM attribute that nobody reads - delete the entire option/state/attribute chain - ~9 lines removable
S7 packages/kite3d/src/publish.ts:32 - publish accepts three target forms (string slug, slug-bearing entry, separate entry), but every caller supplies only a string - accept a slug and derive the stored entry in publishProject - ~9 lines removable
S8 packages/editor/src/App.tsx:51 - blur autosave and the explicit Save button are synchronized with a 250 ms timer - choose one save trigger and call save directly - ~8 lines removable
S6 packages/editor/src/App.tsx:57 - scene text is mirrored in React state and a ref, with paired assignments across load, edit, conflict, save, and reload paths - keep React state authoritative and pass the next text explicitly to save/update callbacks - ~8 lines removable
S3 packages/engine/src/sceneSerialization.ts:154 - base64 decoding has a global Buffer fallback and missing-decoder branch even though every supported target (browser and Node >=20) supplies atob - call atob directly - ~8 lines removable
S4 .github/workflows/ci.yml:25 - aggregate gates rerun publish.test after the full Kite3D suite, and release.yml reruns the same build/typecheck/tests that release.mjs runs - run the focused suite only on demand and let release.mjs own common release validation - ~8 lines removable
S9 packages/kite3d/src/commands.ts:47 - commandVersion, install, and loadRuntime are production options with no production setter; upgrade.test alone supplies the latter two - call the concrete install/runtime loaders and test extracted migration selection plus one real upgrade path - ~7 lines removable
S10 packages/engine/src/runtime/projectFormat.ts:62 - the legacy missing-mainScene default invents a binary .glb scene and forces pass-through/empty-inspector compatibility branches in the text-only editor - require an explicit text .gltf mainScene at the package boundary and delete those branches - ~7 lines removable
S9 packages/engine/src/plugins/GeneratorComponent.ts:107 - injectable engine/importModule paths exist for the unit test while production always uses ThreePipe and dynamic import - hardcode the production imports and test with a real module URL - ~6 lines removable
S7 packages/engine/src/runtime/migrations.ts:8 - a no-op migration example is exported as production code and has no caller - delete it and keep the example in migration documentation - ~6 lines removable
S2 packages/engine/src/plugins/GeneratorComponent.ts:86 - generator failures are reported and converted to successful completion, so createGame and bake cannot observe failure - let the task reject and attach reporting only at detached lifecycle calls - ~4 lines removable
S2 packages/engine/src/runtime/createGame.ts:282 - the error reporter catches a throwing onError callback, logs, and continues even though the only production callback does not throw synchronously - invoke the callback directly and let its error follow the caller's failure path - ~4 lines removable
S1 packages/template/template/package.json:17 - the generated project writes empty plugins, scripts, and viewer configuration even though the parser supplies all three defaults - emit only kite3d.version until a setting actually exists - ~3 lines removable
S7 packages/template/template/main.js:5 - the template exports an onError hook that createGame never reads - delete the unused export - ~3 lines removable
S7 packages/engine/src/sceneSerialization.ts:4 - viewerConfig and textureHashLength are options no caller ever varies - hardcode the current true/16 contract until a second caller exists - ~2 lines removable
S9 packages/kite3d/src/server.ts:45 - token and editorDirectory are configurable only for server tests; production always generates/resolves them - generate and resolve them internally, and let tests use the returned token and built editor - ~2 lines removable
S6 scripts/register-runtime.mjs:47 - the runtime is statted only to obtain a size already present on the subsequently read Buffer - derive Content-Length from runtime.byteLength - ~2 lines removable
S9 scripts/set-version.mjs:73 - runCommand is an injection seam used only by set-version.test - call run directly and test the pure compute/rewrite helpers or execute the fixture command - ~1 line removable
S7 packages/kite3d/src/commands.ts:157 - publishFromDisk accepts a legacy string-or-options union, but every caller passes an options object - accept only PublishFromDiskOptions and delete the normalization branch - ~1 line removable
S7 scripts/register-runtime.mjs:37 - rootDirectory and fetchImplementation are options no real caller varies; release passes the same repository root already used by default - use repositoryDirectory and global fetch directly - ~1 line removable

## INHERITED - repalash/threepipe-blueprint-editor remainder

S10 packages/editor/package.json:18 - two legacy R2 deployment commands retain their own shell runner, rclone config, build/delete/sync pipeline, and dependency after the root release path replaced them - delete deploy:r2-legacy, deploy-tp, .rclone.conf, upload-r2.mjs, its utils, and rclone.js - ~72 lines removable
S4 packages/editor/scripts/register-runtime.mjs:1 - the inherited editor-local runtime registrar duplicates the root registrar/release owner and targets the obsolete editor dist/runtime.js path - delete it and remove the editor deploy hook in favor of scripts/register-runtime.mjs - ~33 lines removable
S7 packages/editor/src/vite-env.d.ts:3 - the virtual:importmap declaration remains from the fork but no module imports it - delete the unused declaration - ~6 lines removable

## What is clean

- Engine: runtime/index.ts, runtime/nestedAssets.ts, runtime/version.ts, and the migration registry itself; the manifest/import-map contracts and their golden/conformance coverage were also read and left alone.
- CLI: cli.ts, version-pin.ts, and versions.ts; the local-server Host/token/path guards and gateway-facing response parsing are justified boundary code.
- Template: AGENTS.md, assets.json, the starter glTF, icon, gitignore files, and samples/Spin.script.js.
- Editor: editorRuntime.ts, main.tsx, renderer.scss, current static assets, and the non-deployment inherited configuration files.
- Tests: all in-scope engine, Kite3D, editor, and script tests were opened; apart from the one Object3D fake above, no additional S1/S7 test ceremony was found. Binary fixture files were ignored as requested.
