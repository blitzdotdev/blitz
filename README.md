<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/kite3d-logo-dark.svg">
    <img src="docs/assets/kite3d-logo.svg" width="140" alt="Kite3D logo">
  </picture>
</p>

<h1 align="center">Kite3D</h1>

<p align="center">
  Build 3D games in your browser with AI<br>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/kite3d"><img src="https://img.shields.io/npm/v/kite3d?label=kite3d&color=2d72d2" alt="npm version"></a>
  <a href="https://github.com/blitzdotdev/kite3d/actions/workflows/release.yml"><img src="https://github.com/blitzdotdev/kite3d/actions/workflows/release.yml/badge.svg" alt="release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache-2.0"></a>
  <a href="https://blitz.dev"><img src="https://img.shields.io/badge/play-blitz.dev-f0a020" alt="blitz.dev"></a>
</p>

---

## Quickstart

Paste this prompt into your agent:

```
use npx kite3d and build me an FPS shooting practice game
```

Or manually install:

```sh
npx kite3d init my-game
cd my-game && npm install
npx kite3d dev        # local editor, keeps running while you edit
```

The first `init` or `dev` on a machine registers a `kite3d://` link, so the "Open engine" button on [kite3d.dev](https://kite3d.dev) opens the picker of every project on that machine. `npx kite3d open` does the same from a terminal.

## Features

- **Agent-native.** One prompt builds a game. The CLI teaches the loop and ships its source to grep.
- **ECS.** Behavior lives in components attached to scene nodes, one script each.
- **Text glTF scene.** Agents and humans edit the same file. Git diffs it. Saving an unchanged scene writes the same bytes.
- **Hot-reloaded components.** Save a script, the editor swaps it in place.
- **Play in the editor.** Play, pause, pick and move objects in the paused world, resume, stop back to the saved scene.
- **Local browser editor.** Served from your folder. No account.

## CLI

| Command | Does |
|---|---|
| `kite3d init <dir>` | Create a project |
| `kite3d dev` | Start the local editor for the project in the current folder |
| `kite3d open` | Open the project picker: every project on this machine, running ones marked |
| `kite3d install` | Register the `kite3d://` link by hand; `--remove` undoes it |
| `kite3d screenshot` | Save a PNG of the editor viewport |
| `kite3d skills` | List bundled skills with absolute `SKILL.md` paths |
| `kite3d publish` | Print the bundled publishing procedure path |

`npx kite3d skills` lists skills bundled with the invoked CLI and works outside a project, including from an npx cache or global install. Pass `--json` for structured output.

Run `npx kite3d` with no argument for the full list.

## Packages

| Package | What it is |
|---|---|
| [`kite3d`](packages/kite3d) | The `kite3d` command: local server, project picker, screenshots, and bundled agent skills |
| [`@kite3d/engine`](packages/engine) | UI-free runtime, project format, scene serializer, scripting helpers, game plugins |
| [`@kite3d/editor`](packages/editor) | The React editor served by `kite3d dev`, a fork of [threepipe-blueprint-editor](https://github.com/repalash/threepipe-blueprint-editor) with its history |
| [`packages/kite3d/template`](packages/kite3d/template) | Starter files bundled in `kite3d` and copied by `kite3d init` |
| [`packages/threepipe`](packages/threepipe), [`packages/uiconfig-blueprint`](packages/uiconfig-blueprint) | Vendored upstream source |

Everything is Apache-2.0 and ships its source, so an agent can grep `node_modules` when the guide is not enough. Built on [threepipe](https://threepipe.org).

## License

Apache-2.0. See [LICENSE](LICENSE).
