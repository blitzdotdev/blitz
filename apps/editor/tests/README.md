# EditorStructure Tests

Playwright tests for the `EditorStructure.ts` utility that exports 3D scene hierarchies in various formats optimized for AI consumption.

## Setup

1. Install dependencies:
```bash
npm install -D @playwright/test
npx playwright install chromium
```

2. Run tests:
```bash
# Run all tests
npx playwright test

# Run with UI
npx playwright test --ui

# Run specific test file
npx playwright test tests/editor-structure.spec.ts

# Run in headed mode (see browser)
npx playwright test --headed

# Debug mode
npx playwright test --debug
```

## Test Structure

### Test Files

- **`editor-structure.spec.ts`** - Core functionality tests
  - Scene initialization
  - Format generation (markdown-v2, json, xml, compact, markdown)
  - Hierarchy preservation
  - Transform data handling
  - Component and material information
  - Edge cases (empty scenes, missing plugins)

- **`format-comparison.spec.ts`** - Format comparison and efficiency tests
  - Token efficiency comparisons
  - Cross-format consistency
  - Special character handling
  - Performance with large scenes
  - Format-specific features

- **`test-page.html`** - Test harness page
  - Loads ThreeViewer with sample scene
  - Provides global test helpers
  - Visual feedback during test execution

### Key Test Areas

1. **Format Generation**
   - All 5 formats generate valid output
   - Each format follows its documented structure
   - UUIDs are properly included

2. **Data Accuracy**
   - Object hierarchy preserved
   - Transform data (position, rotation, scale) correctly captured
   - Default values omitted (optimization)
   - Geometry and material information included

3. **Token Efficiency**
   - Compact format is most token-efficient
   - markdown-v2 is ~30% more efficient than markdown
   - Comparisons validated across formats

4. **Edge Cases**
   - Empty scenes
   - Missing EntityComponentPlugin
   - Special characters in names
   - Large scenes (50+ objects)
   - Hidden/invisible objects

5. **Format-Specific Features**
   - **markdown-v2**: Tables for transforms, grouped sections
   - **json**: Valid JSON, parseable structure
   - **xml**: Well-formed XML, escaped special chars
   - **compact**: Abbreviated notation (P, G, M, C), 8-char UUIDs
   - **markdown**: Full detail, nested lists

## Test Page

The test page (`test-page.html`) provides a minimal ThreeViewer setup that:
- Loads the LittlestTokyo model from Three.js examples
- Sets up environment map
- Exposes viewer and test functions globally
- Shows real-time test logs in the UI

You can open it directly in a browser during development:
```bash
npm run dev
# Then navigate to http://localhost:5173/tests/test-page.html
```

## CI/CD Integration

Tests are configured to run in CI with:
- Automatic retries (2 attempts)
- Screenshot capture on failure
- Trace recording for debugging

Example GitHub Actions workflow:
```yaml
name: Playwright Tests
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
      - run: npx playwright test
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

## Debugging

1. **Visual debugging** - Run with `--headed` to see the browser
2. **Step through** - Use `--debug` to pause at each step
3. **Screenshots** - Automatically captured on failure
4. **Traces** - View in Playwright Trace Viewer: `npx playwright show-trace trace.zip`
5. **Console logs** - All test logs appear in the browser console

## Adding New Tests

1. Add test cases to existing spec files or create new ones in `tests/`
2. Use the test page setup in `beforeEach` hooks
3. Access viewer via `window.testViewer`
4. Use `page.evaluate()` to run code in browser context
5. Follow existing patterns for assertions

Example:
```typescript
test('my new test', async ({ page }) => {
  await page.goto('/tests/test-page.html')
  await page.waitForFunction(() => window.testInitComplete)
  
  const result = await page.evaluate(() => {
    // Your test code here
    return window.getSceneStructureMd(window.testViewer, 'json')
  })
  
  expect(result).toBeTruthy()
})
```

## Coverage

Tests cover:
- ✅ All 5 export formats
- ✅ Scene hierarchy preservation
- ✅ Transform data handling
- ✅ Material and geometry info
- ✅ Component support
- ✅ Token efficiency
- ✅ Special characters
- ✅ Large scenes
- ✅ Edge cases
- ✅ Format-specific features

