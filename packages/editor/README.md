# Kite3D Editor

The editor application served by `kite3d dev`. It uses Threepipe for the 3D viewport.

Generator modules can export an optional flat `params` schema to give the Inspector typed controls, labels, help, defaults, select options, and numeric bounds. Saved keys outside the schema remain editable through inferred controls and the validated JSON fallback.

## Notes

If getting error - `"default" is not exported by ... "classnames"` - remove optimizeDeps and commonjs exclude options from vite config and retry.

The right-panel Memory tab is hidden by default. Enable it for diagnostics with
`?memory=1` in the editor URL or by setting `localStorage["kite3d.memoryTab"]`
to `"1"`, then reload the editor.
