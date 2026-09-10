# Engine gotchas collected by the E2E test agents

Source: memory notes written by the real-user E2E agents on 2026-09-09 and 2026-09-10, moved out of the assistant's memory so later E2E runs start fresh. Each claim must be checked against the code before it goes into the AGENTS template. Known corrections from the run 2 review: the pointer-lock refusal is headless Chrome, not the editor page (not tested headed); `blitz.name` in package.json IS honoured by the CLI (publish.ts reads it); `blitz pull` before the first publish currently exits 1, which is finding G6.

Gotchas found while building an FPS practice game on `@blitzdev/blitz` 0.12.0
(engine = threepipe). Source: /Users/minjunes/blitz-games/fps-practice, 2026-09-09.

- Materials: `MeshStandardMaterial2` and `MeshBasicMaterial2` are deprecated and
  log an error per instance. Use `PhysicalMaterial` and `UnlitMaterial`. Use
  `Mesh2`, not `Mesh`.
- An empty scene has no environment map, so `PhysicalMaterial` renders near
  black even with `AmbientLight2` plus `DirectionalLight2`. Flat `UnlitMaterial`
  is the reliable look when you build geometry in code.
- Disposal: threepipe's `dispose(true)` already walks the children. Calling it
  inside `traverse()` removes siblings mid-walk and throws
  `Cannot read properties of undefined (reading 'traverse')`. Call
  `root.dispose(true)` once on the root instead.
- The Blitz editor page refuses pointer lock. It rejects with
  `WrongDocumentError: The root document of this element is not valid for
  pointer lock.` Pointer lock also needs real OS window focus, so it fails in
  headless and in unfocused automated windows. Any FPS needs a cursor-aim
  fallback to be testable in the editor.
- `viewer.container` is the whole window in the editor and is not a positioned
  element. An `inset:0` HUD lands on the editor's own panels. Place the HUD with
  `position:fixed` and copy `canvas.getBoundingClientRect()` each frame.
- You can wire a component without the editor UI. Write the scene `.gltf` node
  with `extras.EntityComponentPlugin = {"<uuid>": {type, state}}`, and list the
  script in `package.json` under `blitz.scripts`.
- `main.js` `main({viewer})` runs after the scene loads and after components
  start. It sets `window.viewer`, which is the handle for driving tests.
- `blitz dev` serves only the editor. To test the published runtime locally,
  serve the project folder yourself and map `/_blitz/runtime.js` to
  `node_modules/@blitzdev/engine/dist/runtime.js`, with an import map that
  points `threepipe`, `three`, `uiconfig.js` and `ts-browser-helpers` at it.
- Run `npx blitz pull` before the first publish and it says
  `No deploy exists yet`. That is expected, not an error.

Related: [[reference-local-playwright-chrome]], [[project-blitz-games]]

Update 2026-09-09 (fps-drill build, packs rebuilt 22:40):
- The hosted runtime DOES run `Generator` components (createGame registers
  GeneratorComponent and awaits it before `start()`). The fps-shooter comment saying
  otherwise is stale. A Generator module may import project libs with relative paths.
- Editor Play mode calls the same `createGame` as the published page (base `/files/`),
  so editor tests are representative. A `.script.js` change restarts play in about 1 s.
- Component `uuid` is the stable scene id (for example `fd-comp-drill-manager`), not a
  random id. To detect a restart, tag `window.viewer` and watch the tag vanish.
- `blitz.viewer` in package.json spreads into ThreeViewer options: `{msaa: true, tonemap: false}`
  works and keeps unlit colours exact.
- Editor automation selectors: `[data-testid="play"]` (Play/Stop), `header p` status text
  (`Project loaded`, `Playing`, `<path> reloaded`), `[data-testid="component-types"] li`,
  `[data-testid="scene-hierarchy"] .generated-badge`. `/api/*` needs `X-Blitz-Token`.
- `blitz.name` in package.json is ignored by the CLI; pass `npx blitz publish --name`.
- `npx blitz pull` before the first publish prints `There is nothing to pull before the first publish.`
- The first streak hit should pay base points: use `1 + min(max(0, streak - 1), 10) * 0.1`.
