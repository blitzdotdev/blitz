# Open source split

Date: 2026-09-09, evening. Status: plan, approved direction.

## The PlayCanvas model

- Engine: open source, MIT, npm package `playcanvas`, GitHub `playcanvas/engine`.
- Editor frontend: open source, MIT since August 2025, GitHub `playcanvas/editor`. Built on their open libraries Observer, PCUI, and PCUI-Graph.
- Backend: proprietary. The open editor frontend still needs the PlayCanvas cloud to run. Local development loads the frontend from localhost against playcanvas.com.

Sources: [PlayCanvas Editor Frontend is now Open Source](https://blog.playcanvas.com/playcanvas-editor-frontend-is-now-open-source/), [playcanvas/editor](https://github.com/playcanvas/editor), [playcanvas/engine](https://github.com/playcanvas/engine).

## The Blitz model

Same split, with one difference: the Blitz editor runs standalone on the developer's machine. The file system is its backend. The cloud is only for publishing and the store.

Open, Apache-2.0 to match threepipe and uiconfig-blueprint:

| Package | Contents | Ships |
|---|---|---|
| `@blitzdev/engine` | the runtime: `createGame`, project format, loaders, scripting API, game plugins such as physics, HTML UI, and later the `Generator` component. Depends on `threepipe`. | `dist/`, `src/`, source maps |
| `@blitzdev/editor` | the editor app. React and uiconfig-blueprint. Built to static files that `blitz dev` serves. | `dist/`, `src/`, source maps |
| `@blitzdev/blitz` | the `blitz` command: `init`, `dev`, `publish`, `pull`, `open`. Depends on engine and editor. | `dist/`, `src/` |
| `@blitzdev/template` | the new-project files: package.json, AGENTS.md, sample scripts. Used by `blitz init`. | files |

Upstream, consumed from npm and improved by pull requests: `threepipe` and `uiconfig-blueprint`, both Apache-2.0 by repalash. The monorepo vendors them as subtrees only while local changes exist.

Closed, the cloud, like PlayCanvas's backend: `services/backend` (API and store), `services/game-gateway`, `services/asset-library-proxy`.

## Agents grep everything

A project's `package.json` has `devDependencies: { "@blitzdev/blitz": "<version>" }`. After `npm install`, `node_modules` holds the source of the engine, the editor, the command, and threepipe. `blitz init` writes an AGENTS.md that maps them:

```
node_modules/@blitzdev/engine/src     runtime, project format, scripting API
node_modules/@blitzdev/editor/src     editor
node_modules/@blitzdev/blitz/src      command and local server
node_modules/threepipe/src            engine core, glTF, plugins
node_modules/uiconfig-blueprint/src   editor UI kit
```

If the published `threepipe` tarball lacks `src/`, `blitz sources` fetches the tagged upstream source into `.blitz/upstream/` for grepping.

The devDependency is the version pin. `npx blitz` runs the local bin at that version. `blitz.version` in package.json is not needed.

## Repository

Today the monorepo has no remote. Before it goes public, decide: keep `services/` in the public repo, or move them to a private `blitzdotdev/blitz-cloud`. PlayCanvas keeps the backend private. Until then the whole repo stays private.

The editor code comes from repalash's private `threepipe-blueprint-editor`. Confirm the rights before publishing it under Apache-2.0.

## What changes in the layout

- `apps/editor` becomes `packages/editor` and gets a publishable package.json.
- `packages/engine` is created from `apps/editor/src/runtime`, `src/plugins`, and the runtime-only utils. Phase A already isolated `src/runtime` from React and UI code.
- `packages/blitz` and `packages/template` are new.
- There is no hosted editor. The `blitz-editor` worker on workers.dev is a test artifact from today and goes away after C1.
