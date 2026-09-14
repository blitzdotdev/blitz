# Layout after the split

Date: 2026-09-09, evening. Status: agreed. Two repositories. Everything open is Apache-2.0.

## Public: `blitzdotdev/kite3d`

```
kite3d/
  package.json                 npm workspaces: packages/*
  LICENSE                      Apache-2.0
  README.md
  PLAN.md                      the owner's plan
  docs/
    agents.md                  source of blitz.dev/agents.md; kite3d init copies it into projects
    publish-api.md             the cloud contract; the private repo implements it
    layout.md, local-dev-server-plan.md, open-source-split.md, storefront-plan.md, e2e-test-plan.md
  packages/
    engine/                    @kite3d/engine     runtime, project format, scripting API, game plugins
    editor/                    @kite3d/editor     the editor app
      uiconfig-blueprint/      editor-only vendored upstream source; resolved by editor aliases, not published
    kite3d/                    kite3d               bin `kite3d`: project tools, bundled agent skills, and the local server
      template/                                     files written by `kite3d init`; shipped inside the CLI
    threepipe/                 vendored upstream subtree; drop once a build against npm threepipe passes
```

Package dependencies: `kite3d` -> `engine`, `editor`. `editor` -> `engine`, `uiconfig-blueprint`. `engine` -> `threepipe`, `uiconfig.js`, `ts-browser-helpers`, `cannon-es`, the `@threepipe/*` plugins it bundles. The three published packages ship their source and built output; `kite3d` also ships its starter template. The root build compiles the unchanged nested `uiconfig-blueprint` source, and editor Vite aliases resolve that local output and stylesheet. The editor's `files` allowlist excludes the vendored tree from its tarball.

Tests that live here: engine unit tests, the runtime Playwright test, the `kite3d` server tests, and the editor Playwright suite that runs against a real `kite3d dev`.

## Private: `blitzdotdev/blitz-cloud`

Created from `services/` with history kept (`git filter-repo --path services/` on a clone, then move the three directories to the root). `services/` is then removed from the public repo.

```
blitz-cloud/
  backend/                     worker blitz-backend: the API and the blitz.dev store
  game-gateway/                worker blitz-game-gateway: <slug>.app.blitz.dev
  asset-library-proxy/         worker for the editor's asset library panel
  docs/                        runbooks, the backend build report, the cloud half of the E2E gate
```

## Exactly what goes into `@kite3d/engine`

Moved from `packages/editor/src/runtime/` (Phase A, 651 lines, already free of React and UI imports):

| File | Lines | Contents |
|---|---|---|
| `createGame.ts` | 276 | `createGame({base, canvas, onError})` -> `{viewer, project, dispose}`; the runtime plugin set; URL modifier for `/kite3d/@id/` and `/kite3d/<path>`; load order: plugins and component types before the scene, then timeline, components, physics, `main.js` |
| `nestedAssets.ts` | 220 | `RuntimeNestedAssetLoader`: `userData.rootPath` references, caching, override preservation |
| `projectFormat.ts` | 145 | `settingsKey`, `assetUrlPrefix`, `parsePackageJSON`, `parseAssetsJSONManifest`, `parsePackageJsonSettingsConfig`, the project types |
| `index.ts` | 10 | `RUNTIME_VERSION`; re-exports of `threepipe`, `uiconfig.js`, `ts-browser-helpers` |

Moved from `packages/editor/src/plugins/` (3,471 lines):

| Files | Lines | Contents |
|---|---|---|
| `cannon/CannonPhysicsPlugin.ts`, `Cannon3DBodyComponent.ts`, `Cannon3DShapeComponent.ts`, `CannonRagdollComponent.ts`, `helper.ts`, `threeToCannon.ts`, `utils.ts` | 2,949 | physics plugin and its components on cannon-es |
| `HtmlUiComponent.ts`, `HtmlUiComponent.example.ts`, `HtmlUiComponent.md` | 522 | HTML UI component and its documented example |

Extracted from editor utils, runtime parts only:

| New file | From | Contents |
|---|---|---|
| `scripts.ts` | `ScriptUtil.ts` 470-574 and the copy inside `createGame.ts` | `registerScripts(viewer, modules)`: the export walk that registers component types and plugins. The editor and the runtime call the same function. Hot reload stays in the editor. |
| `importMap.ts` | `utils/importMaps.ts` 52 | `dependencyImportMap(deps)` for project-declared extra dependencies; used by the `index.html` generator in `kite3d` and by `kite3d dev` |
| `defaults.ts` | `data/EmptyProjectSettings.ts` 277 | default project and viewer settings applied when a project omits them |
| `fileTypes.ts` | `data/fileTypes.ts` 22 | asset extension and MIME map |
| `paths.ts` | scattered constants | `.kite3d/` layout: `deploys.json`, `thumbs/`, `backups/`, `running/` |

Added later, in the engine because both the editor and the runtime need them:

- `GeneratorComponent` (C2): `{module, params}` on a node; runs at load; children tagged generated and excluded from export; scoped bake support.
- `GameHandle` (deferred item): `tick`, scripted input, pause and step, on top of `createGame`.

Builds: `dist/index.js`, an ES library with `threepipe` and friends as externals for bundlers, and `dist/runtime.js`, the single-file bundle that published games load. Both from the same source.

Not in the engine, and why:

- `AssetTracker.ts`, `assetTrackerUtils.ts`: editor-side asset instance tracking and override UI. The runtime port in `nestedAssets.ts` covers loading.
- `ScriptUtil.ts` hot reload, `modules.ts`: editor and dev-server concerns.
- `FetchProxy.ts`, `fsImporter.ts`, `fsApi.ts`, `BrowserFileStore.ts`, `AssetsProvider.ts`, `public/fs-sw.js`: deleted in C1 with the File System Access approach.
- `projectTemplates.ts`, `AgentsMdTemplate.md`: become the template bundled in `kite3d`.
- Everything React, Blueprint, and uiconfig-blueprint: the editor.
