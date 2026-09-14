---
name: kite3d-project
description: Orient an agent in a Kite3D project and locate the installed guide and source before editing a scene.
---

# Work in a Kite3D project

Read the project's `AGENTS.md` first. It is the generated project guide and carries the installed version's runtime and authoring contracts. Follow project-specific instructions there.

For a new project, run `kite3d init <directory>`, install its dependencies, then read the generated `AGENTS.md`. For an existing project, run `kite3d doctor` from its root to identify missing dependencies or version mismatches before relying on the affected workflow.

Run `kite3d sources` from the project to locate the installed implementation. Read or grep those paths for the exact API you need; do not infer APIs from a different engine version. Use `kite3d <command> --help` for command arguments.

After editing, stop Play, save, reload the editor page, and inspect the result. Use the project guide and installed source to investigate problems.

- `kite3d dev --detach` runs the server in the background with its log in `.kite3d/dev.log`.
- `kite3d dev --stop` stops the background development server.
- `kite3d open` opens the launcher that lists every known project and every running editor.

Run npx kite3d screenshot to save a PNG of the editor viewport under .kite3d/screenshots/ and print its path. Look at it before and after visual changes. Add --headless when no editor is open.

This entry only directs discovery. Plugin-specific instructions belong with the plugin's implementation and version.
