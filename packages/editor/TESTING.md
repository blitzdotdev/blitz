# EditorStructure Testing - Quick Start

## Installation

```bash
# Install Playwright
npm install -D @playwright/test

# Install browser binaries (Chromium only for faster setup)
npx playwright install chromium
```

## Running Tests

```bash
# Run all tests
npm test

# Run with interactive UI (recommended for development)
npm run test:ui

# Run in headed mode (see the browser)
npm run test:headed

# Debug specific test
npm run test:debug tests/editor-structure.spec.ts

# View last test report
npm run test:report
```

## Snapshot Testing 📸

Tests automatically capture output to files and compare them on subsequent runs. This catches regressions instantly!

### How It Works

**First Run:**
- Tests generate snapshots in `tests/__snapshots__/`
- Files: `scene-hierarchy-v2.md`, `scene-hierarchy.json`, etc.
- Commit these files to git

**Subsequent Runs:**
- Tests compare current output with snapshots
- UUIDs are normalized (they change between runs)
- ✅ Pass if output matches
- ❌ Fail if output differs

### Snapshot Files

- `scene-hierarchy-v2.md` - Markdown v2 format
- `scene-hierarchy.json` - JSON format  
- `scene-hierarchy.xml` - XML format
- `scene-hierarchy-compact.txt` - Compact format
- `scene-hierarchy-legacy.md` - Legacy markdown
- `format-sizes.json` - Token efficiency metrics

### Updating Snapshots

If you intentionally change output format:

```bash
# Delete old snapshots
rm tests/__snapshots__/scene-hierarchy-*.md

# Regenerate
npm test

# Review changes
git diff tests/__snapshots__

# Commit if correct
git add tests/__snapshots__
git commit -m "Update output format"
```

### Size Warnings ⚠️

If format size changes >10%, you'll see:
```
⚠️  markdown-v2 size changed by 15.3%: 2456 -> 2832
```

This catches performance regressions and unintended bloat.

## What's Being Tested

The tests validate the `getSceneStructureMd()` function which exports 3D scene hierarchies in 5 different formats:

1. **markdown-v2** (default) - Best for AI consumption
2. **json** - Machine-parseable format
3. **xml** - With proper escaping and attributes
4. **compact** - Ultra token-efficient
5. **markdown** - Original verbose format

### Test Coverage

✅ All 5 formats generate valid output  
✅ Scene hierarchy preserved across formats  
✅ Transform data (position, rotation, scale) captured correctly  
✅ Default values omitted for token efficiency  
✅ Geometry and material information included  
✅ Component support validated  
✅ Token efficiency comparisons (compact < markdown-v2 < markdown)  
✅ Special character handling (XML escaping, JSON encoding)  
✅ Large scene performance (50+ objects)  
✅ Edge cases (empty scenes, missing plugins, hidden objects)  

## Test Files

- `tests/editor-structure.spec.ts` - Core functionality (25+ tests)
- `tests/format-comparison.spec.ts` - Format efficiency and consistency (15+ tests)
- `tests/test-page.html` - Test harness with ThreeViewer

## Example Test Output

```
✓ should initialize ThreeViewer and load scene
✓ should generate markdown-v2 format
✓ should generate valid JSON format
✓ should generate valid XML format
✓ should generate compact format
✓ should include object hierarchy in all formats
✓ should compare token efficiency across formats
  - compact: 1,234 chars
  - markdown-v2: 2,456 chars  (30% more)
  - markdown: 3,789 chars      (54% more)
```

## Debugging Failed Tests

1. **Check the test page directly**:
   ```bash
   npm run dev
   # Open http://localhost:5173/tests/test-page.html
   ```

2. **View screenshots** (auto-captured on failure):
   ```
   test-results/*/test-failed-1.png
   ```

3. **View trace** (step-by-step execution):
   ```bash
   npx playwright show-trace test-results/*/trace.zip
   ```

4. **Run in debug mode**:
   ```bash
   npm run test:debug tests/editor-structure.spec.ts
   ```

## CI/CD Integration

Add to `.github/workflows/test.yml`:

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm test
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

## Common Issues

### Port Already in Use

If port 5173 is taken, update `playwright.config.ts`:
```typescript
baseURL: 'http://localhost:5174',
webServer: {
  command: 'npm run dev -- --port 5174',
  url: 'http://localhost:5174',
}
```

### Tests Timeout

Increase timeout in test:
```typescript
test('my test', async ({ page }) => {
  test.setTimeout(120000) // 2 minutes
  // ...
})
```

### Model Loading Fails

Check network connection or use local models in `test-page.html`.

## Next Steps

- Add more test cases for your specific use cases
- Test with different 3D models
- Add performance benchmarks
- Test component serialization
- Add visual regression tests for rendered output

## Resources

- [Playwright Docs](https://playwright.dev)
- [Test README](./tests/README.md) - Detailed documentation
- [EditorStructure.ts](./src/utils/three/EditorStructure.ts) - Source code

