# MCP Bridge Package Publishing Guide

## Package Structure

```
packages/mcp-bridge/
├── package.json          # NPM package configuration (tracked in git)
├── README.md            # Package documentation (tracked in git)
├── .gitignore           # Ignores built files
├── .npmignore           # Controls what gets published to npm
├── bridge-server.js     # Built bundle (gitignored, published to npm)
└── bridge-server.js.map # Source map (gitignored, published to npm)
```

## Build and Publish Workflow

### 1. Build the MCP Bridge

```bash
npm run build:mcp
```

This will:
- Bundle `scripts/mcp-bridge-server.mjs` and its dependencies
- Output to `packages/mcp-bridge/bridge-server.js`
- Generate source map at `packages/mcp-bridge/bridge-server.js.map`
- Make the file executable with `chmod +x`

### 2. Test Locally

Before publishing, test the built package:

```bash
# Test the bundled version
node packages/mcp-bridge/bridge-server.js --test

# Or test with npx locally
cd packages/mcp-bridge
npx . --test
```

### 3. Update Version

Update the version in `packages/mcp-bridge/package.json` before publishing:

```json
{
  "version": "0.11.1"
}
```

### 4. Publish to NPM

```bash
npm run publish:mcp
```

Or manually:

```bash
cd packages/mcp-bridge
npm publish --access public
```

**Note:** Make sure you're logged in to npm:
```bash
npm login
```

### 5. Verify Publication

After publishing, verify the package:

```bash
# Install globally
npm install -g @kite3d/mcp-bridge

# Test it
kite3d-mcp-bridge --test

# Or use with npx
npx @kite3d/mcp-bridge --test
```

## What Gets Published

The `.npmignore` file ensures only these files are published:
- `bridge-server.js` - The bundled executable
- `bridge-server.js.map` - Source map for debugging
- `package.json` - Package metadata
- `README.md` - Documentation

## What's NOT Published

- Source files from `scripts/`
- Development dependencies
- Build configurations
- Other project files

## Integration with Main Project

The main project's build system remains unchanged:
- `npm run dev` - Still works for editor development
- `npm run build` - Still builds the editor
- `npm run build:mcp` - Separately builds the MCP bridge

The MCP bridge build is completely independent and won't interfere with the main editor build process.

## CI/CD Considerations

For automated publishing, you can:

1. Add to GitHub Actions:
```yaml
- name: Build MCP Bridge
  run: npm run build:mcp

- name: Publish MCP Bridge
  run: npm run publish:mcp
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

2. Or use semantic versioning with automated releases

