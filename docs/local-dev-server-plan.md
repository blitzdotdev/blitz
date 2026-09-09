# Local dev server plan

Date: 2026-09-09, evening. Status: plan, approved direction. Replaces the Chrome File System Access approach for local projects.

## Decision

A local server owns the project folder. The user's agent installs and runs it. The editor talks to it over HTTP on localhost. No folder picker, no browser file permissions, no service worker, no IndexedDB. The agent can create a project, start the server, open the editor, edit files, and publish, with no human action. The human opens one URL when they want to look or edit.

## Shape

One npm package, `@blitzdev/blitz`, with the bin named `blitz` and the editor build inside it. The unscoped npm name `blitz` belongs to the Blitz.js framework, so the package is scoped and the command is `blitz`. After `npm i -g @blitzdev/blitz` the command is `blitz`; without a global install it is `npx @blitzdev/blitz`.

```
blitz init my-game     # writes the project template and AGENTS.md
blitz dev              # serves the editor and the project at http://127.0.0.1:4321/?t=<token>
blitz publish          # walks, hashes, uploads, releases; prints the live URL
blitz pull             # downloads the active release into the folder
blitz open             # opens the editor URL in the default browser
```

`dev` serves everything from one origin, so nothing needs CORS, private-network permission, or mixed-content exemptions:

| Route | Purpose |
|---|---|
| `GET /` | the editor UI for this version |
| `GET /_blitz/runtime.js` | the runtime, used by play mode |
| `GET /api/files` | manifest of the project: path, size, sha256, mtime, with the exclusion list applied |
| `GET /files/<path>` | file bytes with the right MIME and `ETag: "<sha256>"`; scripts load as plain ES modules from here |
| `PUT /files/<path>` | write; `If-Match: "<sha256>"` or `*`; `412` on mismatch; creates directories |
| `DELETE /files/<path>` | delete |
| `GET /api/events` | server-sent events: `change`, `add`, `unlink`, each with path, sha256, and the client id that wrote it, debounced |
| `POST /api/publish` | runs publish on the server, returns the live URL and release hash |
| `POST /api/pull` | runs pull |
| `GET /api/state` | project name, version, deploys, server version |

Security: bind `127.0.0.1` only. A random token in the URL query, echoed by the editor in a header, required on every request. Reject requests whose `Host` is not localhost. Reject paths that escape the folder. Never serve `.git`, `node_modules`, or dotfiles other than `.blitz`.

## Editor changes

- One `ProjectSource` interface: `list`, `read`, `write(path, bytes, ifMatch)`, `delete`, `events`. Two implementations: `DevServerSource` (this server) and `CloudSource` (the backend releases, for follow mode). Both are HTTP.
- Delete: `fsApi.ts`, the directory handles and recent list in IndexedDB, `BrowserFileStore.ts`, `FileSystemObserver` use in `ScriptUtil.ts`, `fsImporter.ts`, `public/fs-sw.js`, `FetchProxy.ts`, the open-folder and new-folder dialogs. Assets resolve with the runtime's URL modifier to `/files/<path>`.
- Play mode calls `createGame({base: '/files/'})`. That collapses the three play paths into one.
- Echo and conflicts: every editor write carries its client id and the expected hash. An event with the editor's own id is ignored. A `412` on write reloads the file and asks the human. Unsaved edits are never overwritten silently.
- Scene writes are debounced to transaction ends.
- The undo journal and the agent mirrors come from the server: it appends `.blitz/journal.jsonl` with a semantic diff of the scene file on each write, and the editor writes `.blitz/state.json` and `.blitz/console.log` through `PUT`.

## Versioning

`package.json` has `blitz.version`. `blitz` reads it. If it differs from its own version, it re-runs itself as `npx @blitzdev/blitz@<version>`. npm is the versioned store for editor, runtime, template, and `agents.md`. No bootstrapper page is needed.

## Hosted editor

`editor.blitz.dev` keeps the editor for follow mode only: `?game=<slug>#token=…` loads a published game from the gateway, refreshes on each release, and Save publishes. It no longer offers local folders. `blitz.dev` itself is the store for published games and serves the canonical `agents.md`. See `docs/storefront-plan.md`.

## Agents

`agents.md` says: run `blitz init`, run `blitz dev`, print the editor URL, edit files, run `blitz publish`, print the live URL. Pull before publish. Read `.blitz/journal.jsonl` after the human has been editing. Requirement: Node 20 or newer.

## Phases

**C1. `blitz`, server, editor source.** `@blitzdev/blitz` with `init`, `dev`, `publish`, `pull`, `open`. The editor on `DevServerSource`, the deletions above, play mode through `createGame`. Tests: server unit and integration, and an editor Playwright suite that runs against a real dev server. The editor E2E becomes fully automatable, because no folder picker is involved.

**C2. Cloud source and dialog.** `CloudSource` for follow mode, the publish and claim dialog calling `/api/publish` locally or the backend directly in cloud mode. Then the glTF source of truth and the `Generator` component from the review, section 7, item 8.

**Release.** `deploy:editor` also publishes `@blitzdev/blitz` to npm with the editor and runtime inside, and registers the runtime hash with the backend.

## What this replaces

- NOW-1 in `PLAN.md`: the watcher, echo, conflict, IndexedDB, and bootstrapper items are all served by the local server.
- Phase B part 2 as specified in `docs/publish-dialog.md`: the dialog stays, the folder walk in the browser goes; `blitz publish` walks.
- Phase B part 1, running now: kept. Its API client, manifest, index.html generator, backend guard, CORS, and agents.md are reused by `blitz`. Its browser folder walker is dropped.
