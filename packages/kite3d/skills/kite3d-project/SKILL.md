---
name: kite3d-project
description: Orient an agent in a Kite3D project and locate the installed guide and source before editing a scene.
---

# Work in a Kite3D project

Read the project's `AGENTS.md` first. It is the generated project guide and carries the installed runtime contract. Follow project-specific instructions there.

For a new project, run `kite3d init <directory>`, install its dependencies, then read the generated `AGENTS.md`.

Read or grep the installed source paths listed in the project guide for the exact API you need. Use `kite3d <command> --help` for command arguments.

After editing, stop Play, save, reload the editor page, and inspect the result. Use the project guide and installed source to investigate problems.

Run npx kite3d screenshot to save a PNG of the editor viewport under .kite3d/screenshots/ and print its path. Look at it before and after visual changes. Add --headless when no editor is open.

This entry only directs discovery. Plugin-specific instructions belong with the plugin's implementation and version.
