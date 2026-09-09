# Blitz

This repository is an npm workspace for the Blitz editor and its supporting packages.

## Layout

- `apps/editor/` is the Blitz browser editor.
- `packages/threepipe/` is the vendored `repalash/threepipe` `master` branch with full history.
- `packages/uiconfig-blueprint/` is the vendored `repalash/uiconfig-blueprint` `dev` branch with full history.
- `services/asset-library-proxy/` is the editor asset-library proxy.
- `backend/` is not yet moved into `services/` and is temporarily ignored while another agent writes it.
- `game-gateway/` is not yet moved into `services/` and is temporarily ignored while another agent writes it.
- `docs/` is temporarily ignored while another agent writes it.

## Commands

Install with `npm install --ignore-scripts --cache /tmp/blitz-npm-cache`.

- `npm run build:threepipe` builds `packages/threepipe/lib/`.
- `npm run build:ui` builds `packages/uiconfig-blueprint/dist/` and `packages/uiconfig-blueprint/lib/esm/`.
- `npm run build:editor` builds `apps/editor/dist/`.
- `npm run build` runs all three builds in dependency order.
- `npm run typecheck` type-checks the editor.
- `npm run dev:editor` starts the editor development server.

Use `--cache /tmp/blitz-npm-cache` on every npm command. Keep `--ignore-scripts` on installs.

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
