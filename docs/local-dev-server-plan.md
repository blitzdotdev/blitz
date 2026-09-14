# Local dev server plan

Date: 2026-09-09, evening. Status: plan, approved direction. Replaces the Chrome File System Access approach for local projects.

## Decision

A local server owns the project folder. The user's agent installs and runs it. The editor talks to it over HTTP on localhost. No folder picker, no browser file permissions, no service worker, no IndexedDB. The agent can create a project, start the server, open the editor, and edit files with no human action. The human opens one URL when they want to look or edit.

## Shape

One npm package, `kite3d`, with the bin named `kite3d` and the editor build inside it. The unscoped npm name `kite3d` belongs to the Kite3D.js framework, so the package is scoped and the command is `kite3d`. After `npm i -g kite3d` the command is `kite3d`; without a global install it is `npx kite3d`.

```
kite3d init my-game     # writes the project template and AGENTS.md
kite3d dev              # serves the editor and the project at http://127.0.0.1:4321/?t=<token>
kite3d open             # opens the editor URL in the default browser
```

`dev` serves everything from one origin, so nothing needs CORS, private-network permission, or mixed-content exemptions:

| Route | Purpose |
|---|---|
| `GET /` | the editor UI for this version |
| `GET /editor-runtime.js` | the editor's shared engine module graph, used by play mode |
| `GET /api/files` | manifest of the project: path, size, sha256, mtime, with the exclusion list applied |
| `GET /files/<path>` | file bytes with the right MIME and `ETag: "<sha256>"`; scripts load as plain ES modules from here |
| `PUT /files/<path>` | write; `If-Match: "<sha256>"` or `*`; `412` on mismatch; creates directories |
| `DELETE /files/<path>` | delete |
| `GET /api/events` | server-sent events: `change`, `add`, `unlink`, each with path, sha256, and the client id that wrote it, debounced |
| `GET /api/state` | project name, version, deploys, server version |

Security: bind `127.0.0.1` only. A random token in the URL query, echoed by the editor in a header, required on every request. Reject requests whose `Host` is not localhost. Reject paths that escape the folder. Never serve `.git`, `node_modules`, or dotfiles other than `.kite3d`.

## Editor changes

- One `ProjectSource` interface: `list`, `read`, `write(path, bytes, ifMatch)`, `delete`, `events`. One implementation: `DevServerSource`. HTTP to the local server.
- Delete: `fsApi.ts`, the directory handles and recent list in IndexedDB, `BrowserFileStore.ts`, `FileSystemObserver` use in `ScriptUtil.ts`, `fsImporter.ts`, `public/fs-sw.js`, `FetchProxy.ts`, the open-folder and new-folder dialogs. Assets resolve with the runtime's URL modifier to `/files/<path>`.
- Play mode calls `createGame({base: '/files/'})`. That collapses the three play paths into one.
- Echo and conflicts: every editor write carries its client id and the expected hash. An event with the editor's own id is ignored. A `412` on write reloads the file and asks the human. Unsaved edits are never overwritten silently.
- Scene writes are debounced to transaction ends.

## Versioning

The project's `devDependencies` select `kite3d`. Exact specs are checked directly; other specs resolve through the installed package metadata. Every command except help, version, `doctor`, and `upgrade` compares itself with that version. A mismatch delegates to the installed local binary or refuses with install and pinned `npx` instructions. `doctor` reports the mismatch, while `kite3d upgrade` stays in the invoked CLI, updates the pin and `kite3d.version` to that CLI's version, installs without lifecycle scripts, runs every migration it knows, and validates the scene. npm is the versioned store for editor, runtime, template, and `agents.md`. See `docs/open-source-split.md` for the packages.

## No hosted editor

The editor runs only from `kite3d dev`. There is no editor on any domain and no follow mode. Releasing is an agent task described by a bundled skill. Claiming remains a command-line task. blitz.dev is the store, see `docs/storefront-plan.md`.

## Agents

`agents.md` says: run `kite3d init`, run `kite3d dev`, print the editor URL, and edit files. Requirement: Node 20 or newer.

## Phases

**C1. `kite3d`, server, editor source, packages.** `kite3d` with project tools, the local server, and bundled agent skills. `packages/engine` extracted, `packages/editor` moved to `packages/editor`, and the starter moved to `packages/kite3d/template`. The editor on `DevServerSource`, the deletions above, play mode through `createGame`. Tests: server unit and integration, and an editor Playwright suite that runs against a real dev server. The editor E2E becomes fully automatable, because no folder picker is involved.

**C2. Scene model.** The glTF source of truth, the `Generator` component, and scoped bake from the review, section 7, item 8.

**Release.** `deploy:editor` also publishes `kite3d` to npm with the editor and runtime inside, and registers the runtime hash with the backend.

## What this replaces

- NOW-1 in `PLAN.md`: the watcher, echo, conflict, IndexedDB, and bootstrapper items are all served by the local server.
- Phase B part 1, running now: kept. Its API client, manifest, index.html generator, backend guard, CORS, and agents.md are reused by `kite3d`. Its browser folder walker is dropped.
