# Kite 3D MCP Bridge

MCP Bridge Server for Kite 3D Game Engine - enables AI agents to interact with the Kite 3D editor through the Model Context Protocol (MCP).

## Installation

```bash
npm install -g @kite3d/mcp-bridge
```

Or use with npx:

```bash
npx @kite3d/mcp-bridge
```

## Usage

### Run the MCP Bridge Server

```bash
# Standard MCP mode (stdio transport) - default port 3848
kite3d-mcp-bridge

# With custom port
kite3d-mcp-bridge --port=3845

# Or directly with node
node bridge-server.js --port=3845
```

### Test Mode

Run in interactive test mode to verify the bridge is working:

```bash
kite3d-mcp-bridge --test --port=3845

# Or
node bridge-server.js --test --port=3845
```

In test mode, you can type commands like:
```
createObject {"type":"geometry-box"}
getSceneHierarchy {}
status
exit
```

## Configuration

The bridge server:
- Uses **stdio** transport for MCP communication (compatible with Claude Desktop and other MCP clients)
- Opens a **WebSocket server** on port `3848` for editor connections (configurable via `MCP_BRIDGE_WS_PORT` env var)
- Supports real-time bidirectional communication between AI agents and the Kite 3D editor

## Connecting the Editor

In the Kite 3D editor:
1. Open a project
2. Navigate to the **AI MCP Bridge** tab
3. Ensure the port is set to `3848` (or your custom port)
4. Click **Connect to MCP Bridge**

## Available Tools

The MCP bridge provides the following tools for AI agents:

- `getSceneHierarchy` - Get the 3D scene object hierarchy
- `getSelectedObjects` - Get currently selected objects
- `selectObject` - Select an object by name or UUID
- `createObject` - Create new 3D objects (mesh, light, camera, etc.)
- `deleteObject` - Delete objects from the scene
- `modifyObject` - Modify object properties (position, rotation, scale, etc.)
- `duplicateObject` - Duplicate an existing object
- `addComponent` - Add components/scripts to objects
- `removeComponent` - Remove components from objects
- `getAvailableComponents` - List available component types
- `setObjectParent` - Reparent objects in the hierarchy
- `focusObject` - Focus the camera on an object
- `getObjectDetails` - Get detailed information about an object
- `findObjects` - Search for objects by name pattern or type
- `getMaterials` - List all materials in the scene
- `getTextures` - List all textures in the scene
- `executeCommand` - Execute editor commands (undo, redo, play, stop)
- `getProjectInfo` - Get project metadata
- `getEditorState` - Get current editor state

## Claude Desktop Configuration

To use with Claude Desktop, add to your MCP settings:

```json
{
  "mcpServers": {
    "kite3d": {
      "command": "npx",
      "args": ["@kite3d/mcp-bridge", "--port=3848"]
    }
  }
}
```

Or with custom port:

```json
{
  "mcpServers": {
    "kite3d": {
      "command": "npx",
      "args": ["@kite3d/mcp-bridge", "--port=3845"]
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "kite3d": {
      "command": "kite3d-mcp-bridge",
      "args": ["--port=3848"]
    }
  }
}
```

## Environment Variables

- `MCP_BRIDGE_WS_PORT` - WebSocket server port (default: 3848)

## Development

The bridge server is built with:
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk) - MCP protocol implementation
- [ws](https://github.com/websockets/ws) - WebSocket communication with the editor

## License

MIT

## Links

- [Kite 3D Editor](https://kite3d.io)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [GitHub Repository](https://github.com/repalash/threepipe-blueprint-editor)

