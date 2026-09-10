# Releasing Blitz

The four public packages (`@blitzdev/engine`, `@blitzdev/template`, `@blitzdev/editor`, and `@blitzdev/blitz`) always share one version. Every dependency between them is an exact pin to that version. A `@blitzdev/blitz` version therefore identifies exactly one engine, editor, and template version. The vendored `threepipe` and `uiconfig-blueprint` workspaces are not published.

## Commands

Set the next lockstep version, review the manifest and lockfile changes, and commit them:

```sh
npm run version:set -- patch # or minor, major, or an explicit x.y.z
git add package.json package-lock.json packages/*/package.json
git commit -m "chore: release vX.Y.Z"
```

Run the complete release locally without publishing, registering a runtime, or creating a tag:

```sh
npm run release:dry
```

After the version commit is clean and checked out on `main` or a release branch, publish, register the engine runtime, and create the local tag:

```sh
npm run release
```

The `release:patch`, `release:minor`, and `release:major` aliases perform the version rewrite before invoking the release command. Because releases require a clean tree, use the explicit version/commit/release sequence above for production releases.

## Required secrets

GitHub Actions and laptop releases use `NPM_TOKEN`, `RUNTIME_UPLOAD_TOKEN`, and `BLITZ_BACKEND_URL`. A laptop release may place the two runtime values in the ignored root `.env.local`; `NPM_TOKEN` remains an environment variable. The release tooling puts npm authentication in a temporary user config and removes it afterward.

## Laptop fallback

From a clean `main` or release branch, install with Node 22, run `npm run release:dry`, export `NPM_TOKEN`, and make sure `.env.local` contains `RUNTIME_UPLOAD_TOKEN` and `BLITZ_BACKEND_URL`. Then run `npm run release`. The command publishes engine, template, editor, and CLI in dependency order, registers `packages/engine/dist/runtime.js`, creates `vX.Y.Z`, and prints—but never runs—the `git push` command.
