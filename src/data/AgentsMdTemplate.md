# Notes for Kite and threepipe Game Development

- The game is using kite game engine built on top of threepipe and three.js.
- Scenes in the game are designed in a UI editor(similar to Unity/Godot) and exported as .scene.glb files. These are binary files and cannot be read or edited as text
- The game dependencies, packages, scripts etc are defined in the package.json file in the game project. Any script or dependency required in the scene or the editor must be added to package.json
- The game consists of objects in the scene like player, trees, enemies, weapons, etc. Each object is a three.js `Object3D` with `Object3DComponents` that extend the functionality of the objects
- Custom components are used to add game-specific behavior to objects. For example, the `PlayerComponent` handles player movement and actions, while the `EnemyComponent` manages enemy AI. These components are defined in their dedicated .script.js files in the game folder and can be attached to the objects using the UI.
- Instruct the user to make changes to the 3D scene or to add or remove components from the game.
- Check node_modules/threepipe for the source code of threepipe and its plugins like `ThreeViewer`, `EntityComponentPlugin` etc.
- threepipe is based on three.js, any three.js export can be imported like `import * as THREE from 'three';`, for three.js addons, they need to be imported from threepipe like `import { SimplifyModifier } from 'threepipe';`(but its not required in most cases as the functionality is built into some plugin).
- The game includes a main.js file that is not used during development, so it not to be modified.
- Do not use inheritance when creating custom components, always extend from `Object3DComponent` directly. For reusable code, use composition by creating helper classes or functions that can be used across multiple components.
- The game uses ES6 modules, so use `import` and `export` statements for modularity.
- When editing files with the editor open, the changes are hot-reloaded automatically on file save. It is necessary to ensure that all resources and event listeners are properly cleaned up in the `destroy()`(or `stop()`) method of components to prevent memory leaks during hot-reloading.
- Some sample components and plugins can be found at the end of this file and in `.kite/samples` folder with names ending with `.script.js`. 
- kite3d supports two types of code files:

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
- Listen to object transform changes:
  ```js
  this._onObjectUpdate = (e) => { if (e.source !== 'MyComponent') this.handleChange() }
  this.object.addEventListener('objectUpdate', this._onObjectUpdate)
  // In destroy(): this.object.removeEventListener('objectUpdate', this._onObjectUpdate)
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

## Asset Loading
- Load assets in `start()`: `const model = await this.ctx.viewer.load('path/to/model.glb')`. Load them in `init` if also needed in edit mode.
- Preload assets before game starts using the AssetManagerPlugin
- Use relative paths from the game folder for assets
- Destroy loaded assets in `stop()` or `destroy()`.

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
- Use `console.log` for debugging, visible in browser dev tools
- Access any object by name: `viewer.scene.getObjectByName('PlayerMesh')`
- Pause the game to inspect state: use the editor's pause button
- In some cases, it might be better to show logs as HTML text over `this.ctx.viewer.canvas` instead of printing several logs in the console every frame, for the human developer to better see what's happening.
- Use the Kite Editor MCP to inspect the editor and scene state at runtime.

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

Common Tailwind classes for game UI:
- **Positioning**: `absolute`, `fixed`, `top-4`, `left-4`, `bottom-0`, `right-0`
- **Background**: `bg-black/80` (black with 80% opacity), `bg-gray-900`, `bg-gradient-to-r`
- **Text**: `text-white`, `text-sm`, `text-xl`, `font-bold`, `text-shadow`
- **Spacing**: `p-4` (padding), `m-2` (margin), `space-x-2` (horizontal spacing)
- **Sizing**: `w-48` (width), `h-5` (height), `w-full`, `max-w-md`
- **Effects**: `rounded-lg`, `shadow-lg`, `opacity-90`, `backdrop-blur`
- **Animation**: `transition-all`, `duration-200`, `hover:scale-110`

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
viewer.addEventListener('update', (e) => { /* when setDirty() is called */ })
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
      this._enemyContainer.traverse(c => c.dispose?.(true))
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
