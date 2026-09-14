# kite3d

The Kite3D command creates, develops, and checks browser 3D games. It also points agents to bundled procedures for tasks such as releasing a game.

```sh
npx kite3d init my-game
cd my-game
npm install
npx kite3d dev
```

## Upgrading a project

Run `npx kite3d upgrade` with the CLI version you want to install. The command runs in the invoked CLI even when the project pins an older version, applies every migration that CLI knows, updates both project version fields, and reinstalls dependencies.

For the full command list and project guide, run `npx kite3d` or read the generated `AGENTS.md`.
