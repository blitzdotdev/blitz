# Open source split

Date: 2026-09-09, evening. Status: plan, approved direction.

## The PlayCanvas model

- Engine: open source, MIT, npm package `playcanvas`, GitHub `playcanvas/engine`.
- Editor frontend: open source, MIT since August 2025, GitHub `playcanvas/editor`. Built on their open libraries Observer, PCUI, and PCUI-Graph.
- Backend: proprietary. The open editor frontend still needs the PlayCanvas cloud to run. Local development loads the frontend from localhost against playcanvas.com.

Sources: [PlayCanvas Editor Frontend is now Open Source](https://blog.playcanvas.com/playcanvas-editor-frontend-is-now-open-source/), [playcanvas/editor](https://github.com/playcanvas/editor), [playcanvas/engine](https://github.com/playcanvas/engine).

## The Kite3D model

Same split, with one difference: the Kite3D editor runs standalone on the developer's machine. The file system is its backend. The cloud is only for publishing and the store.

Open, Apache-2.0 to match threepipe and uiconfig-blueprint:

| Package | Contents | Ships |
|---|---|---|
| `@blitzdev/engine` | the runtime: `createGame`, project format, loaders, scripting API, game plugins such as physics, HTML UI, and later the `Generator` component. Depends on `threepipe`. | `dist/`, `src/`, source maps |
| `@blitzdev/editor` | the editor app. React and its nested uiconfig-blueprint source. Built to static files that `kite3d dev` serves. | `dist/`, `src/`, source maps |
| `kite3d` | the `kite3d` command: `init`, `dev`, `publish`, `pull`, `open`. Depends on engine and editor. | `dist/`, `src/`, `template/` |

The new-project files live in `packages/kite3d/template/` and ship inside the `kite3d` tarball.

Upstream, consumed from npm and improved by pull requests: `threepipe` and `uiconfig-blueprint`, both Apache-2.0 by repalash. The monorepo vendors `threepipe` as a shared workspace and resolves `uiconfig-blueprint` from editor-only nested source while local changes exist.

Closed, the cloud, like PlayCanvas's backend: `services/backend` (API and store), `services/game-gateway`, `services/asset-library-proxy`.

## Agents grep everything

A project's `package.json` has `devDependencies: { "kite3d": "<version>" }`. After `npm install`, `node_modules` holds the source of the engine, the editor, the command, and threepipe. `kite3d init` writes an AGENTS.md that maps them:

```
node_modules/@blitzdev/engine/src     runtime, project format, scripting API
node_modules/@blitzdev/editor/src     editor
node_modules/kite3d/src      command and local server
node_modules/threepipe/src            engine core, glTF, plugins
node_modules/uiconfig-blueprint/src   editor UI kit
```

If the published `threepipe` tarball lacks `src/`, `kite3d sources` fetches the tagged upstream source into `.kite3d/upstream/` for grepping.

The devDependency is the version pin. `npx kite3d` runs the local bin at that version. `kite3d.version` in package.json is not needed.

## Repository

Today the monorepo has no remote. Before it goes public, decide: keep `services/` in the public repo, or move them to a private `blitzdotdev/blitz-cloud`. PlayCanvas keeps the backend private. Until then the whole repo stays private.

The editor code comes from repalash's private `threepipe-blueprint-editor`. Confirm the rights before publishing it under Apache-2.0.

## What changes in the layout

- `packages/editor` becomes `packages/editor` and gets a publishable package.json.
- `packages/engine` is created from `packages/editor/src/runtime`, `src/plugins`, and the runtime-only utils. Phase A already isolated `src/runtime` from React and UI code.
- `packages/kite3d` is new and owns its starter template.
- There is no hosted editor. The `kite3d-editor` worker on workers.dev is a test artifact from today and goes away after C1.
