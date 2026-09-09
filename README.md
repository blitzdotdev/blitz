# Blitz

This repository is an npm workspace for the Blitz editor and its supporting packages.

## Layout

- `apps/editor/` is the Blitz browser editor.
- `packages/threepipe/` is the vendored `repalash/threepipe` `master` branch with full history.
- `packages/uiconfig-blueprint/` is the vendored `repalash/uiconfig-blueprint` `dev` branch with full history.
- `services/asset-library-proxy/` is the editor asset-library proxy.
- `services/backend/` is the Hono and teenybase API worker for game publishing.
- `services/game-gateway/` is the worker that serves published game assets.
- `docs/publish-api.md` documents the publishing API contract.
- `docs/backend-build-report-2026-09-09.md` records the backend build and deployment handoff.

## Commands

Install with `npm install --ignore-scripts --cache /tmp/blitz-npm-cache`.

- `npm run build:threepipe` builds `packages/threepipe/lib/`.
- `npm run build:ui` builds `packages/uiconfig-blueprint/dist/` and `packages/uiconfig-blueprint/lib/esm/`.
- `npm run build:editor` builds `apps/editor/dist/`.
- `npm run build` runs all three builds in dependency order.
- `npm run typecheck` type-checks the editor.
- `npm run typecheck:services` type-checks the backend and game gateway.
- `npm run test:backend` runs the backend unit and local-worker integration tests.
- `npm run test:gateway` runs the game gateway unit tests.
- `npm run dev:editor` starts the editor development server.

Use `--cache /tmp/blitz-npm-cache` and `--ignore-scripts` on every npm install.

## Deploying

The backend and game gateway deploy from their default `wrangler.jsonc` files to workers.dev. Do not use either worker's `wrangler.prod.jsonc`, which configures routes for `blitz.dev` and `*.app.blitz.dev`, until those domains are detached from teenybase.

## Upstream sync

The vendored packages keep their upstream history, so a pull merges cleanly into the prefix.

Apple Git has no `git subtree`. Use the subtree merge strategy, which works with any git:

```
git pull -s subtree -Xsubtree=packages/threepipe threepipe master
git pull -s subtree -Xsubtree=packages/uiconfig-blueprint uiconfig-blueprint dev
```

If a git with `git subtree` is installed (for example Homebrew git), these are equivalent:

```
git subtree pull --prefix=packages/threepipe threepipe master
git subtree pull --prefix=packages/uiconfig-blueprint uiconfig-blueprint dev
```

## Dependency notes

`three` and `@types/three` are pinned in the root `overrides` to repalash's patched release tarballs on GitHub. threepipe needs that patched build, and the old `pkg.threepipe.org` registry is gone. If those release URLs disappear, the install breaks. A mirror under the blitzdotdev org is the fix.
