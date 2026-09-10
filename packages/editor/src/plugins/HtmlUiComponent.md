# HtmlUiComponent

A component for attaching HTML UI elements to 3D objects in threepipe.

## Features

- **HTML Content**: Render any HTML content in a div element
- **Position Modes**: 
  - `world`: Follow a 3D object in world space (automatically projects to screen)
  - `screen`: Fixed screen position (top-left corner)
  - `viewport`: Viewport-relative positioning (using percentages)
- **Customizable Properties**:
  - Size (width, height in pixels)
  - Scrollable content
  - Interactable (pointer events)
  - Visibility toggle
  - Z-index control
  - Offset positioning

## Usage Example

```typescript
import { HtmlUiComponent } from './plugins/HtmlUiComponent'
import { EntityComponentPlugin } from 'threepipe'

// Register the component
viewer.addPluginSync(EntityComponentPlugin)

// Add component to an object
const component = EntityComponentPlugin.AddComponent(myObject, HtmlUiComponent, {
  htmlData: '<div style="background: white; padding: 10px; border-radius: 5px;">Object Label</div>',
  width: 150,
  height: 50,
  positionMode: 'world',
  offsetY: -50, // Position above the object
  scrollable: false,
  interactable: true,
  visible: true,
  zIndex: 1000
})

// Update HTML content
component.setHtml('<div>Updated content</div>')

// Change position
component.setPosition(10, 20) // offsetX, offsetY

// Change size
component.setSize(200, 100)

// Show/hide
component.show()
component.hide()
```

## Position Modes

### World Mode
Follows the 3D object's position in world space and projects it to screen coordinates.
Perfect for labels, tooltips, or info panels attached to 3D objects.

```typescript
component.positionMode = 'world'
component.offsetX = 0  // Pixel offset from projected position
component.offsetY = -50 // Position 50px above the object
```

### Screen Mode
Fixed position relative to the top-left corner of the screen.

```typescript
component.positionMode = 'screen'
component.offsetX = 100  // 100px from left edge
component.offsetY = 50   // 50px from top edge
```

### Viewport Mode
Position relative to the viewport size (0-100 representing percentages).

```typescript
component.positionMode = 'viewport'
component.offsetX = 50  // 50% from left (center)
component.offsetY = 50  // 50% from top (center)
```

## Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `htmlData` | `string` | `'<div>Hello World</div>'` | HTML content to render |
| `width` | `number` | `200` | Width in pixels (set to `-1` for auto) |
| `height` | `number` | `150` | Height in pixels (set to `-1` for auto) |
| `scrollable` | `boolean` | `false` | Enable scrolling for overflow content |
| `interactable` | `boolean` | `true` | Enable pointer events (clickable) |
| `visible` | `boolean` | `true` | Show/hide the element |
| `appendToBody` | `boolean` | `false` | Append to `document.body` (true) or `viewer.container` (false, default). Can be changed dynamically - element will be moved. |
| `positionMode` | `'world' \| 'screen' \| 'viewport'` | `'world'` | Position mode |
| `offsetX` | `number` | `0` | X-axis offset in pixels (or % for viewport mode) |
| `offsetY` | `number` | `0` | Y-axis offset in pixels (or % for viewport mode) |
| `zIndex` | `number` | `1000` | CSS z-index value |

## Methods

### `setHtml(html: string)`
Update the HTML content.

### `setPosition(x: number, y: number)`
Set the offset position.

### `setSize(width: number, height: number)`
Set the size of the element.

### `show()`
Show the element (sets `visible` to `true`).

### `hide()`
Hide the element (sets `visible` to `false`).

## Advanced Examples

### Interactive Button Panel
```typescript
const buttonPanel = EntityComponentPlugin.AddComponent(object, HtmlUiComponent, {
  htmlData: `
    <div style="background: rgba(0,0,0,0.8); color: white; padding: 10px; border-radius: 8px;">
      <button onclick="alert('Button clicked!')">Click Me</button>
    </div>
  `,
  width: 120,
  height: 60,
  positionMode: 'world',
  interactable: true
})
```

### Information Panel with Scroll
```typescript
const infoPanel = EntityComponentPlugin.AddComponent(object, HtmlUiComponent, {
  htmlData: `
    <div style="background: white; padding: 15px; font-family: Arial;">
      <h3>Object Information</h3>
      <p>Lorem ipsum dolor sit amet...</p>
      <ul>
        <li>Property 1</li>
        <li>Property 2</li>
        <li>Property 3</li>
      </ul>
    </div>
  `,
  width: 250,
  height: 200,
  scrollable: true,
  positionMode: 'world'
})
```

### Fixed HUD Element
```typescript
const hud = EntityComponentPlugin.AddComponent(object, HtmlUiComponent, {
  htmlData: `
    <div style="background: rgba(255,255,255,0.9); padding: 10px;">
      <strong>Score:</strong> <span id="score">0</span>
    </div>
  `,
  width: 150,
  height: 40,
  positionMode: 'screen',
  offsetX: 10,
  offsetY: 10,
  interactable: false
})
```

### Auto-Sized Element
```typescript
const autoSized = EntityComponentPlugin.AddComponent(object, HtmlUiComponent, {
  htmlData: `
    <div style="background: white; padding: 15px; border-radius: 5px;">
      <h3>This content determines the size</h3>
      <p>Width and height are automatic!</p>
    </div>
  `,
  width: -1,  // Auto width
  height: -1, // Auto height
  positionMode: 'world'
})
```

### Dynamically Switch Container
```typescript
const component = EntityComponentPlugin.AddComponent(object, HtmlUiComponent, {
  htmlData: '<div style="background: white; padding: 10px;">My UI</div>',
  width: 200,
  height: 100,
  appendToBody: false // Start in viewer.container
})

// Later, move to document.body (useful for full-screen overlays)
component.appendToBody = true

// Move back to viewer.container
component.appendToBody = false
```

## Styling Tips

- Use inline styles in the HTML for better control
- Set `pointer-events: none` on non-interactive elements within the HTML if needed
- Use `rgba()` colors for transparency
- The element has CSS class `threepipe-html-ui` for global styling

## Notes

- Elements are automatically cleaned up when the component is destroyed
- World-positioned elements use `requestAnimationFrame` for smooth tracking
- By default, elements are appended to `viewer.container` (set `appendToBody: true` to append to `document.body` instead)
- The element is positioned absolutely within its container
- Transform origin is centered for world-positioned elements (`translate(-50%, -50%)`)

