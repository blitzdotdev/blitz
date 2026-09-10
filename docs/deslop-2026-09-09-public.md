# Public Blitz deslop pass - 2026-09-09

## Outcome

All 31 findings were reviewed in report order. Thirty were applied. The one rejection is the owner-directed `ProjectSource` decision: the planned cloud source for follow mode is a concrete second implementation.

The removed-line counts below are raw deleted lines from `main..HEAD`, including tests rewritten away from deleted seams and dependency-lock churn. Shared hunks are apportioned to their triggering finding; the rows total the diff's 863 deletions. Moved or replacement code appears separately in the diff's 459 insertions.

| ID/tag | File | Decision | Note | Lines removed |
|---|---|---|---|---:|
| 1 / S1 | `packages/engine/test/unit/generator.test.ts` | APPLIED | Deleted the `FakeObject` implementation; the test now uses ThreePipe `Group` instances and a real temporary `.mjs` module URL. | 38 |
| 2 / S5 | `packages/editor/src/App.tsx` | APPLIED | Moved generator bake mechanics into `GeneratorComponent.bake()`; the UI invokes it and saves. | 18 |
| 3 / S4 | `packages/blitz/src/publish.ts` | APPLIED | Deleted the second upload pool and routed uploads through `BlitzApi.uploadBlobs`. | 26 |
| 4 / S1 | `packages/editor/src/DevServerSource.ts` | APPLIED | Replaced the hand-written SSE reader/parser with browser `EventSource`; the server reads the client id from the query string. | 31 |
| 5 / S5 | `packages/editor/src/App.tsx` | APPLIED | Moved generator-state parsing/updating into the engine project-format layer and reloads live state from its result. | 61 |
| 6 / S9 | `packages/blitz/src/publish.ts` | APPLIED | Deleted `PublishApi` and structural fakes; publish accepts `BlitzApi`, and tests exercise the real client through the mock HTTP backend. | 219 |
| 7 / S6 | `packages/editor/src/publishing.ts` | APPLIED | Deleted the local reserved-slug list and regex validation; the availability endpoint is authoritative. | 18 |
| 8 / S1 | `packages/editor/src/ProjectSource.ts` | REJECTED | A cloud source for follow mode is the planned second implementation, so the interface remains. | 0 |
| 9 / S7 | `packages/blitz/src/server.ts` | APPLIED | Deleted the unused asset-library proxy option, environment/default, state field, editor type, and DOM attribute. | 10 |
| 10 / S7 | `packages/blitz/src/publish.ts` | APPLIED | Reduced publish targeting to the only produced form, a required slug, and derives the stored deploy entry. | 39 |
| 11 / S8 | `packages/editor/src/App.tsx` | APPLIED | Deleted the save timer and explicit Save button; blur calls save directly. | 13 |
| 12 / S6 | `packages/editor/src/App.tsx` | APPLIED | Deleted the mirrored scene ref; React state is authoritative and next text is passed explicitly to saves. | 12 |
| 13 / S3 | `packages/engine/src/sceneSerialization.ts` | APPLIED | Deleted the Buffer and missing-decoder branches; supported targets use `atob` directly. | 9 |
| 14 / S4 | `.github/workflows/ci.yml` | APPLIED | Removed duplicate focused publish and release validation runs; the full Blitz suite and `release.mjs` remain the owners. | 7 |
| 15 / S9 | `packages/blitz/src/commands.ts` | APPLIED | Deleted command/install/runtime injection options; extracted pure migration selection and retained a real upgrade fixture path. | 51 |
| 16 / S10 | `packages/engine/src/runtime/projectFormat.ts` | APPLIED | Requires an explicit text `.gltf` `mainScene` at the package boundary and deletes binary-default/pass-through branches. | 12 |
| 17 / S9 | `packages/engine/src/plugins/GeneratorComponent.ts` | APPLIED | Deleted engine/module-loader injection; production imports are fixed and tests load a real module URL. | 22 |
| 18 / S7 | `packages/engine/src/runtime/migrations.ts` | APPLIED | Deleted the unused no-op migration example. | 7 |
| 19 / S2 | `packages/engine/src/plugins/GeneratorComponent.ts` | APPLIED | Generator runs now reject; only detached lifecycle invocations attach error reporting. | 6 |
| 20 / S2 | `packages/engine/src/runtime/createGame.ts` | APPLIED | Deleted the reporter's catch-and-log wrapper and invokes `onError` directly. | 5 |
| 21 / S1 | `packages/template/template/package.json` | APPLIED | Removed empty plugin, script, and viewer settings; the template emits only `blitz.version`. | 4 |
| 22 / S7 | `packages/template/template/main.js` | APPLIED | Deleted the unused template `onError` export. | 4 |
| 23 / S7 | `packages/engine/src/sceneSerialization.ts` | APPLIED | Deleted unvaried viewer/texture options and fixed the current `true`/`16` serialization contract. | 4 |
| 24 / S9 | `packages/blitz/src/server.ts` | APPLIED | Deleted test-only token/editor-directory options; tests use the returned token and built editor. | 21 |
| 25 / S6 | `scripts/register-runtime.mjs` | APPLIED | Deleted the redundant runtime `stat`; `Content-Length` comes from the read Buffer. | 3 |
| 26 / S9 | `scripts/set-version.mjs` | APPLIED | Deleted `runCommand` injection; tests cover the pure rewrite helper. | 39 |
| 27 / S7 | `packages/blitz/src/commands.ts` | APPLIED | Deleted the legacy string form of `publishFromDisk`; callers pass `PublishFromDiskOptions`. | 8 |
| 28 / S7 | `scripts/register-runtime.mjs` | APPLIED | Deleted root-directory/fetch injection and the redundant release argument. | 5 |
| 29 / S10 / INHERITED | `packages/editor/package.json` | APPLIED | Deleted legacy R2 deploy commands, `.rclone.conf`, uploader/utils, and `rclone.js`; refreshed the lockfile. | 129 |
| 30 / S4 / INHERITED | `packages/editor/scripts/register-runtime.mjs` | APPLIED | Deleted the editor-local registrar; editor deploy is Wrangler-only and root `deploy:editor` calls the root registrar. | 35 |
| 31 / S7 / INHERITED | `packages/editor/src/vite-env.d.ts` | APPLIED | Deleted the unused `virtual:importmap` declaration. | 7 |

## Validation

Initial required setup:

| Command | Result | Duration |
|---|---:|---:|
| `npm install --ignore-scripts --cache /tmp/blitz-npm-cache` | PASS | 19 s |
| `npm run build` | PASS | un-timed baseline |

Final required validation used `/usr/bin/time -p`; durations are its `real` values.

| Command | Result | Duration |
|---|---:|---:|
| `npm run typecheck` | PASS | 5.52 s |
| `npm run build` | PASS | 32.72 s |
| `npm run test:runtime` | PASS - 6 Vitest tests and 1 Playwright test | 8.78 s |
| `npm test -w packages/blitz` | PASS - 53 tests | 4.66 s |
| `npm test -w packages/engine` | NOT PRESENT - package has `test:runtime`, covered above | N/A |
| `npm run test:editor` | PASS - 4 Playwright tests using the configured SwiftShader flags | 11.26 s |
| `npx eslint packages/blitz/src/commands.ts packages/blitz/src/index.ts packages/blitz/src/publish.ts packages/blitz/src/server.ts packages/blitz/test/mockBackend.ts packages/blitz/test/publish.test.ts packages/blitz/test/server.test.ts packages/blitz/test/upgrade.test.ts packages/editor/src/App.tsx packages/editor/src/DevServerSource.ts packages/editor/src/PublishDialog.tsx packages/editor/src/publishing.ts packages/editor/src/vite-env.d.ts packages/editor/test/editor/dev-server.spec.ts packages/engine/src/plugins/GeneratorComponent.ts packages/engine/src/runtime/createGame.ts packages/engine/src/runtime/migrations.ts packages/engine/src/runtime/projectFormat.ts packages/engine/src/sceneSerialization.ts packages/engine/test/unit/generator.test.ts` | PASS - 0 errors | 1.63 s |
| `npx eslint --config packages/template/.eslintrc.cjs packages/template/template/main.js` | PASS - 0 errors | 0.43 s |
| `npx eslint --no-eslintrc --env es2022,node --parser-options '{"sourceType":"module","ecmaVersion":"latest"}' scripts/register-runtime.mjs scripts/release.mjs scripts/set-version.mjs scripts/set-version.test.mjs` | PASS - 0 errors | 0.67 s |

The final build exited 0 with the known pre-existing ThreePipe declaration diagnostics. Deleted files are not lint targets; manifests, lockfiles, and workflow YAML have no applicable repository ESLint parser.

Deployment-path verification (run from `packages/editor`):

| Command | Result | Duration |
|---|---:|---:|
| `npx wrangler deploy --dry-run` | PASS - Wrangler 4.130.0 read 27 built assets and exited without deploying | 1.34 s |

The resulting scripts are:

```text
root deploy:editor  = npm run build && npm run deploy -w packages/editor && npm run release:register
editor deploy       = wrangler deploy
root release:register = node scripts/register-runtime.mjs
```

## `git diff --stat main..HEAD`

```text
 .github/workflows/ci.yml                          |   1 -
 .github/workflows/release.yml                     |   5 -
 package-lock.json                                 |  56 ----
 package.json                                      |   2 +-
 packages/blitz/src/commands.ts                    |  37 ++-
 packages/blitz/src/index.ts                       |   7 +-
 packages/blitz/src/publish.ts                     |  75 +-----
 packages/blitz/src/server.ts                      |  22 +-
 packages/blitz/test/mockBackend.ts                |  61 ++++-
 packages/blitz/test/publish.test.ts               | 307 +++++++---------------
 packages/blitz/test/server.test.ts                |  18 +-
 packages/blitz/test/upgrade.test.ts               | 111 +++++---
 packages/editor/.rclone.conf                      |   7 -
 packages/editor/package.json                      |   6 +-
 packages/editor/scripts/register-runtime.mjs      |  33 ---
 packages/editor/scripts/upload-r2.mjs             |  39 ---
 packages/editor/scripts/utils.mjs                 |  23 --
 packages/editor/src/App.tsx                       | 137 ++--------
 packages/editor/src/DevServerSource.ts            |  39 +--
 packages/editor/src/PublishDialog.tsx             |   7 +-
 packages/editor/src/publishing.ts                 |  12 -
 packages/editor/src/vite-env.d.ts                 |   7 -
 packages/editor/test/editor/dev-server.spec.ts    |   5 +-
 packages/engine/src/plugins/GeneratorComponent.ts |  62 +++--
 packages/engine/src/runtime/createGame.ts         |   9 +-
 packages/engine/src/runtime/migrations.ts         |   7 -
 packages/engine/src/runtime/projectFormat.ts      |  60 ++++-
 packages/engine/src/sceneSerialization.ts         |  17 +-
 packages/engine/test/unit/generator.test.ts       |  80 +++---
 packages/template/template/main.js                |   4 -
 packages/template/template/package.json           |   5 +-
 scripts/register-runtime.mjs                      |  13 +-
 scripts/release.mjs                               |   3 +-
 scripts/set-version.mjs                           |   5 +-
 scripts/set-version.test.mjs                      |  40 +--
 35 files changed, 459 insertions(+), 863 deletions(-)
```

## `git log --oneline main..HEAD`

```text
741b0fd deslop(release): remove legacy deployment paths
db9464d deslop(blitz): remove duplicate publish and server seams
8713959 deslop(engine): simplify generator and scene paths
```

`main` advanced by three documentation-only commits during the pass; the deslop commits were rebased onto it before capturing this diff and log.
