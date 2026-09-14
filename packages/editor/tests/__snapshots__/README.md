# Snapshot Testing

This directory contains snapshot files that capture the expected output of the `EditorStructure` export functions. These snapshots are used for regression testing to ensure that changes to the code don't unexpectedly alter the output format.

## Files

### Scene Hierarchy Snapshots
- **scene-hierarchy-v2.md** - Markdown v2 format (AI-optimized)
- **scene-hierarchy.json** - JSON format
- **scene-hierarchy.xml** - XML format
- **scene-hierarchy-compact.txt** - Compact format
- **scene-hierarchy-legacy.md** - Legacy markdown format

### Metrics
- **format-sizes.json** - Token efficiency metrics tracking

## How Snapshots Work

### First Run (Creating Snapshots)
When tests run for the first time, they will:
1. Generate output using the current code
2. Write the output to snapshot files
3. Log: `Created snapshot: <filename>`

### Subsequent Runs (Comparing)
On subsequent test runs:
1. Generate output using current code
2. Read the existing snapshot
3. Normalize UUIDs (which change between runs)
4. Compare normalized output
5. **Fail the test if output differs** ❌

## UUID Normalization

Since UUIDs are generated dynamically, we normalize them for comparison:
- Full UUIDs: `a1b2c3d4-e5f6-7890-abcd-ef1234567890` → `UUID`
- Short UUIDs (compact): `a1b2c3d4` → `UUID`
- XML attributes: `uuid="a1b2..."` → `uuid="UUID"`

This ensures we compare structure/content, not dynamic values.

## When Snapshots Change

### Expected Changes (Update Snapshots)
If you intentionally change the output format:
1. Review the changes carefully
2. Delete the old snapshot: `rm tests/__snapshots__/<filename>`
3. Run tests again: `npm test`
4. New snapshot will be created
5. **Commit the new snapshot** to git

### Unexpected Changes (Fix the Code)
If tests fail unexpectedly:
1. Review the diff between current output and snapshot
2. Check your recent code changes
3. Fix the bug causing the regression
4. Tests should pass again

## Size Change Warnings

The `format-sizes.json` snapshot tracks token efficiency metrics. If any format size changes by >10%, you'll see:

```
⚠️  markdown-v2 size changed by 15.3%: 2456 -> 2832
```

This helps catch:
- Performance regressions (output getting larger)
- Missing optimizations
- Unintended format bloat

## Viewing Snapshots

You can manually inspect snapshots to understand the expected output:

```bash
# View markdown v2 format
cat tests/__snapshots__/scene-hierarchy-v2.md

# View JSON format (pretty-printed)
cat tests/__snapshots__/scene-hierarchy.json | jq

# View size metrics
cat tests/__snapshots__/format-sizes.json
```

## Best Practices

### ✅ DO
- Commit snapshot files to git
- Review snapshot diffs in pull requests
- Update snapshots when intentionally changing output
- Use snapshots to catch regressions

### ❌ DON'T
- Blindly update snapshots without review
- Ignore snapshot test failures
- Add snapshots to .gitignore
- Manually edit snapshot files

## Updating All Snapshots

To regenerate all snapshots (use with caution):

```bash
# Delete all snapshots
rm -rf tests/__snapshots__

# Run tests to regenerate
npm test

# Review the new files carefully before committing
git diff tests/__snapshots__
```

## Example Test Failure

```
Error: expect(received).toBe(expected)

Expected: "### Object [Mesh]@UUID\n**ID:** UUID..."
Received: "### Object [Mesh]@UUID\n**Name:** UUID..."

The output format changed! Either:
1. This is a bug - fix your code
2. This is intentional - delete snapshot and regenerate
```

## Integration with CI/CD

Snapshots are checked in CI:
- ✅ Tests pass if output matches snapshots
- ❌ Tests fail if output differs
- 📊 Size warnings logged for review

This ensures consistent output across all environments and prevents regressions from being merged.

## Snapshot File Format

### Text-based Formats (md, xml, txt)
Stored as plain text with:
- Consistent line endings (LF)
- No trailing whitespace
- UTF-8 encoding

### JSON Format
Stored as:
- Pretty-printed (2-space indent)
- Sorted keys (for consistent diffs)
- UTF-8 encoding

### Metrics (JSON)
```json
{
  "markdownV2": 2456,
  "markdown": 3789,
  "compact": 1234,
  "json": 2891,
  "xml": 3102,
  "ratios": {
    "compactToMarkdown": 0.326,
    "v2ToMarkdown": 0.648
  }
}
```

## Troubleshooting

### Tests fail locally but pass in CI
- Check your local threepipe installation
- Ensure test data (LittlestTokyo.glb) loads correctly
- Clear browser cache: `rm -rf ~/.cache/ms-playwright`

### Snapshots differ between machines
- Ensure consistent threepipe version
- Check for floating-point precision differences
- Verify model loads the same way

### Can't update snapshots
- Ensure write permissions: `chmod -R u+w tests/__snapshots__`
- Check disk space
- Verify file isn't locked by another process

