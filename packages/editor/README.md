# Kite3D Editor

The editor application served by `kite3d dev`. It uses Threepipe for the 3D viewport.

Generator modules can export an optional flat `params` schema to give the Inspector typed controls, labels, help, defaults, select options, and numeric bounds. Saved keys outside the schema remain editable through inferred controls and the validated JSON fallback.

## Notes

If getting error - `"default" is not exported by ... "classnames"` - remove optimizeDeps and commonjs exclude options from vite config and retry.
