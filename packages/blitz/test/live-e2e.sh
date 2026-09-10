#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
FIXTURE="$REPO_ROOT/packages/editor/test/fixtures/sample-project"
WORK_DIR=$(mktemp -d)
TRANSCRIPT=${TRANSCRIPT:-/tmp/blitz-phase-b-e2e-transcript.txt}
BACKEND_URL='https://blitz-backend.blitzapp.workers.dev'
RUNTIME_VERSION=$(node -p "require('$REPO_ROOT/packages/engine/package.json').version")
SLUG="phase-b-smoke-$(date +%s)"
GAME_ID=''
DEPLOY_TOKEN=''
DELETED=0

log() {
  printf '%s\n' "$1" | tee -a "$TRANSCRIPT"
}

cleanup() {
  if [ -n "$GAME_ID" ] && [ -n "$DEPLOY_TOKEN" ] && [ "$DELETED" -eq 0 ]; then
    curl -sS -X DELETE "$BACKEND_URL/api/v1/games/$GAME_ID" \
      -H "Authorization: Bearer $DEPLOY_TOKEN" >/dev/null || true
  fi
  node -e "require('node:fs').rmSync(process.argv[1],{recursive:true,force:true})" "$WORK_DIR"
}
trap cleanup EXIT

: > "$TRANSCRIPT"
cp -R "$FIXTURE"/. "$WORK_DIR"/

CREATE_FILE=$(mktemp)
CREATE_STATUS=$(curl -sS -o "$CREATE_FILE" -w '%{http_code}' -X POST \
  "$BACKEND_URL/api/v1/new-game/$SLUG?name=Phase%20B%20Smoke")
test "$CREATE_STATUS" = '201'
GAME_ID=$(jq -r .game_id "$CREATE_FILE")
DEPLOY_TOKEN=$(jq -r .deploy_token "$CREATE_FILE")
CLAIM_SECRET=$(jq -r .claim_secret "$CREATE_FILE")
PREVIEW_URL=$(jq -r .preview_url "$CREATE_FILE")
EXPIRES_AT=$(jq -r .expires_at "$CREATE_FILE")
unlink "$CREATE_FILE"
log "create: 201 slug=$SLUG preview=$PREVIEW_URL"

mkdir -p "$WORK_DIR/.blitz"
jq -n --arg slug "$SLUG" --arg id "$GAME_ID" --arg token "$DEPLOY_TOKEN" \
  --arg secret "$CLAIM_SECRET" --arg preview "$PREVIEW_URL" --arg expires "$EXPIRES_AT" \
  '{games:{($slug):{game_id:$id,deploy_token:$token,claim_secret:$secret,preview_url:$preview,expires_at:$expires}}}' \
  > "$WORK_DIR/.blitz/deploys.json"

node --input-type=module - "$REPO_ROOT" "$WORK_DIR" "$RUNTIME_VERSION" <<'NODE'
import {createHash} from 'node:crypto'
import {readFile, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

const [, , repository, project, runtimeVersion] = process.argv
const moduleUrl = pathToFileURL(resolve(repository, 'packages/blitz/src/indexHtml.ts')).href
const {generateIndexHtml} = await import(moduleUrl)
const packagePath = resolve(project, 'package.json')
const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
packageJson.blitz ||= {}
packageJson.blitz.version ||= runtimeVersion
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
const dependencies = Object.entries(packageJson.dependencies || {}).map(([key, version]) => ({key, version}))
const runtimeBytes = await readFile(resolve(project, 'node_modules/@blitzdev/engine/dist/runtime.js'))
const runtimeHash = createHash('sha256').update(runtimeBytes).digest('hex')
const html = generateIndexHtml({name: packageJson.name, version: runtimeVersion, runtimeHash, dependencies})
await writeFile(resolve(project, 'index.html'), html)
NODE
log 'index: generated with relative runtime paths'

RUNTIME_FILE=$(mktemp)
curl -fsS "$BACKEND_URL/api/v1/runtimes/$RUNTIME_VERSION" -o "$RUNTIME_FILE"
RUNTIME_HASH=$(jq -r .sha256 "$RUNTIME_FILE")
RUNTIME_SIZE=$(jq -r .size "$RUNTIME_FILE")
unlink "$RUNTIME_FILE"
log "runtime: 200 version=$RUNTIME_VERSION sha256=$RUNTIME_HASH size=$RUNTIME_SIZE"

build_files() {
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
}

upload_missing() {
  HASHES=$(printf '%s' "$FILES_JSON" | jq '[.[].sha256] | unique')
  MISSING_FILE=$(mktemp)
  curl -fsS -X POST "$BACKEND_URL/api/v1/games/$GAME_ID/blobs/missing" \
    -H "Authorization: Bearer $DEPLOY_TOKEN" \
    -H 'Content-Type: application/json' \
    --data "$(jq -n --argjson hashes "$HASHES" '{hashes:$hashes}')" -o "$MISSING_FILE"
  MISSING_COUNT=$(jq '.missing | length' "$MISSING_FILE")
  log "missing: 200 count=$MISSING_COUNT"
  jq -r '.missing[]' "$MISSING_FILE" | while read -r HASH; do
    PATH_NAME=$(printf '%s' "$FILES_JSON" | jq -r --arg hash "$HASH" \
      'to_entries[] | select(.value.sha256==$hash and .key!="_blitz/runtime.js") | .key' | head -n 1)
    test -n "$PATH_NAME"
    curl -fsS -X PUT "$BACKEND_URL/api/v1/games/$GAME_ID/blobs/$HASH" \
      -H "Authorization: Bearer $DEPLOY_TOKEN" \
      -H 'Content-Type: application/octet-stream' \
      --data-binary "@$PATH_NAME" >/dev/null
  done
  unlink "$MISSING_FILE"
  log "upload: complete count=$MISSING_COUNT"
}

cd "$WORK_DIR"
build_files
upload_missing

FIRST_BODY=$(jq -n --argjson files "$FILES_JSON" '{files:$files,message:"first curl release"}')
FIRST_FILE=$(mktemp)
FIRST_STATUS=$(curl -sS -o "$FIRST_FILE" -w '%{http_code}' -X PUT \
  "$BACKEND_URL/api/v1/games/$GAME_ID/releases" \
  -H "Authorization: Bearer $DEPLOY_TOKEN" \
  -H 'Content-Type: application/json' --data "$FIRST_BODY")
test "$FIRST_STATUS" = '201'
FIRST_HASH=$(jq -r .release_hash "$FIRST_FILE")
unlink "$FIRST_FILE"
log "release-1: 201 release_hash=$FIRST_HASH"

GAME_PULL_FILE=$(mktemp)
GAME_PULL_STATUS=$(curl -sS -o "$GAME_PULL_FILE" -w '%{http_code}' \
  "$BACKEND_URL/api/v1/games/$SLUG" -H "Authorization: Bearer $DEPLOY_TOKEN")
test "$GAME_PULL_STATUS" = '200'
test "$(jq -r .game.id "$GAME_PULL_FILE")" = "$GAME_ID"
unlink "$GAME_PULL_FILE"
RELEASE_PULL_FILE=$(mktemp)
RELEASE_PULL_STATUS=$(curl -sS -o "$RELEASE_PULL_FILE" -w '%{http_code}' \
  "$BACKEND_URL/api/v1/games/$SLUG/releases/$FIRST_HASH" \
  -H "Authorization: Bearer $DEPLOY_TOKEN")
test "$RELEASE_PULL_STATUS" = '200'
test "$(jq -r .active "$RELEASE_PULL_FILE")" = 'true'
INDEX_HASH=$(jq -r '.files["index.html"].sha256' "$RELEASE_PULL_FILE")
unlink "$RELEASE_PULL_FILE"
INDEX_PULL_FILE=$(mktemp)
INDEX_PULL_STATUS=$(curl -sS -o "$INDEX_PULL_FILE" -w '%{http_code}' \
  "$BACKEND_URL/api/v1/games/$SLUG/blobs/$INDEX_HASH" \
  -H "Authorization: Bearer $DEPLOY_TOKEN")
test "$INDEX_PULL_STATUS" = '200'
test "$(shasum -a 256 "$INDEX_PULL_FILE" | awk '{print $1}')" = "$INDEX_HASH"
unlink "$INDEX_PULL_FILE"
log 'pull: game-by-slug=200 release=200 blob=200 active=true'

(
  cd "$REPO_ROOT"
  PREVIEW_URL="$PREVIEW_URL" node --input-type=module <<'NODE'
import {chromium} from '@playwright/test'

const browser = await chromium.launch({headless: true, args: [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
]})
const page = await browser.newPage()
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
await page.goto(process.env.PREVIEW_URL)
await page.waitForFunction(() => (window.__blitzUpdates || 0) > 0)
await page.waitForFunction(() => Boolean(
  window.__blitzViewer?.scene.modelRoot.getObjectByName('PropMesh'),
))
const first = await page.evaluate(() => window.__blitzUpdates || 0)
await page.waitForFunction((before) => (window.__blitzUpdates || 0) > before, first)
const result = await page.evaluate(() => ({
  updates: window.__blitzUpdates || 0,
  propMesh: Boolean(window.__blitzViewer?.scene.modelRoot.getObjectByName('PropMesh')),
}))
if (!result.propMesh || result.updates <= first) throw new Error(`Runtime assertion failed: ${JSON.stringify(result)}`)
if (errors.some((message) => message.includes('unknown component type'))) {
  throw new Error(`Unknown component error: ${errors.join('\n')}`)
}
console.log(`playwright: PropMesh=true updates_before=${first} updates_after=${result.updates}`)
await browser.close()
NODE
) | tee -a "$TRANSCRIPT"

printf '\n// phase B second release\n' >> main.js
build_files
upload_missing

WRONG_BASE=$(printf 'f%.0s' {1..64})
STALE_BODY=$(jq -n --argjson files "$FILES_JSON" --arg base "$WRONG_BASE" \
  '{files:$files,message:"stale curl release",base_release:$base}')
STALE_FILE=$(mktemp)
STALE_STATUS=$(curl -sS -o "$STALE_FILE" -w '%{http_code}' -X PUT \
  "$BACKEND_URL/api/v1/games/$GAME_ID/releases" \
  -H "Authorization: Bearer $DEPLOY_TOKEN" \
  -H 'Content-Type: application/json' --data "$STALE_BODY")
test "$STALE_STATUS" = '409'
test "$(jq -r .error.code "$STALE_FILE")" = 'release_moved'
test "$(jq -r .error.active_release "$STALE_FILE")" = "$FIRST_HASH"
unlink "$STALE_FILE"
log "release-stale: 409 code=release_moved active_release=$FIRST_HASH"

SECOND_BODY=$(jq -n --argjson files "$FILES_JSON" --arg base "$FIRST_HASH" \
  '{files:$files,message:"second curl release",base_release:$base}')
SECOND_FILE=$(mktemp)
SECOND_STATUS=$(curl -sS -o "$SECOND_FILE" -w '%{http_code}' -X PUT \
  "$BACKEND_URL/api/v1/games/$GAME_ID/releases" \
  -H "Authorization: Bearer $DEPLOY_TOKEN" \
  -H 'Content-Type: application/json' --data "$SECOND_BODY")
test "$SECOND_STATUS" = '201'
SECOND_HASH=$(jq -r .release_hash "$SECOND_FILE")
unlink "$SECOND_FILE"
log "release-2: 201 base_release=$FIRST_HASH release_hash=$SECOND_HASH"

DELETE_FILE=$(mktemp)
DELETE_STATUS=$(curl -sS -o "$DELETE_FILE" -w '%{http_code}' -X DELETE \
  "$BACKEND_URL/api/v1/games/$GAME_ID" -H "Authorization: Bearer $DEPLOY_TOKEN")
test "$DELETE_STATUS" = '200'
test "$(jq -r .deleted "$DELETE_FILE")" = 'true'
unlink "$DELETE_FILE"
DELETED=1
log 'delete: 200 deleted=true'
