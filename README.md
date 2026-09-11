<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/kite3d-logo-dark.svg">
    <img src="docs/assets/kite3d-logo.svg" width="140" alt="Kite3D logo">
  </picture>
</p>

<h1 align="center">Kite3D</h1>

<p align="center">
  Build browser 3D games with an AI agent and a local editor.<br>
  One command to start. One command to publish.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/kite3d"><img src="https://img.shields.io/npm/v/kite3d?label=kite3d&color=2d72d2" alt="npm version"></a>
  <a href="https://github.com/blitzdotdev/kite3d/actions/workflows/release.yml"><img src="https://github.com/blitzdotdev/kite3d/actions/workflows/release.yml/badge.svg" alt="release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache-2.0"></a>
  <a href="https://blitz.dev"><img src="https://img.shields.io/badge/play-blitz.dev-f0a020" alt="blitz.dev"></a>
</p>

---

## Tell your agent

```
use npx kite3d and build me an FPS shooting practice game
```

That is the whole prompt. The CLI teaches the loop, and every project ships an `AGENTS.md` with the engine API and the rules.

## Or do it by hand

Node.js 20 or newer.

```sh
npx kite3d init my-game
cd my-game && npm install
npx kite3d dev        # local editor, keeps running while you edit
npx kite3d check      # proves the game is Playable, Editable, Persisted
npx kite3d publish    # live at https://<slug>.app.blitz.dev/
```

## How it works

- **Your folder is the game.** The scene is a text glTF file next to your scripts. Agents edit it with tools, humans edit it in the editor. Both see the same file.
- **The editor is local.** `kite3d dev` serves it from `127.0.0.1` against your project folder. Save a script and the game reloads.
- **Check before you ship.** `kite3d check` boots the game headlessly and fails on runtime errors, invisible authored content, and save-reload drift.
- **Publish is one upload.** Files are content-addressed and verified by hash. Every release keeps its own URL on [blitz.dev](https://blitz.dev), the store where games are played.

## What is in the box

| Package | What it is |
|---|---|
| [`kite3d`](packages/kite3d) | The `kite3d` command: local server, checks, checkpoints, publish |
| [`@blitzdev/engine`](packages/engine) | UI-free runtime, project format, scripting helpers, game plugins |
| [`@blitzdev/editor`](packages/editor) | The React editor served by `kite3d dev` |
| [`@blitzdev/template`](packages/template) | The files `kite3d init` copies |
| `packages/threepipe`, `packages/uiconfig-blueprint` | Vendored upstream source |

Everything is Apache-2.0 and ships its source, so an agent can grep `node_modules` when the guide is not enough. Built on [threepipe](https://threepipe.org).

## Commands

| Command | Does |
|---|---|
| `kite3d init <dir>` | Create a project and its Git repository |
| `kite3d dev` | Start the local editor |
| `kite3d check` | Run the Playable, Editable, Persisted checks |
| `kite3d checkpoint [label]` | Commit a checkpoint; `kite3d restore` brings one back |
| `kite3d publish` | Publish a release; `kite3d pull` fetches the active one |
| `kite3d doctor` | Verify the local setup |
| `kite3d upgrade` | Move a project to the current version, including projects made with the old `blitz` command |

Run `npx kite3d` with no argument for the full list.

## Develop this repo

```sh
npm install --ignore-scripts --cache /tmp/blitz-npm-cache
npm run build
npm run typecheck
npm run test:runtime
npm test -w packages/kite3d
npm test -w packages/editor
```

The editor's Library panel reads Polyhaven assets through a public read-only proxy; the URL is an editor constant.

Contracts and guides: [`docs/agents.md`](docs/agents.md), [`docs/publish-api.md`](docs/publish-api.md), [`docs/layout.md`](docs/layout.md), [`docs/releasing.md`](docs/releasing.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
