---
name: publish
description: Publish a saved Kite3D project to blitz.dev by assembling and uploading a release with the backend API.
---

# Publish a Kite3D game

Publishing is the agent's job. Do not use a CLI release implementation. Follow this procedure from the project root.

## 1. Understand the release

A release is a manifest of content-addressed files. Publishing a release replaces the active release. Git is the record of the working tree.

Ship normal project files, installed Kite3D plugin files, a generated `index.html`, and the installed runtime at `_blitz/runtime.js`.

Skip hidden files and directories. Skip `.kite3d`, `.git`, `node_modules`, and `dist`. Skip `package-lock.json`, `.env`, `.env.*`, `*.log`, `.eslintrc*`, `AGENTS.md`, `samples/**`, `tools/**`, and root Markdown files other than `README.md`. Also apply string globs from `package.json` at `kite3d.publish.exclude`.

Copy each installed package named by `kite3d.plugins`, except its nested `node_modules`, under `_blitz/plugins/<package-name>/`. In the released `package.json`, remove `devDependencies`. Remove every `file:` entry from `dependencies`, `peerDependencies`, and `optionalDependencies`. Add each shipped plugin and its installed exact version to `dependencies`.

Read the runtime version from the exact `devDependencies.kite3d` value. For a range, tag, URL, `file:`, `link:`, or `workspace:` value, read the exact installed version from `node_modules/@kite3d/engine/package.json`. Make `kite3d.version` match it. Read the runtime bytes from `node_modules/@kite3d/engine/dist/runtime.js`.

Generate `index.html` with the project display name, a full-page black canvas named `kite3d-canvas`, and an import map. Map the engine and project dependencies exactly as the installed engine's `dependencyImportMap` does. Map the engine runtime to `./_blitz/runtime.js` and plugin packages to `./_blitz/plugins/`. Import `createGame` from `./_blitz/runtime.js` and call it with `base: new URL('./', location.href).href` and the canvas. Add `<meta name="kite3d-runtime" content="<version> <runtime-sha256>">`.

## 2. Check prerequisites

Read `package.json`, `assets.json`, and the file named by `mainScene`. Validate them with the installed Kite3D engine. The scene must be saved. Stop Play before reading the release files. The development server may keep running because publishing uses the backend directly. Confirm `node_modules/@kite3d/engine/dist/runtime.js` and every configured plugin entry exist. Confirm the Git working tree represents the version the owner wants to publish.

Use `https://blitz.dev` unless the owner explicitly supplies `BLITZ_BACKEND_URL`. Normalize the base URL without a trailing slash. Choose a slug from the requested slug, an existing deploy key, or the package name converted to lowercase URL-safe words.

## 3. Protect deploy credentials

Credentials live only in `.kite3d/deploys.json`. Set its permissions to owner read and write. Never print, log, paste, summarize, or commit a deploy token or claim secret. Keep response files private and delete them when the operation is complete.

The file shape is exactly:

```json
{"games":{"<slug>":{"game_id":"<game-id>","deploy_token":"<private>","claim_secret":"<private>","claim_url":"<claim-url>","preview_url":"<preview-url>","expires_at":"<timestamp>","last_release_hash":"<release-sha256>"}}}
```

## 4. Create a game when needed

If the slug has no deploy record, send `POST /api/v1/new-game/<encoded-slug>?name=<encoded-name>`. Send no body, content type, or authorization header. The response contains `game_id`, `deploy_token`, `claim_secret`, optional `claim_url`, `preview_url`, `expires_at`, and optional canonical `name`. Write the deploy fields to the private deploy file immediately. If `claim_url` is absent, form it as described in step 10 and store it. If an unclaimed record is expired, remove it and create a new one.

```sh
curl --fail --silent --show-error --request POST --output <private-response-file> "<backend>/api/v1/new-game/<encoded-slug>?name=<encoded-name>"
```

## 5. Read the existing game name when needed

If the deploy record has `last_release_hash` and the owner did not provide a new name, send `GET /api/v1/games/<encoded-game-id>` with the deploy bearer token. Use `game.name` from the response when present.

```sh
curl --fail --silent --show-error --header "Authorization: Bearer <deploy-token>" --output <private-response-file> "<backend>/api/v1/games/<encoded-game-id>"
```

## 6. Check runtime registration

Compute lowercase SHA-256 for the installed runtime. Send `GET /api/v1/runtimes/<encoded-version>` without authorization. Compare the installed hash with every returned runtime hash, or the top-level `sha256` for an older response. Continue with the installed runtime if the record is absent or different. A strict backend can reject an unregistered runtime later.

```sh
curl --fail --silent --show-error --output <response-file> "<backend>/api/v1/runtimes/<encoded-version>"
```

## 7. Build the manifest and find missing blobs

For every final release path, compute SHA-256 over its exact bytes and its byte size. Add `mime` for HTML, JavaScript, JSON, glTF, and GLB files. Sort paths. The body is `{"hashes":["<unique-sha256>"]}`. Send `POST /api/v1/games/<encoded-game-id>/blobs/missing` with bearer authorization and JSON content type. The response is `{"missing":["<sha256>"]}`. Upload only those hashes. If two paths have identical bytes, upload the hash once.

```sh
curl --fail --silent --show-error --request POST --header "Authorization: Bearer <deploy-token>" --header "Content-Type: application/json" --data-binary @<private-missing-request-file> --output <private-response-file> "<backend>/api/v1/games/<encoded-game-id>/blobs/missing"
```

## 8. Upload missing blobs

For each missing hash, send `PUT /api/v1/games/<encoded-game-id>/blobs/<encoded-sha256>`. Use bearer authorization, `Content-Type: application/octet-stream`, the exact `Content-Length`, and raw bytes. Run at most four uploads concurrently. A new upload returns `201` with its hash and size. Existing identical content returns `200` with `uploaded: false`. Treat `422 hash_mismatch` as a local hashing or byte-selection error.

```sh
curl --fail --silent --show-error --request PUT --header "Authorization: Bearer <deploy-token>" --header "Content-Type: application/octet-stream" --header "Content-Length: <byte-size>" --data-binary @<blob-file> --output <private-response-file> "<backend>/api/v1/games/<encoded-game-id>/blobs/<encoded-sha256>"
```

## 9. Create and activate the release

Send `PUT /api/v1/games/<encoded-game-id>/releases` with bearer authorization and JSON content type. The body is `{"files":{"<path>":{"sha256":"<sha256>","size":<bytes>,"mime":"<optional-mime>"}},"message":"<message>","base_release":"<previous-release-sha256>","metadata":{"description":"<package-description>"}}`. Omit `base_release` for the first release. Omit `metadata` unless the package description is a string. Default the message to `initial` for the first release and `update` later.

This request creates and activates the release atomically. A new release returns `201`. An identical manifest returns `200`. The response contains `release_hash`, `preview_url`, and `files`. A `409 release_moved` means another release became active. Stop and reconcile with the owner and Git before replacing it. Write the returned release hash and preview URL into the deploy record.

```sh
curl --fail --silent --show-error --request PUT --header "Authorization: Bearer <deploy-token>" --header "Content-Type: application/json" --data-binary @<private-release-request-file> --output <private-response-file> "<backend>/api/v1/games/<encoded-game-id>/releases"
```

## 10. Form the claim URL

Keep the `claim_url` returned when the game was created. If it was absent, form `<backend>/claim/<encoded-slug>?secret=<encoded-claim-secret>`. Never print the URL because it contains the claim secret. Tell the owner only that a private claim URL is available in `.kite3d/deploys.json`.

No backend request is needed for this step.

## 11. Verify the live game

For every manifest path, request `<preview-url>/<each-path-segment-encoded>?_blitz_verify=<timestamp>-<attempt>` without authorization. Compute SHA-256 over the response bytes and compare it with the manifest. Try each path up to five times. Wait 100, 200, 400, then 800 milliseconds between attempts. Fail publishing if any final hash differs or cannot be fetched. This verifies the generated page, runtime, plugins, source, and assets, not only the root page.

```sh
curl --fail --silent --show-error --output <verification-file> "<preview-url>/<encoded-path>?_blitz_verify=<timestamp>-<attempt>"
```

## 12. Choose a rollback release

The API supports rollback while the earlier release is retained. List `GET /api/v1/games/<encoded-game-id>/releases` with bearer authorization. The response has a `releases` array with each `release_hash`, creation time, message, file count, and `active` flag. Choose the intended inactive hash with the owner.

```sh
curl --fail --silent --show-error --header "Authorization: Bearer <deploy-token>" --output <private-response-file> "<backend>/api/v1/games/<encoded-game-id>/releases"
```

## 13. Activate the rollback release

Send `POST /api/v1/games/<encoded-game-id>/releases/<encoded-release-sha256>/activate` with the bearer token and no body. It returns the activated `release_hash`, `preview_url`, and file count. Update `last_release_hash`, verify every file from that release, and keep the Git working tree unchanged unless the owner separately asks to restore source.

```sh
curl --fail --silent --show-error --request POST --header "Authorization: Bearer <deploy-token>" --output <private-response-file> "<backend>/api/v1/games/<encoded-game-id>/releases/<encoded-release-sha256>/activate"
```
