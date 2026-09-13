# Kite3D game development guide

Prerequisite: Node.js 20 or newer.

Create and run a project with:

```sh
npx kite3d init my-game
cd my-game
npm install
npx kite3d dev
```

`kite3d dev` prints a local URL such as `http://127.0.0.1:4321/?t=...`. Keep that process running while editing project files. Before publishing, run `npx kite3d pull`; then run `npx kite3d publish` and report the exact live URL it prints, normally `https://<slug>.app.blitz.dev/`. Run `npx kite3d <command> --help` for command-specific usage.

`kite3d init` stamps the running command's exact version into both `devDependencies["kite3d"]` and `kite3d.version`. The devDependency is the project version source of truth. For `file:`, `link:`, `workspace:`, URL, tag, or range specs, commands resolve the version from the installed package metadata. Every command except help, version, `doctor`, `upgrade`, and `skills` checks the resolved version. `doctor` reports a mismatch as a FAIL row. `upgrade` runs in the invoked CLI so it can apply that version's migrations. Other commands delegate to the installed project binary, or tell you to install dependencies or run the pinned exact package through `npx`.

`kite3d init` also initializes a Git repository and commits the generated template. Inside a parent repository it creates a project repository unless that parent already tracks a file below the project directory. Use `kite3d init --no-git` only when Git is deliberately managed elsewhere. The command always prints which Git decision it made.

Run `npx kite3d doctor` to check Node, the project version pin, installed Kite3D package versions, the development port or live project server, backend and runtime registration, Playwright Chromium, and Git. It warns when the detected repository root is not the project root. Fix every FAIL row before relying on the affected workflow.

Create a recoverable point before agent work with `npx kite3d checkpoint "before agent work"`. It commits all project files, including the saved scene, and prints the short Git hash. Restore files without rewriting history with `npx kite3d restore <hash>`, or omit the hash to restore the latest Kite3D checkpoint. Both commands refuse a parent repository unless `--allow-parent-repo` is supplied. Restore is refused while publish holds its lock. The editor exposes the same actions as Checkpoint beside Check and Restore last checkpoint under Settings.

Run `npx kite3d archive` to write `<project-name>-source.zip`. The archive uses the publish exclusion rules, omits `node_modules`, `.kite3d`, and `.git`, and includes `KITE3D-PROJECT.txt` with the creation date, Git commit, and installed Kite3D package versions.

Upgrade the project with `npx kite3d upgrade`. Upgrade targets the invoked CLI's exact version even when the project pins an older CLI. It applies every migration the invoked version knows, rewrites both version fields, runs `npm install --ignore-scripts`, validates the scene, and records a `kite3d-upgrade` journal entry.

`npx kite3d skills` lists the invoked CLI's bundled skills and absolute, readable `SKILL.md` paths. It works outside a project and does not install or execute a skill; pass `--json` for structured output.

Source code to grep after `npm install`:

```text
node_modules/@kite3d/engine/src     runtime, project format, scripting API
node_modules/@kite3d/editor/src     editor
node_modules/kite3d/src      command and local server
node_modules/threepipe/src            engine core, glTF, plugins
node_modules/uiconfig-blueprint/src   editor UI kit
```

# Plugins

A plugin is an npm package with the `kite3d-plugin` keyword and a README that serves as its guide. Find one with `npm search keywords:kite3d-plugin`, read its README before using its API, then run `npm install <pkg>` and add its package name under `kite3d.plugins`. To publish a plugin, export the plugin as the default export, declare a peer dependency on `@kite3d/engine`, add the `kite3d-plugin` keyword, and ship a README.

The MuJoCo integration package is named `@kite3d/plugin-mujoco`; use that name in both npm dependencies and `kite3d.plugins`.

# Engine quick reference

- `createGame` and `createStoppedGame`: boot Play mode or an authoring-only stopped scene; `@kite3d/engine/src/runtime/createGame.ts`.
- `setAuthoringMetadata`, `getAuthoringMetadata`, and `AuthoringRole`: tag and read stable `direct` or `template` sources; `@kite3d/engine/src/authoring.ts`.
- `RuntimeObjectOwner`: own Play-only roots, clones, effects, and cleanup; `@kite3d/engine/src/authoring.ts`.
- `registerGameValidation`: register a gameplay assertion consumed by `kite3d check`; `@kite3d/engine/src/authoringValidation.ts`.
- `publishGameTelemetry`: replace `window.kite3dGame.telemetry` with an immutable test snapshot; `@kite3d/engine/src/authoringValidation.ts`.
- `authoringQualityReport`, `runtimeCleanupReport`, `semanticSceneSnapshot`, and `persistenceReport`: implement the three check outcomes; `@kite3d/engine/src/authoringValidation.ts`.
- `serializeSceneGltf` and `serializeSceneGltfDocument`: write deterministic text glTF and external resources; `@kite3d/engine/src/sceneSerialization.ts`.
- `HtmlUiComponent`: attach world, screen, or viewport-positioned HTML to an object; `@kite3d/engine/src/plugins/HtmlUiComponent.ts`.
- `CannonPhysicsPlugin`, `Cannon3DBodyComponent`, and `Cannon3DShapeComponent`: physics plugin and body components; `@kite3d/engine/src/plugins/cannon/`.
- `Mesh2`: supported mesh class; `threepipe/src/core/object/Mesh2.ts`.
- `PhysicalMaterial`: light-reactive mesh material; `threepipe/src/core/material/PhysicalMaterial.ts`.
- `UnlitMaterial`: flat mesh material that ignores lighting; `threepipe/src/core/material/UnlitMaterial.ts`.
- `UnlitLineMaterial`: unlit line material; `threepipe/src/core/material/UnlitLineMaterial.ts`.
- `LineMaterial2`: configurable line material; `threepipe/src/core/material/LineMaterial2.ts`.

Validation and telemetry belong in `main.js`:

```js
import {publishGameTelemetry, registerGameValidation} from '@kite3d/engine'

export function main({viewer}) {
  publishGameTelemetry({state: 'ready'})
  registerGameValidation(() => ({
    status: viewer.scene.modelRoot.getObjectByName('Player') ? 'pass' : 'fail',
    summary: 'Player exists.',
  }))
}
```

For camera ownership during Play, `camera.controlsMode = ''` disables built-in controls; set `autoLookAtTarget = true` when driving `target`, or false when driving the quaternion. Save `scene.mainCamera` and the changed camera properties in `start()`, call the gameplay camera's `activateMain()`, then reactivate the saved camera and restore its properties in `stop()`.

The Play button is `data-testid="play"`. Other core `data-testid` values for Playwright are `game-canvas`, `save-scene`, `check-game`, `check-results`, `checkpoint-game`, `restore-checkpoint`, `open-game`, `project-files`, `scene-hierarchy`, and `component-types`; select them through `page.getByTestId()`.

The token-protected local API is `GET /api/state`, `GET /api/files`, `GET /api/events`, `GET /api/slug/:slug`, `GET /api/import-map`, `POST /api/check`, and `POST /api/publish`.

Editable is measured from the stopped scene using authored visibility and selectability, source relationships, plus the saved camera; camera containment uses a small epsilon so a point on a mesh face is outside. Persisted serializes that stopped scene, reloads the serialized files, and compares supported semantics with node names in drift paths when available.

The local server owns the project folder. Edit files directly; do not attempt to automate browser permissions. Keep secrets from `.kite3d/deploys.json` and `.kite3d/dev.json` private.

# Local feedback and health

Read `.kite3d/state.json` and `.kite3d/console.log` for the editor and runtime feedback loop. While Play is active, the editor refreshes `state.json.updatedAt` every 5 seconds and writes its `clientId`. Treat a timestamp more than 15 seconds old as stale. A `pagehide` writes `playState: "stopped"`.

The editor creates `.kite3d/console.log` with a header when Play starts. It records `console.warn`, `console.error`, uncaught window errors, and unhandled promise rejections during Play. It deliberately does not record `console.log`; use the browser console for that level. Log forwarding is rate-limited.

Authenticated read endpoints are `GET /api/state`, `GET /api/files`, and the `/api/events` server-sent event stream. Send the token in `X-Kite3D-Token`; GET requests also accept the `?t=` query parameter from the URL printed by `kite3d dev`. In `.kite3d/dev.json`, `origin` is the token-free server origin and `url` includes the session query. Keep that token out of logs and reports.

# Authored versus runtime game content

Every meaningful system must have a useful stopped-mode representation under `viewer.scene.modelRoot`: direct named objects, or a selectable `template` copied for Play. Tag stable sources with `setAuthoringMetadata`.

Keep runtime roots outside `modelRoot` through `RuntimeObjectOwner`. Treat `start()` as repeatable and `stop()`/`destroy()` as mandatory: remove listeners, timers, DOM, physics state, effects, and every runtime root. Never delete or mutate the authored template.

```js
start() {
  this.stop()
  const source = this.ctx.viewer.scene.modelRoot.getObjectByName('Enemy Template')
  this.runtime = new RuntimeObjectOwner('enemy-spawner')
  const root = this.runtime.attachRuntimeRoot(new Group(), this.ctx.viewer.scene, source)
  this.runtime.cloneFrom(source, root, {position: [4, 0, 0]})
}
stop() { this.runtime?.cleanup(); this.runtime = undefined }
```

Keep Play state out of the saved scene. The saved camera must frame authored content and stay outside solid geometry on every load, including reloads of an existing scene. Before calling a change done, Stop, run `npx kite3d check`, and read `.kite3d/check.json`; Playable, Editable, and Persisted are separate outcomes.

# The scene file

`package.json` names the scene in `mainScene`. The default is `assets/main.scene.gltf`. This text glTF file is the scene source of truth. Edit it with a script. Never edit it by hand.

Until three guards its browser global, a Node scene-building script must set `globalThis.ImageData ??= class {}` and then use `await import('three')`; a static import is evaluated before the stub.

The editor writes stable, pretty JSON. Buffer bytes go in a sibling `.bin` file. Embedded images go in `assets/textures/`. Existing project image paths stay unchanged. Keep node and material names stable. Use names or `extras.gltfUUID` to find objects. Keep each node's `extras.gltfUUID` and every key inside `extras.EntityComponentPlugin` stable; those are persistent scene and component ids, not reload counters.

Use glTF Transform from JavaScript when possible:

```sh
npm install --save-dev @gltf-transform/core
```

```js
import {NodeIO} from '@gltf-transform/core'

const scenePath = 'assets/main.scene.gltf'
const io = new NodeIO()
const document = await io.read(scenePath)
const node = document.getRoot().listNodes().find((item) => item.getName() === 'Player')
if (!node) throw new Error('Player node not found')

// Merge extras. Do not replace them. Components and stable ids live here.
node.setExtras({...node.getExtras(), agentTag: 'updated'})
await io.write(scenePath, document)
```

Use `pygltflib` from Python when Python is a better fit:

```py
from pygltflib import GLTF2

scene_path = "assets/main.scene.gltf"
gltf = GLTF2().load(scene_path)
node = next(node for node in gltf.nodes if node.name == "Player")
extras = dict(node.extras or {})
extras["agentTag"] = "updated"
node.extras = extras
gltf.save(scene_path)
```

Components live in node extras. The shape is:

```json
{
  "extras": {
    "gltfUUID": "stable-object-id",
    "EntityComponentPlugin": {
      "stable-component-id": {
        "type": "Spin",
        "state": {"speed": 1}
      }
    }
  }
}
```

Preserve every extras field you do not own. Preserve unknown glTF extensions too. You may wire a component without the editor UI by writing its `{type, state}` entry under `extras.EntityComponentPlugin`, but its module must also be listed under `kite3d.scripts`. Open the editor after a scripted edit. Read `.kite3d/console.log` for parse and load errors.

For example, list a project component as `{"kite3d":{"scripts":["./scripts/X.script.js"]}}`. In `kite3d.scripts` and `kite3d.plugins`, an entry is a bare module only when it exactly matches a key in `package.json`'s `dependencies`; every other entry is a project file, whether or not it starts with `./`.

# Scene asset management

- Keep every visible thing as a file under `assets/`: one glTF per prop, unit, or piece, with its textures beside it, under `assets/models/<category>/<name>/`.
- Keep the scene a list of placed assets. Edit `assets/main.scene.gltf` with a script. Never build geometry in code at load or at Play.
- A script that makes an asset lives in the folder it writes into, for example `assets/models/props/crate/build.mjs`. Run it by hand with `node` or `python3`. Keep its settings as constants at the top. Commit its outputs.
- Keep source files such as `.blend` files beside the asset they produce.
- Keep every prop its own node with a human name, for example `Sandbag stack 12`, grouped by area. A human must be able to select, move, replace, or delete it in the editor.
- Do not merge or instance meshes in the files for speed. Speed work belongs at Play, in `main.js` or a component, and never changes the files.
- Put placement scripts and layout data under `scene/`. Nothing under `assets/` or `scene/` runs in the game. Runtime code lives in `scripts/` and `lib/`.
- Register each asset in `assets.json`, for example `{"version": 1, "files": {"crate": {"path": "assets/models/props/crate/f.gltf"}}}`. Place it in the editor, or with a script that writes the node extras the editor writes on a drop: `rootPath` of `/kite3d/@crate/f.gltf` and `sProperties` for the saved transform.

# Human edits

The local server appends every scene write to `.kite3d/journal.jsonl`. Read it before changing a scene that a human edited. Use `npx kite3d journal -n 10` or `npx kite3d journal --since 2026-09-09T10:00:00Z`.

Each line has `{ts, client, summary}`. `summary` contains node additions, removals, and renames. It also contains transform, component, and material changes.

```json
{"ts":"2026-09-09T18:42:10.000Z","client":"52fa...","summary":{"nodesAdded":[{"name":"Player","uuid":"a1"}],"nodesRemoved":[],"nodesRenamed":[],"transforms":[{"node":{"name":"Player","uuid":"a1"},"property":"position","old":[0,0,0],"new":[1,0,0]}],"components":[],"materials":[]}}
```

Editor writes use the editor client id. API writes use `X-Kite3D-Client`. Watcher-detected writes use `external`. Server mutations use the engine export `KITE3D_SERVER_CLIENT_ID`, whose value is `kite3d-server`.

- The game is using Kite3D game engine built on top of threepipe and three.js.
- The scene path is declared by `mainScene` in `package.json`. Keep the main scene as text glTF.
- The game dependencies, packages, scripts etc are defined in the package.json file in the game project. Any script or dependency required in the scene or the editor must be added to package.json.
- The game consists of objects in the scene like player, trees, enemies, weapons, etc. Each object is a three.js `Object3D` with `Object3DComponents` that extend the functionality of the objects
- Custom components are used to add game-specific behavior to objects. For example, the `PlayerComponent` handles player movement and actions, while the `EnemyComponent` manages enemy AI. These components are defined in their dedicated .script.js files in the game folder and can be attached to the objects using the UI.
- Instruct the user to make changes to the 3D scene or to add or remove components from the game.
- Check node_modules/threepipe for the source code of threepipe and its plugins like `ThreeViewer`, `EntityComponentPlugin` etc.
- threepipe is based on three.js, any three.js export can be imported like `import * as THREE from 'three';`, for three.js addons, they need to be imported from threepipe like `import { SimplifyModifier } from 'threepipe';`(but its not required in most cases as the functionality is built into some plugin).
- The game includes a `main.js` file that exports `main({viewer})`. Play mode and the published runtime call it after the scene has loaded and the timeline, components, and physics have started.
- Do not use inheritance when creating custom components, always extend from `Object3DComponent` directly. For reusable code, use composition by creating helper classes or functions that can be used across multiple components.
- The game uses ES6 modules, so use `import` and `export` statements for modularity.
- When editing files with the editor open, the changes are hot-reloaded automatically on file save. It is necessary to ensure that all resources and event listeners are properly cleaned up in the `destroy()`(or `stop()`) method of components to prevent memory leaks during hot-reloading.
- Some sample components and plugins can be found at the end of this file and in the `samples/` folder with names ending with `.script.js`.
- Kite3D supports two types of code files:

## .script.js Files (Components)
- Define `Object3DComponent` classes that attach to scene objects
- **Lifecycle**: Bound to objects - loaded/unloaded when the object is added/removed from the scene
- Components are instantiated per-object and can have multiple instances in a scene
- Access via `EntityComponentPlugin` methods
- Use for: Player controllers, enemy AI, interactive objects, per-object/per-scene/per-level behaviors
- Example: `PlayerController.script.js`, `EnemyAI.script.js`, `Collectible.script.js`, `GameManager.script.js`

## .plugin.js Files (Plugins)
- Define `AViewerPluginSync` classes that extend the viewer
- **Lifecycle**: Bound to the viewer - loaded once when the project loads, persist until manually removed or project unloads
- Plugins are singletons (one per viewer) that provide global functionality across the entire scene
- Access via `viewer.getPlugin(PluginClass)`
- Use for: Custom render passes, global managers, asset processors, editor extensions
- Example: `CustomPostProcess.plugin.js`, `AudioManager.plugin.js`, `NetworkSync.plugin.js`
- Reference implementation: [TailwindCSSCDNPlugin.ts](https://github.com/repalash/threepipe/blob/master/src/plugins/extras/TailwindCSSCDNPlugin.ts)

**When to use which:**
```js
// PlayerController.script.js - Component for per-object behavior
// Attach to player object, manages that specific player's movement
class PlayerController extends Object3DComponent {
  static ComponentType = 'PlayerController'
  speed = 5
  update({deltaTime}) {
    this.object.position.x += this.speed * deltaTime / 1000
    return true
  }
}

// ScoreManager.plugin.js - Plugin for global state
// One instance manages score across entire game, not tied to any object
// There are no built in event listener lifecycle methods. Events can be listened to in onAdded and cleaned up in onRemove.
class ScoreManagerPlugin extends AViewerPluginSync {
  static PluginType = 'ScoreManagerPlugin'
  score = 0

  onAdded(viewer) {
    super.onAdded(viewer)
    viewer.addEventListener('preFrame', this._onSomeEvent)
    // Initialize when plugin is added to viewer
  }

  onRemove(viewer) {
    viewer.removeEventListener('preFrame', this._onSomeEvent)
    // Cleanup when plugin is removed
    super.onRemove(viewer)
  }

  addScore(points) { this.score += points }
  getScore() { return this.score }
}
```

# Object3DComponent

Access the threepipe viewer inside a component using `this.ctx.viewer`.
- Object3DComponent have access to their parent Object3D via `this.object`
- Get a plugin from component: `this.ctx.plugin(PluginClass)` or `this.ctx.viewer.getPlugin(PluginClass)`
- Check if game is running: `this.ctx.ecp.running` - returns `true` when playing, `false` when paused/edit mode
- Use lifecycle methods in Object3DComponent to manage behavior:
  - `start()` - Called when the scene starts playing. Initialize runtime-only resources here. (only when playing)
  - `stop()` - Called when the scene stops playing. Clean up runtime resources here. (only when playing)
  - `update(e)` - Called on each frame. `e` contains `{time, deltaTime, timeline}`. (only when playing)
  - `preFrame(e)` - Called on each frame before `update`, even when paused/edit mode. Useful for UI logic.
  - `init(object, state)` - Called when component is attached. Use for resources needed in edit mode too.
  - `destroy()` - Called when component is removed. Clean up edit-mode resources, return state.
- Mark object as changed: `this.object.setDirty?.({source: 'MyComponent', change: 'position'})`
- There is no `dispose` method on components by default. Use `stop` or `destroy` for cleanup.
- Listen to object transform changes:
  ```js
  this._onObjectUpdate = (e) => { if (e.source !== 'MyComponent') this.handleChange() }
  this.object.addEventListener('objectUpdate', this._onObjectUpdate)
  // In destroy(): this.object.removeEventListener('objectUpdate', this._onObjectUpdate)
  ```

## State Properties
- Listen to state property changes: `this.onStateChange('propertyName', (newVal, oldVal) => { ... })`
- Use `onStateChange` in constructor to react to property changes (works in edit mode too):
  ```js
  constructor() {
    super()
    this.onStateChange('speed', (v) => {
      if (!this.body) return
      this.body.speed = v
      this.object.setDirty?.({source: 'MyComponent'})
    })
  }
  ```
- Object3DComponent has `StateProperties` which are Serialized properties that can be configured via UI and are saved in the scene file.
  - The UI for these properties is automatically generated and do not need to be specified in the component's `uiConfig`. Any changes to the generated uiConfig can be made by specifying `uiConfig` parameter when defining the StateProperty.
  - These can only be primitive types (string, number, boolean), enums, arrays of primitive types, or serializable objects (like Vector3, Color etc).
  - Define as static array: `static StateProperties = ['enabled', 'speed', { key: 'color', type: 'color' }]`
  - Example 1 - Simple properties:
    ```js
    class PlayerComponent extends Object3DComponent {
      speed = 5           // number
      jumpHeight = 2.5    // number
      isGrounded = true   // boolean
      static StateProperties = ['speed', 'jumpHeight', 'isGrounded']
    }
    ```
  - Example 2 - With type hints and defaults:
    ```js
    class EnemyComponent extends Object3DComponent {
      health = 100
      attackRange = 10 /* this is also the default value */
      patrolDirection = new Vector3(2,2,2) /* three.js math classes and other serializable objects are supported */
      static StateProperties = [
        { key: 'health', default: 100 },
        { key: 'attackRange', type: 'number', uiConfig: { bounds: [1, 10], stepSize: 0.2, type: 'slider' } },
        'patrolDirection'
      ]
    }
    ```

# Component Architecture Patterns
- **Data Component + Manager/System Pattern (Preferred)**: Create lightweight data-only components (no lifecycle methods) that hold attributes, and a single manager/system component that iterates over all entities with that data component in its `update()`. This is more performant and easier to manage.
  - Example: `EnemyDataComponent` holds health, speed, target. `EnemyManagerComponent` (attached to a root object) finds all enemies via `ecp.getComponentsOfType(EnemyDataComponent)` and updates them in one loop.
- **Individual Lifecycle Pattern**: Each entity has its own component with `update()` method. Simpler for small numbers of entities but less efficient at scale and harder to coordinate behavior across entities.
- Prefer the manager/system pattern when: many similar entities exist, entities need coordinated behavior, or performance is critical.
- Use individual lifecycle pattern when: few unique entities exist, or entity behavior is completely independent.

# Common Game Development Patterns

## Input Handling
- Pointer lock requires a focused browser window, so focus the game window before clicking to capture FPS input. Headless browsers normally refuse pointer lock. Keep a cursor-aim fallback for automated FPS testing; do not describe this as the editor refusing pointer lock.
- For keyboard input, add event listeners in `start()` and remove in `stop()`:
  ```js
  start() {
    this._onKeyDown = (e) => { /* handle key */ }
    window.addEventListener('keydown', this._onKeyDown)
  }
  stop() {
    window.removeEventListener('keydown', this._onKeyDown)
  }
  ```

## Object Spawning & Cloning
- Clone objects: `const clone = original.clone()` then add to scene: `obj.parent.add(clone)`, or `viewer.scene.add(clone)`
- For prefabs, load a glb file and clone it: `const prefab = await viewer.load('enemy.glb'); const instance = prefab.clone()`
- Remove objects: `obj.parent.remove(obj)`, or `obj.removeFromParent()`, or remove and dispose(from gpu) of all sub-assets: `obj.dispose && obj.dispose(true)`
- `dispose(true)` already recursively disposes children. Call it once on the root being removed; never call `dispose(true)` from inside that root's `traverse()` callback because disposal mutates the hierarchy during traversal.

## HUD placement

The editor canvas occupies only the viewport pane, not the full page. For a DOM HUD over the game, use `position: fixed` and copy `viewer.canvas.getBoundingClientRect()` into the HUD's `left`, `top`, `width`, and `height` whenever the canvas moves or resizes. A plain `inset: 0` overlay can cover editor panels.

## Asset Loading
- Load assets in `start()`: `const model = await this.ctx.viewer.load('path/to/model.glb')`. Load them in `init` if also needed in edit mode.
- Preload assets before game starts using the AssetManagerPlugin
- Use relative paths from the game folder for assets
- Destroy loaded assets in `stop()` or `destroy()`.
- Models in the projects `assets` folder can be loaded with the base path `/kite3d/assets/`. E.g. `/kite3d/assets/enemy.glb`

## Timers & Delays
- Use `setTimeout`/`setInterval` but clear them in `stop()` to prevent memory leaks
- For game timers, prefer tracking elapsed time in `update()` using `deltaTime`

## Object Visibility & State
- Toggle visibility: `this.object.visible = false`
- Enable/disable rendering: `this.object.traverse(c => c.visible = false)`
- Check distance between objects: `obj1.position.distanceTo(obj2.position)` (assuming same parent transform)

## Raycasting & Collision Detection
- Use three.js Raycaster for picking/collision: `new THREE.Raycaster()`
- For simple collision, check bounding boxes: `box1.intersectsBox(box2)`
- Consider using a physics plugin for complex collision needs, check plugins or other components in the project that might use physics already.

## Performance Tips
- Cache component references in `start()` instead of fetching every frame
- Use object pooling for frequently spawned/destroyed objects
- Avoid creating new Vector3/Quaternion objects in `update()`, reuse them
- Use `setDirty()` on objects only when transforms actually change

## Debugging
- Use `console.log` for verbose debugging in browser dev tools. Use `console.warn` or `console.error` when the message must also reach `.kite3d/console.log` during Play.
- Access any object by name: `viewer.scene.getObjectByName('PlayerMesh')`
- Pause the game to inspect state: use the editor's pause button
- In some cases, it might be better to show logs as HTML text over `this.ctx.viewer.canvas` instead of printing several logs in the console every frame, for the human developer to better see what's happening.


# EntityComponentPlugin API
- The `EntityComponentPlugin` manages all components attached to objects in the scene.
- Access the plugin from viewer: `const ecp = viewer.getPlugin(EntityComponentPlugin)` or from inside a component: `this.ctx.ecp`
- Dispatch method to all components on an object: `EntityComponentPlugin.ObjectDispatch(object, 'methodName', eventData)` - calls `methodName(eventData)` on all components attached to the object

## Getting Components
- From a component instance: `this.getComponent(ComponentClass)` - searches current object, parents, and global registry
- From a component instance (self only): `this.getComponent(ComponentClass, true)` - only searches current object
- Static method on object: `EntityComponentPlugin.GetComponent(object, ComponentClass)` - get first matching component on object
- Static method for parents: `EntityComponentPlugin.GetComponentInParent(object, ComponentClass)` - search object and parent hierarchy
- Get all components on object: `EntityComponentPlugin.GetComponents(object, ComponentClass)` - returns array of matching components
- Get all of type globally: `ecp.getComponentsOfType(ComponentClass)` - returns all components of a type in the scene
- Get first of type globally: `ecp.getComponentOfType(ComponentClass)` - returns first component of a type in the scene

## Adding/Removing Components
- Add component: `ecp.addComponent(object, ComponentClass)` or `ecp.addComponent(object, 'ComponentType')` - returns an undo/redo action with the created component in `action.component`
- Remove component: `ecp.removeComponent(object, component.uuid)` - returns an undo/redo action

## Component Lifecycle Control
- Start all components: `ecp.start()` - calls `start()` on all registered components
- Stop all components: `ecp.stop()` - calls `stop()` on all registered components
- Check if running: `ecp.running` - returns boolean indicating if components are active

## Registering Component Types
- Register a new component class: `ecp.addComponentType(ComponentClass)` - makes it available for use
- Remove a component type: `ecp.removeComponentType(ComponentClass)`
- Check if type exists: `ecp.hasComponentType(ComponentClass)` or `ecp.hasComponentType('ComponentType')`

## Component Data on Objects
- Component data is stored in `object.userData.EntityComponentPlugin` as a map of component UUID to `{type, state}`
- Get component data: `EntityComponentPlugin.GetObjectData(object)` - returns the raw component data object
- Get specific component data: `EntityComponentPlugin.GetComponentData(object, ComponentClass)` - returns `{id, type, state}` for matching component

# ThreeViewer API

The `ThreeViewer` is the main class in threepipe to manage a scene, render, and add plugins.
- Docs: https://threepipe.org/guide/viewer-api.html

## Project viewer settings and materials

`package.json` passes `kite3d.viewer` into `ThreeViewer`. Supported JSON settings are `msaa`, `rgbm`, `zPrepass`, `renderScale`, `maxRenderScale`, `backgroundColor`, `modelRootScale`, `stencil`, `debug`, `tonemap`, `camera`, `maxHDRIntensity`, and `powerPreference`. For example: `{"kite3d":{"viewer":{"msaa":true,"tonemap":false}}}`. The editor applies these defaults too; a viewer configuration saved inside the scene wins when present.

### Lighting quickstart

The default look has no environment map and has tonemapping enabled. For a clear neutral starting point, use a cool hemisphere fill at intensity `1.5`, a warm directional key at intensity `2.5`, and tonemap exposure `1`:

```js
import {DirectionalLight, HemisphereLight, TonemapPlugin} from 'threepipe'

export function main({viewer}) {
  const fill = new HemisphereLight(0xb8d8ff, 0x30343f, 1.5)
  const key = new DirectionalLight(0xfff1d6, 2.5)
  key.position.set(5, 8, 4)
  key.target.position.set(0, 0, 0)
  viewer.scene.addObject(fill)
  viewer.scene.addObject(key)
  viewer.getPlugin(TonemapPlugin).exposure = 1
}
```

Use `Mesh2` with `PhysicalMaterial` when lights should shape the object. Use `UnlitMaterial` for UI-like meshes, markers, and other flat colours that should ignore lighting. `MeshStandardMaterial2` and `MeshBasicMaterial2` are deprecated and log errors. Add image-based lighting after the scene starts in `main.js` when reflections or more natural ambient light are important:

```js
export async function main({viewer}) {
  await viewer.setEnvironmentMap('/kite3d/assets/studio.hdr')
}
```

`main({viewer})` runs after the scene and nested assets load, and the timeline, components, and physics start. It is the right place for runtime setup that depends on the complete scene. `window.viewer` is set by your `main.js` after components start, so tests must wait for it.

## Core Properties
- `viewer.scene` - RootScene: Main scene for rendering (extends three.js Scene)
- `viewer.scene.mainCamera` - PerspectiveCamera2: Main camera for rendering
- `viewer.scene.modelRoot` - Object3D: Container where loaded 3D models are added (this is the scene root in the editor UI). Anything outside this is considered virtual.
- `viewer.renderManager` - ViewerRenderManager: Manages rendering pipeline, has access to webgl renderer, composer, passes, render targets etc.
- `viewer.canvas` - HTMLCanvasElement: The rendering canvas
- `viewer.container` - HTMLElement: The container element (use this for adding HTML overlays, not canvas.parentElement)
- `viewer.assetManager` - AssetManager: Handles loading, caching, and exporting assets
- `viewer.plugins` - Record of all added plugins

## Key Methods
- `viewer.load(url)` - Load a 3D model/texture/material and add to scene. Returns a Promise.
- `viewer.import(url)` - Import an asset without adding to scene
- `viewer.export(object)` - Export an object/material/texture to Blob
- `viewer.exportScene({viewerConfig: true})` - Export entire scene with configuration as glb
- `viewer.setBackgroundMap(url)` - Set background image/texture
- `viewer.setEnvironmentMap(url)` - Set HDR environment map for lighting
- `viewer.addSceneObject(object)` - Add an Object3D to the scene
- `viewer.setDirty()` - Mark scene as needing re-render (next frame)
- `viewer.getPlugin(PluginClass)` - Get an added plugin
- `viewer.addPluginSync(PluginClass)` - Add a plugin
- `viewer.fitToView(object)` - Animate camera to fit object in view
- `viewer.traverseSceneObjects(callback)` - Iterate over all scene objects

## Viewer Events
```js
viewer.addEventListener('preFrame', (e) => { /* before each frame */ })
viewer.addEventListener('postFrame', (e) => { /* after each frame */ })
viewer.addEventListener('preRender', (e) => { /* before rendering, only if dirty */ })
viewer.addEventListener('postRender', (e) => { /* after rendering */ })
viewer.addEventListener('update', (e) => { /* when setDirty() is called. Not very useful. */ })
```

# Threepipe Documentation Links
- Viewer API: https://threepipe.org/guide/viewer-api.html
- Loading Files: https://threepipe.org/guide/loading-files.html
- Exporting Files: https://threepipe.org/guide/exporting-files.html
- Plugin System: https://threepipe.org/guide/plugin-system.html
- Core Plugins: https://threepipe.org/guide/core-plugins.html
- Materials: https://threepipe.org/guide/materials.html
- Serialization: https://threepipe.org/guide/serialization.html
- 3D Assets: https://threepipe.org/guide/3d-assets.html

# Examples

## ⚠ Resource Cleanup in stop()
**ALWAYS clean up resources created in `start()` within the `stop()` method to prevent memory leaks and leftover UI elements.**

Common resources that MUST be cleaned up in `stop()`:
- **HTML/DOM elements** - Remove from DOM and nullify references
- **Event listeners** - Remove all added listeners (keyboard, mouse, window events)
- **Timers** - Clear all `setTimeout`/`setInterval`
- **Objects spawned at runtime** - Remove from scene and dispose
- **Physics bodies** - Remove from physics world
- **Three.js objects** - Call `dispose()` on geometries, materials, textures

```js
class ExampleComponent extends Object3DComponent {
  _uiElement = null
  _keyDownHandler = null
  _timerId = null
  _spawnedObjects = []

  start() {
    // Create UI
    this._uiElement = document.createElement('div')
    document.body.appendChild(this._uiElement)

    // Add event listener
    this._keyDownHandler = (e) => { /* handle */ }
    window.addEventListener('keydown', this._keyDownHandler)

    // Start timer
    this._timerId = setInterval(() => { /* do something */ }, 1000)

    // Spawn objects
    const obj = new Mesh2(...)
    this._spawnedObjects.push(obj)
    this.ctx.viewer.scene.add(obj)
  }

  stop() {
    // Remove UI elements
    if (this._uiElement) {
      this._uiElement.remove()
      this._uiElement = null
    }

    // Remove event listeners
    if (this._keyDownHandler) {
      window.removeEventListener('keydown', this._keyDownHandler)
      this._keyDownHandler = null
    }

    // Clear timers
    if (this._timerId) {
      clearInterval(this._timerId)
      this._timerId = null
    }

    // Clean up spawned objects
    for (const obj of this._spawnedObjects) {
      obj.removeFromParent()
      obj.dispose?.(true)
    }
    this._spawnedObjects.length = 0
  }
}
```

## Lifecycle Example - Simple Movement
```js
class MoveInCircleComponent extends Object3DComponent {
  static StateProperties = ['running', 'radius', 'timeScale']
  static ComponentType = 'MoveInCircleComponent'

  running = true
  radius = 2
  timeScale = 0.1

  update({time}) {
    if (!this.running) return
    this.object.position.x = Math.cos(time * this.timeScale / 100) * this.radius
    this.object.position.z = Math.sin(time * this.timeScale / 100) * this.radius
    return true // return true to mark scene dirty for re-render
  }
}
```

## Lifecycle Example - Physics Body
```js
class RigidBodyComponent extends Object3DComponent {
  static StateProperties = ['running', 'mass', 'damping']
  static ComponentType = 'RigidBodyComponent'

  running = true
  mass = 1
  damping = 0.98
  velocity = new Vector3()
  acceleration = new Vector3()

  start() { this.reset() }
  stop() { this.reset() }

  reset() {
    this.velocity.set(0, 0, 0)
    this.acceleration.set(0, 0, 0)
  }

  update({deltaTime}) {
    if (!this.running) return
    const dt = (deltaTime ?? 16) / 1000
    this.velocity.addScaledVector(this.acceleration, dt)
    this.velocity.multiplyScalar(this.damping)
    this.acceleration.set(0, 0, 0)
    if (this.velocity.lengthSq() < 1e-6) return
    this.object.position.addScaledVector(this.velocity, dt)
    return true
  }

  applyImpulse(impulse) {
    this.velocity.x += impulse.x / this.mass
    this.velocity.y += impulse.y / this.mass
    this.velocity.z += impulse.z / this.mass
  }
}
```

## HTML UI Over Canvas Example
```js
// Simple HTML UI component - edit the HTML directly in htmlData
class HtmlUiComponent extends Object3DComponent {
  static StateProperties = ['htmlData', 'positionMode', 'offsetX', 'offsetY']
  static ComponentType = 'HtmlUiComponent'

  htmlData = '<div style="background:#000a;color:#fff;padding:8px;">Hello World</div>'
  positionMode = 'screen' // 'world', 'screen', 'viewport'
  offsetX = 20
  offsetY = 20

  _element = null

  constructor() {
    super()
    // React to HTML changes
    this.onStateChange('htmlData', (v) => {
      if (this._element) this._element.innerHTML = v
    })
  }

  init(object, state) {
    super.init(object, state)
    this._element = document.createElement('div')
    this._element.style.cssText = 'position:absolute;pointer-events:none;z-index:1000;'
    this._element.innerHTML = this.htmlData
    this.ctx.viewer.container.appendChild(this._element)
    this._updatePosition()
  }

  destroy() {
    this._element?.remove()
    this._element = null
    return super.destroy()
  }

  preFrame() {
    if (this.positionMode === 'world') this._updatePosition()
  }

  _updatePosition() {
    if (!this._element) return
    this._element.style.left = `${this.offsetX}px`
    this._element.style.top = `${this.offsetY}px`
  }

  // Update content programmatically
  setHtml(html) {
    this.htmlData = html
  }
}
```

## Health Bar Example
```js
// Health bar using innerHTML - easy to customize
class HealthBarComponent extends Object3DComponent {
  static StateProperties = ['maxHealth', 'currentHealth']
  static ComponentType = 'HealthBarComponent'

  maxHealth = 100
  currentHealth = 100
  _element = null

  init(object, state) {
    super.init(object, state)
    this._element = document.createElement('div')
    this._element.style.cssText = 'position:absolute;top:20px;left:20px;z-index:100;'
    this.ctx.viewer.container.appendChild(this._element)
    this._update()
  }

  destroy() {
    this._element?.remove()
    return super.destroy()
  }

  _update() {
    if (!this._element) return
    const percent = Math.max(0, Math.min(100, (this.currentHealth / this.maxHealth) * 100))
    const color = percent > 60 ? '#4f4' : percent > 30 ? '#ff4' : '#f44'

    this._element.innerHTML = `
      <div style="font-family:Arial;color:#fff;text-shadow:1px 1px 2px #000;">
        <div style="width:200px;height:20px;background:#000a;border:2px solid #333;border-radius:4px;overflow:hidden;">
          <div style="width:${percent}%;height:100%;background:${color};transition:width 0.2s;"></div>
        </div>
        <div style="font-size:14px;margin-top:4px;">HP: ${Math.round(this.currentHealth)} / ${this.maxHealth}</div>
      </div>
    `
  }

  takeDamage(amount) {
    this.currentHealth = Math.max(0, this.currentHealth - amount)
    this._update()
  }

  heal(amount) {
    this.currentHealth = Math.min(this.maxHealth, this.currentHealth + amount)
    this._update()
  }
}
```

## Using Tailwind CSS
To use Tailwind CSS for styling HTML UI components:

1. **Add TailwindCSSCDNPlugin to viewer** (in package.json or in editor UI):

2. **Use Tailwind classes in your HTML**:
   ```js
   class TailwindUIComponent extends Object3DComponent {
     static StateProperties = ['htmlData']
     static ComponentType = 'TailwindUIComponent'

     htmlData = `
       <div class="bg-black/80 text-white px-4 py-2 rounded-lg shadow-lg">
         <div class="w-48 h-5 bg-gray-700 rounded-full overflow-hidden">
           <div class="h-full bg-green-500 transition-all duration-200" style="width: 75%"></div>
         </div>
         <p class="text-sm mt-2">HP: 75 / 100</p>
       </div>
     `
     _element = null

     init(object, state) {
       super.init(object, state)
       this._element = document.createElement('div')
       this._element.style.cssText = 'position:absolute;top:20px;left:20px;z-index:100;'
       this._element.innerHTML = this.htmlData
       this.ctx.viewer.container.appendChild(this._element)
     }

     destroy() {
       this._element?.remove()
       return super.destroy()
     }
   }
   ```

## Manager/System Pattern Example
```js
// Data-only component (no lifecycle methods needed)
class BulletDataComponent extends Object3DComponent {
  static StateProperties = ['speed', 'damage', 'lifetime']
  static ComponentType = 'BulletDataComponent'
  speed = 10
  damage = 25
  lifetime = 3 // seconds
  age = 0 // runtime only, not serialized
  direction = new Vector3(0, 0, -1)
}

// Manager component (attached to a single root object)
class BulletManagerComponent extends Object3DComponent {
  static ComponentType = 'BulletManagerComponent'

  _bulletsToRemove = []

  update({deltaTime}) {
    const dt = deltaTime / 1000
    const bullets = this.ctx.ecp.getComponentsOfType(BulletDataComponent)

    for (const bullet of bullets) {
      bullet.age += dt
      if (bullet.age >= bullet.lifetime) {
        this._bulletsToRemove.push(bullet)
        continue
      }
      // Move bullet forward
      bullet.object.position.addScaledVector(bullet.direction, bullet.speed * dt)
    }

    // Cleanup expired bullets
    for (const bullet of this._bulletsToRemove) {
      bullet.object.removeFromParent()
      bullet.object.dispose?.(true)
    }
    this._bulletsToRemove.length = 0

    return bullets.length > 0 // dirty if any bullets exist
  }
}
```

## GameManager Example
```js
// Central GameManager - attach to a root object in the scene
class GameManagerComponent extends Object3DComponent {
  static StateProperties = [{
    key: 'gameState',
    type: literalStrings(['menu', 'playing', 'paused', 'gameover']) // automaically creates a dropdown in UI
  }, 'score', 'lives']
  static ComponentType = 'GameManagerComponent'

  gameState = 'menu' // 'menu', 'playing', 'paused', 'gameover'
  score = 0
  lives = 3

  // Runtime references (not serialized)
  _playerComp = null
  _enemySystem = null

  start() {
    // Cache references to other components/systems
    this._playerComp = this.ctx.ecp.getComponentOfType(PlayerComponent)
    this._enemySystem = this.ctx.ecp.getComponentOfType(EnemySystemComponent)
  }

  startGame() {
    this.score = 0
    this.lives = 3
    this.gameState = 'playing'
    this._enemySystem?.spawnInitialEnemies()
  }

  addScore(points) {
    this.score += points
  }

  loseLife() {
    this.lives--
    if (this.lives <= 0) {
      this.gameState = 'gameover'
    }
  }

  update({deltaTime}) {
    if (this.gameState !== 'playing') return
    // Game logic that runs every frame while playing
    return true
  }
}
```

## Enemy System Example
```js
// EnemyData - attach to each enemy object (data only, no update logic)
class EnemyDataComponent extends Object3DComponent {
  static StateProperties = ['health', 'speed', 'damage', 'attackRange']
  static ComponentType = 'EnemyDataComponent'

  health = 100
  speed = 2
  damage = 10
  attackRange = 1.5

  // Runtime state (not serialized)
  _targetPosition = new Vector3()
  _isAlive = true
}

// EnemySystem - attach to ONE root object, manages ALL enemies
class EnemySystemComponent extends Object3DComponent {
  static StateProperties = ['spawnInterval', 'maxEnemies']
  static ComponentType = 'EnemySystemComponent'

  spawnInterval = 3 // seconds
  maxEnemies = 10

  _spawnTimer = 0
  _tempVec = new Vector3() // reusable vector to avoid allocations
  _deadEnemies = []
  _enemyContainer = null // dedicated container for spawned enemies

  start() {
    this._spawnTimer = 0
    this._gameManager = this.ctx.ecp.getComponentOfType(GameManagerComponent)

    // Create a dedicated container in viewer.scene (not modelRoot)
    // This keeps spawned objects separate from scene hierarchy and easy to manage
    this._enemyContainer = new Group()
    this._enemyContainer.name = '_EnemyContainer'
    this.ctx.viewer.scene.add(this._enemyContainer)
  }

  stop() {
    // Cleanup: remove container and all enemies when stopping
    if (this._enemyContainer) {
      this._enemyContainer.removeFromParent()
      this._enemyContainer.dispose?.(true)
      this._enemyContainer = null
    }
  }

  spawnInitialEnemies() {
    for (let i = 0; i < 3; i++) {
      this.spawnEnemy()
    }
  }

  async spawnEnemy() {
    const enemies = this.ctx.ecp.getComponentsOfType(EnemyDataComponent)
    if (enemies.length >= this.maxEnemies) return
    if (!this._enemyContainer) return

    // Load and clone enemy prefab
    const prefab = await this.ctx.viewer.load('enemy.glb')
    const enemy = prefab.clone()

    // Random spawn position
    enemy.position.set(
      (Math.random() - 0.5) * 20,
      0,
      (Math.random() - 0.5) * 20
    )

    // Add to dedicated container (not modelRoot)
    this._enemyContainer.add(enemy)
    this.ctx.ecp.addComponent(enemy, EnemyDataComponent)
  }

  update({deltaTime}) {
    const dt = deltaTime / 1000
    const enemies = this.ctx.ecp.getComponentsOfType(EnemyDataComponent)
    const player = this.ctx.viewer.scene.getObjectByName('Player')

    if (!player) return enemies.length > 0

    // Update all enemies
    for (const enemy of enemies) {
      if (!enemy._isAlive) {
        this._deadEnemies.push(enemy)
        continue
      }

      // Move toward player
      this._tempVec.copy(player.position).sub(enemy.object.position)
      const distance = this._tempVec.length()

      if (distance > enemy.attackRange) {
        this._tempVec.normalize().multiplyScalar(enemy.speed * dt)
        enemy.object.position.add(this._tempVec)
        enemy.object.lookAt(player.position)
      }
    }

    // Cleanup dead enemies
    for (const enemy of this._deadEnemies) {
      enemy.object.removeFromParent()
      enemy.object.dispose && enemy.object.dispose(true)
      this._gameManager?.addScore(10)
    }
    this._deadEnemies.length = 0

    // Spawn timer
    this._spawnTimer += dt
    if(this._spawnTimer >= this.spawnInterval) {
      this._spawnTimer = 0
      this.spawnEnemy()
    }

    return enemies.length > 0
  }

  // Called by other systems (e.g., bullet hit)
  damageEnemy(enemyComp, damage) {
    enemyComp.health -= damage
    if (enemyComp.health <= 0) {
      enemyComp._isAlive = false
    }
  }
}
```

# Publishing

Run `npx kite3d pull` before every update and resolve any local and remote difference. Before the first publish it prints that there is nothing to pull and exits successfully. Pull keeps files changed since the last release and prints `modified locally, kept`; `npx kite3d pull --force` overwrites them. Then run `npx kite3d check`. It imports configured scripts in Node, resolves plugins, verifies scene component types, prints the project validation below Playable on pass or fail, and writes `.kite3d/check.json`; any failure exits 1. `kite3d publish` runs the same check first and stops on failure. Use `--no-check` only when you have deliberately verified the project another way.

Create a game with `npx kite3d publish --slug my-game --name "My Game" --message "initial release"`. The first name defaults to `kite3d.name`, then `name`. Later publishes reuse the saved deploy entry and live name unless `--name` is given. The command hashes the project and its installed `node_modules/@kite3d/engine/dist/runtime.js`, uploads missing blobs, creates a release, records it in `.kite3d/deploys.json`, and prints the live URL. It sends `package.json.description` as the release description. A runtime registry mismatch is a warning unless the backend enables strict registration. Publishing requires network access and a reachable Blitz cloud API.

Publishing omits `package-lock.json`, `.env`, `.env.*`, `*.log`, `.eslintrc*`, `AGENTS.md`, `samples/**`, `tools/**`, and root Markdown files other than `README.md` by default. It publishes a sanitized `package.json` without `devDependencies` or `file:` dependency specs. Add other project-specific glob patterns under `kite3d.publish.exclude` in `package.json`.

Run `npx kite3d status` to print the live local dev server and deploy metadata without tokens or secrets. Run `npx kite3d claim` to print each unclaimed deploy's Blitz claim URL and open it in a browser for Google sign-in. Add `--no-open` to print the URLs without launching a browser. Unknown flags fail with a nonzero exit code.

# Limits

- Source scripts are native ES modules. Bare imports must be declared in `package.json`.
- The main glTF must not contain data URLs. Keep its sibling `.bin` and texture files.
- Scene tools must preserve node extras and unknown extensions.
- Keep generated output, dependencies, secrets, logs, and transient editor data under excluded paths (`dist/`, `node_modules/`, and `.kite3d/`).
- The editor is served only by `kite3d dev` on localhost. Keep its random token private.
