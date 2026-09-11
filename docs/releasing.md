# Releasing Kite3D

The three public packages (`@blitzdev/engine`, `@blitzdev/editor`, and `kite3d`) always share one version. Every dependency between them is an exact pin to that version. A `kite3d` version therefore identifies exactly one engine and editor version, plus the starter template bundled in that CLI. The vendored `threepipe` workspace is not published, and the editor-only `uiconfig-blueprint` source is excluded from the editor tarball.

## Commands

Set the next lockstep version, review the manifest and lockfile changes, and commit them:

```sh
npm run version:set -- patch # or minor, major, or an explicit x.y.z
git add package.json package-lock.json packages/*/package.json
git commit -m "chore: release vX.Y.Z"
```

Run the complete release locally without publishing, registering a runtime, uploading the agents guide, or creating a tag:

```sh
npm run release:dry
```

After the version commit is clean and checked out on `main` or a release branch, publish, register the engine runtime, upload `docs/agents.md`, and create the local tag:

```sh
npm run release
```

After `npm publish` returns, the public registry can serve 404 for the new version for a minute or two while its read replicas catch up. A retry then fails with "cannot publish over the previously published versions", which confirms the publish landed. Wait, then verify with `npm view`.

The `release:patch`, `release:minor`, and `release:major` aliases perform the version rewrite before invoking the release command. Because releases require a clean tree, use the explicit version/commit/release sequence above for production releases.

## Required secrets

GitHub Actions and laptop releases use `NPM_TOKEN`, `RUNTIME_UPLOAD_TOKEN`, and `BLITZ_BACKEND_URL`. Set `BLITZ_BACKEND_URL` to `https://blitz.dev`; GitHub Actions reads it from the repository secret of the same name. A laptop release may place the two backend values in the ignored root `.env.local`; `NPM_TOKEN` remains an environment variable. The runtime registration and agents guide upload share these backend settings. The release tooling puts npm authentication in a temporary user config and removes it afterward.

## Laptop fallback

From a clean `main` or release branch, install with Node 22, run `npm run release:dry`, export `NPM_TOKEN`, and make sure `.env.local` contains `RUNTIME_UPLOAD_TOKEN` and `BLITZ_BACKEND_URL=https://blitz.dev`. Then run `npm run release`. The command publishes engine, editor, and CLI in dependency order, registers `packages/engine/dist/runtime.js`, copies `packages/kite3d/template/AGENTS.md` to `docs/agents.md`, uploads that guide, creates `vX.Y.Z`, and prints the `git push` command without running it. The upload verifies both the API response hash and the public `/agents.md` ETag.
