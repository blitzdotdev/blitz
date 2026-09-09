# Publish

Use the API directly. Keep every token private. Do not print raw create responses.

## Set the targets

Use these deployed origins. Do not add a trailing slash.

```sh
BACKEND_URL='https://blitz-backend.blitzapp.workers.dev'
EDITOR_URL='https://blitz-editor.blitzapp.workers.dev'
RUNTIME_VERSION='0.12.0'
SLUG='your-game-slug'
```

Slugs have 3 to 49 lowercase letters, digits, or hyphens. They cannot start or end with a hyphen. They cannot contain `--`.

## Create or reuse a game

Reuse `.blitz/deploys.json` when it has the slug. Read the token into a shell variable.

For a new game, create it once.

```sh
CREATE_FILE=$(mktemp)
curl -fsS -X POST "$BACKEND_URL/api/v1/new-game/$SLUG?name=My%20Game" -o "$CREATE_FILE"
GAME_ID=$(jq -r .game_id "$CREATE_FILE")
DEPLOY_TOKEN=$(jq -r .deploy_token "$CREATE_FILE")
CLAIM_SECRET=$(jq -r .claim_secret "$CREATE_FILE")
PREVIEW_URL=$(jq -r .preview_url "$CREATE_FILE")
EXPIRES_AT=$(jq -r .expires_at "$CREATE_FILE")
mkdir -p .blitz
jq -n --arg slug "$SLUG" --arg id "$GAME_ID" --arg token "$DEPLOY_TOKEN" \
  --arg secret "$CLAIM_SECRET" --arg preview "$PREVIEW_URL" --arg expires "$EXPIRES_AT" \
  '{games:{($slug):{game_id:$id,deploy_token:$token,claim_secret:$secret,preview_url:$preview,expires_at:$expires}}}' \
  > .blitz/deploys.json
rm -f "$CREATE_FILE"
```

The file shape is:

```json
{
  "games": {
    "<slug>": {
      "game_id": "...",
      "deploy_token": "tp_...",
      "claim_secret": "...",
      "preview_url": "https://blitz-game-gateway.blitzapp.workers.dev/<slug>/",
      "expires_at": "YYYY-MM-DD HH:MM:SS",
      "last_release_hash": "..."
    }
  }
}
```

Add `.blitz/deploys.json` to `.gitignore`.

## Pull before publish

Always compare your saved release with the active release. Pull first when they differ.

```sh
GAME_ID=$(jq -r --arg slug "$SLUG" '.games[$slug].game_id' .blitz/deploys.json)
DEPLOY_TOKEN=$(jq -r --arg slug "$SLUG" '.games[$slug].deploy_token' .blitz/deploys.json)
BASE_RELEASE=$(jq -r --arg slug "$SLUG" '.games[$slug].last_release_hash // empty' .blitz/deploys.json)
GAME_FILE=$(mktemp)
curl -fsS "$BACKEND_URL/api/v1/games/$SLUG" \
  -H "Authorization: Bearer $DEPLOY_TOKEN" -o "$GAME_FILE"
ACTIVE_RELEASE=$(jq -r '.game.active_release // empty' "$GAME_FILE")
rm -f "$GAME_FILE"
```

If `BASE_RELEASE` and `ACTIVE_RELEASE` differ, fetch the manifest.

```sh
RELEASE_FILE=$(mktemp)
curl -fsS "$BACKEND_URL/api/v1/games/$GAME_ID/releases/$ACTIVE_RELEASE" \
  -H "Authorization: Bearer $DEPLOY_TOKEN" -o "$RELEASE_FILE"
jq -r '.files | to_entries[] | @base64' "$RELEASE_FILE" | while read -r ROW; do
  ITEM=$(printf '%s' "$ROW" | base64 -D)
  PATH_NAME=$(printf '%s' "$ITEM" | jq -r .key)
  HASH=$(printf '%s' "$ITEM" | jq -r .value.sha256)
  case "$PATH_NAME" in index.html|_blitz/*) continue ;; esac
  LOCAL_HASH=''
  if [ -f "$PATH_NAME" ]; then LOCAL_HASH=$(shasum -a 256 "$PATH_NAME" | awk '{print $1}'); fi
  if [ "$LOCAL_HASH" != "$HASH" ]; then
    mkdir -p "$(dirname "$PATH_NAME")"
    TEMP_BLOB=$(mktemp)
    curl -fsS "$BACKEND_URL/api/v1/games/$GAME_ID/blobs/$HASH" \
      -H "Authorization: Bearer $DEPLOY_TOKEN" -o "$TEMP_BLOB"
    test "$(shasum -a 256 "$TEMP_BLOB" | awk '{print $1}')" = "$HASH"
    mv "$TEMP_BLOB" "$PATH_NAME"
  fi
done
BASE_RELEASE="$ACTIVE_RELEASE"
DEPLOYS_TEMP=$(mktemp)
jq --arg slug "$SLUG" --arg release "$BASE_RELEASE" \
  '.games[$slug].last_release_hash=$release' .blitz/deploys.json > "$DEPLOYS_TEMP"
mv "$DEPLOYS_TEMP" .blitz/deploys.json
rm -f "$RELEASE_FILE"
```

Skip the pull block when both hashes are empty. The server rejects a stale `base_release` with `409 release_moved`. Its error contains the new `active_release`.

## Prepare the release

The project needs `package.json`, `assets.json`, `main.js`, and its main scene. Add `blitz.version` when it is missing.

```sh
PACKAGE_TEMP=$(mktemp)
jq --arg version "$RUNTIME_VERSION" '.blitz = (.blitz // {}) | .blitz.version //= $version' \
  package.json > "$PACKAGE_TEMP"
mv "$PACKAGE_TEMP" package.json
```

Look up the registered runtime. Do not upload it.

```sh
RUNTIME_FILE=$(mktemp)
curl -fsS "$BACKEND_URL/api/v1/runtimes/$RUNTIME_VERSION" -o "$RUNTIME_FILE"
RUNTIME_HASH=$(jq -r .sha256 "$RUNTIME_FILE")
RUNTIME_SIZE=$(jq -r .size "$RUNTIME_FILE")
rm -f "$RUNTIME_FILE"
```

Generate `index.html`. Runtime paths must stay relative.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>My Game</title>
<script type="importmap">{"imports":{"threepipe":"./_blitz/runtime.js","three":"./_blitz/runtime.js","uiconfig.js":"./_blitz/runtime.js","ts-browser-helpers":"./_blitz/runtime.js"}}</script>
<style>html,body,canvas{margin:0;width:100%;height:100%;overflow:hidden;background:#000}</style>
</head>
<body>
<canvas id="blitz-canvas"></canvas>
<script type="module">
import {createGame} from './_blitz/runtime.js'
createGame({base:new URL('./',location.href).href,canvas:document.getElementById('blitz-canvas')})
  .catch(error=>{document.body.textContent='Failed to start: '+error.message})
</script>
</body>
</html>
```

Add only project-declared extra dependencies to the import map. Map each one to `https://esm.sh/<key>@<version>?external=<all mapped keys>`. The runtime already contains the Blitz plugin set.

Exclude `.blitz/`, `.git/`, `node_modules/`, `dist/`, and every dotfile. These are fixed exclusions. Do not interpret `.gitignore`.

Hash every included file. Build `FILES_JSON`. Set MIME for HTML, JS, MJS, JSON, glTF, and GLB.

```sh
FILES_JSON='{}'
while IFS= read -r -d '' FILE_PATH; do
  REL=${FILE_PATH#./}
  case "/$REL/" in */.blitz/*|*/.git/*|*/node_modules/*|*/dist/*|*/.*/*) continue ;; esac
  HASH=$(shasum -a 256 "$FILE_PATH" | awk '{print $1}')
  SIZE=$(wc -c < "$FILE_PATH" | tr -d ' ')
  MIME=''
  case "$REL" in
    *.html) MIME='text/html; charset=utf-8' ;;
    *.js|*.mjs) MIME='text/javascript; charset=utf-8' ;;
    *.json) MIME='application/json; charset=utf-8' ;;
    *.gltf) MIME='model/gltf+json' ;;
    *.glb) MIME='model/gltf-binary' ;;
  esac
  FILES_JSON=$(printf '%s' "$FILES_JSON" | jq --arg path "$REL" --arg hash "$HASH" \
    --argjson size "$SIZE" --arg mime "$MIME" \
    '. + {($path):({sha256:$hash,size:$size} + if $mime=="" then {} else {mime:$mime} end)}')
done < <(find . -type f -print0)
FILES_JSON=$(printf '%s' "$FILES_JSON" | jq --arg hash "$RUNTIME_HASH" --argjson size "$RUNTIME_SIZE" \
  '. + {"_blitz/runtime.js":{sha256:$hash,size:$size,mime:"text/javascript; charset=utf-8"}}')
```

Ask which blobs are missing.

```sh
HASHES=$(printf '%s' "$FILES_JSON" | jq '[.[].sha256] | unique')
MISSING_FILE=$(mktemp)
curl -fsS -X POST "$BACKEND_URL/api/v1/games/$GAME_ID/blobs/missing" \
  -H "Authorization: Bearer $DEPLOY_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "$(jq -n --argjson hashes "$HASHES" '{hashes:$hashes}')" -o "$MISSING_FILE"
```

Upload each missing project blob. The registered runtime should not be missing.

```sh
jq -r '.missing[]' "$MISSING_FILE" | while read -r HASH; do
  PATH_NAME=$(printf '%s' "$FILES_JSON" | jq -r --arg hash "$HASH" \
    'to_entries[] | select(.value.sha256==$hash and .key!="_blitz/runtime.js") | .key' | head -n 1)
  test -n "$PATH_NAME"
  curl -fsS -X PUT "$BACKEND_URL/api/v1/games/$GAME_ID/blobs/$HASH" \
    -H "Authorization: Bearer $DEPLOY_TOKEN" \
    -H 'Content-Type: application/octet-stream' \
    --data-binary "@$PATH_NAME" >/dev/null
done
rm -f "$MISSING_FILE"
```

Publish and activate. Include `base_release` after the first pull or publish.

```sh
RELEASE_BODY=$(jq -n --argjson files "$FILES_JSON" --arg message 'agent publish' \
  --arg base "$BASE_RELEASE" \
  '{files:$files,message:$message} + if $base=="" then {} else {base_release:$base} end')
RELEASE_FILE=$(mktemp)
curl -fsS -X PUT "$BACKEND_URL/api/v1/games/$GAME_ID/releases" \
  -H "Authorization: Bearer $DEPLOY_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "$RELEASE_BODY" -o "$RELEASE_FILE"
RELEASE_HASH=$(jq -r .release_hash "$RELEASE_FILE")
PREVIEW_URL=$(jq -r .preview_url "$RELEASE_FILE")
DEPLOYS_TEMP=$(mktemp)
jq --arg slug "$SLUG" --arg release "$RELEASE_HASH" \
  '.games[$slug].last_release_hash=$release' .blitz/deploys.json > "$DEPLOYS_TEMP"
mv "$DEPLOYS_TEMP" .blitz/deploys.json
rm -f "$RELEASE_FILE"
printf '%s\n' "$PREVIEW_URL"
```

# Show the game in the editor

For follow mode, print this private link for the user:

```text
https://blitz-editor.blitzapp.workers.dev/?game=<slug>#token=<deploy_token>
```

The fragment keeps the token out of HTTP requests. Do not post the link publicly.

For folder mode, ask the user to open the project folder in the editor. The editor reads and writes the local files.

# Limits

- Anonymous games expire after 12 hours unless claimed.
- One blob can be at most 100 MiB.
- One active manifest can total at most 500 MiB.
- One release can contain at most 2,000 files.
- A manifest path can contain at most 512 characters.
- A release message can contain at most 500 characters.
- Upload at most four blobs at once.
- Keep the last 10 releases for rollback.
