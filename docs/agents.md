# Build a Blitz game

Node.js 20 or newer is required.

```sh
npx @blitzdev/blitz init my-game
cd my-game
npm install
npx blitz dev
```

The last command prints `http://127.0.0.1:4321/?t=...`. Edit source files while it runs. Read `.blitz/state.json` and `.blitz/console.log` for feedback.

## Command line

Run `npx blitz <command> --help` for command-specific usage. Unknown flags fail with a nonzero exit code.

`blitz init` stamps the running command's exact version into both `devDependencies["@blitzdev/blitz"]` and `blitz.version`. The devDependency is the project version source of truth. Every command except `--help` and `--version` checks that pin. A different command version delegates to `node_modules/.bin/blitz` when it is installed, or asks you to run `npm install` or the matching `npx @blitzdev/blitz@<version>` command.

Upgrade both stamped fields, install dependencies without lifecycle scripts, run engine migrations, validate the scene, and journal the change with:

```sh
npx blitz upgrade
npx blitz upgrade --to x.y.z
```

Before every update, run `npx blitz pull` and resolve any local and remote differences. Publish with an explicit slug when creating a game:

```sh
npx blitz publish --slug my-game --name "My Game" --message "initial release"
```

Later publishes reuse the saved deploy entry and can use `npx blitz publish --message "what changed"`. The command reports the live URL. `npx blitz status` prints the local deploy metadata and expiry without secrets.

Claim every unclaimed game recorded in `.blitz/deploys.json` by registering an account:

```sh
npx blitz claim --email player@example.com --password "at-least-8-characters"
```

Add `--login` to sign in to an existing account instead of registering. The command uses each locally stored claim secret but never prints it.

Installed source is available at `node_modules/@blitzdev/engine/src`, `node_modules/@blitzdev/editor/src`, `node_modules/@blitzdev/blitz/src`, `node_modules/threepipe/src`, and `node_modules/uiconfig-blueprint/src`. The full scripting API, lifecycle guidance, examples, publishing rules, and limits are copied into each new project's `AGENTS.md` by `blitz init`.

## The scene file

`package.json` names the scene in `mainScene`. The default is `assets/main.scene.gltf`. It is the scene source of truth. It is text glTF. Edit it with scripts. Never edit it by hand.

The editor moves buffer bytes to `assets/main.scene.bin`. It moves embedded images to hashed files under `assets/textures/`. It preserves project image paths. It sorts JSON object keys and uses two-space indentation.

Use glTF Transform from JavaScript. Merge node extras so stable ids and components survive:

```js
import {NodeIO} from '@gltf-transform/core'

const path = 'assets/main.scene.gltf'
const io = new NodeIO()
const document = await io.read(path)
const node = document.getRoot().listNodes().find((item) => item.getName() === 'Player')
if (!node) throw new Error('Player node not found')
node.setExtras({...node.getExtras(), agentTag: 'updated'})
await io.write(path, document)
```

Python can use `pygltflib`:

```py
from pygltflib import GLTF2

path = "assets/main.scene.gltf"
gltf = GLTF2().load(path)
node = next(node for node in gltf.nodes if node.name == "Player")
node.extras = {**(node.extras or {}), "agentTag": "updated"}
gltf.save(path)
```

Components live at `node.extras.EntityComponentPlugin`. It is a map. Each key is a stable component id. Each value is `{type, state}`. Preserve every extras field you do not own. Preserve unknown glTF extensions.

## Procedural content

Add a `Generator` component to scope procedural work. Its state is `{module, params}`. The module path is project-relative and same-origin. Its default export is:

```js
export default async function generate({node, params, viewer, engine}) {
  const child = new engine.Group()
  child.name = params.name
  return child
}
```

The function may return children or attach them to `node`. Old generated children are removed before each run. It runs on load. It runs after module or params changes. Module file changes rerun it in the editor.

Generated children show a badge. Their transforms are read-only. They are excluded from scene export.

## Bake

Use Bake when procedural results should become authored objects. The editor has a Bake action. Agents can run `npx blitz bake "Node name"`. The editor must be connected.

Bake removes the Generator component. It records the old module and params in `extras.blitzBakedFrom`. It refuses when the node has non-generated children. It refuses when the journal shows human edits under that node since the last bake. `--force` bypasses these checks. The editor requires confirmation for a forced bake.

## Human edits

Every scene write appends one JSON line to `.blitz/journal.jsonl`. Read it before editing the scene. Run `npx blitz journal -n 10` or use `--since <iso>`.

```json
{"ts":"2026-09-09T18:42:10.000Z","client":"52fa...","summary":{"nodesAdded":[{"name":"Player","uuid":"a1"}],"nodesRemoved":[],"nodesRenamed":[],"transforms":[{"node":{"name":"Player","uuid":"a1"},"property":"position","old":[0,0,0],"new":[1,0,0]}],"components":[],"materials":[]}}
```

Editor writes carry the editor client id. API writes use `X-Blitz-Client`. Watcher-detected writes use `external`. Server mutations use the engine export `BLITZ_SERVER_CLIENT_ID`, whose value is `blitz-server`.

## Limits

- Source scripts are native ES modules. Declare bare imports in `package.json`.
- Generator module paths must be project-relative and same-origin.
- The main glTF must not contain data URLs.
- Keep the external `.bin` and texture files with the glTF.
- Generated children are transient until Bake.
- Bake needs a connected local editor.
- Scene tools must preserve extras and unknown extensions.
- Keep secrets from `.blitz/deploys.json` private.
