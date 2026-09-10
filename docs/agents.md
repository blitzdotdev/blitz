# Build a Blitz game

Node.js 20 or newer is required.

```sh
npx @blitzdev/blitz init my-game
cd my-game
npm install
npx blitz dev
```

The last command prints `http://127.0.0.1:4321/?t=...`. Edit source files while it runs. Read `.blitz/state.json` and `.blitz/console.log` for feedback. Before publishing, run `npx blitz pull`, then `npx blitz publish --message "what changed"`; report the live URL.

Installed source is available at `node_modules/@blitzdev/engine/src`, `node_modules/@blitzdev/editor/src`, `node_modules/@blitzdev/blitz/src`, `node_modules/threepipe/src`, and `node_modules/uiconfig-blueprint/src`. The full scripting API, lifecycle guidance, examples, publishing rules, and limits are copied into each new project's `AGENTS.md` by `blitz init`.
