# Blitz

Blitz is an open, local-first game editor and runtime built on threepipe. The editor is served only by the `blitz` command and works against the project directory on the same `127.0.0.1` origin.

## Start a game

Node.js 20 or newer is required.

```sh
npx @blitzdev/blitz init my-game
cd my-game
npm install
npx blitz dev
```

The last command prints a tokenized editor URL. Edit project files directly; the editor watches and reloads them. Before a release, run `npx blitz pull`, then `npx blitz publish --message "what changed"`. `npx blitz open` reopens the active development URL.

## Packages

- `packages/engine`: `@blitzdev/engine`, the UI-free runtime, project format, scripting helpers, and game plugins.
- `packages/editor`: `@blitzdev/editor`, the static React editor served by `blitz dev`.
- `packages/blitz`: `@blitzdev/blitz`, the command, localhost server, disk adapter, and publishing client.
- `packages/template`: `@blitzdev/template`, real files copied by `blitz init`.
- `packages/threepipe` and `packages/uiconfig-blueprint`: vendored Apache-2.0 upstream source.

All public packages use Apache-2.0 and ship source for agent inspection. Cloud services are a separate concern and are not part of the root workspace build.

## Repository checks

```sh
npm install --ignore-scripts --cache /tmp/blitz-npm-cache
npm run build
npm run typecheck
npm run lint
npm run test:runtime
npm run test:publish
npm run test:blitz
npm test -w packages/editor
```

The root workspace is `packages/*`. See `docs/layout.md`, `docs/local-dev-server-plan.md`, `docs/open-source-split.md`, `docs/publish-api.md`, and `docs/agents.md` for the contracts.
