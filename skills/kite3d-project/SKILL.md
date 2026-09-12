---
name: kite3d-project
description: Orient an agent in a Kite3D project and locate the installed guide and source before editing or validating a scene.
---

# Work in a Kite3D project

Read the project's `AGENTS.md` first. It is the generated project guide and carries the installed version's runtime, authoring, and validation contracts. Follow project-specific instructions there.

For a new project, run `kite3d init <directory>`, install its dependencies, then read the generated `AGENTS.md`. For an existing project, run `kite3d doctor` from its root to identify missing dependencies or version mismatches before relying on the affected workflow.

Run `kite3d sources` from the project to locate the installed implementation. Read or grep those paths for the exact API you need; do not infer APIs from a different engine version. Use `kite3d <command> --help` for command arguments.

After editing, run `kite3d check` and inspect `.kite3d/check.json`. Report Playable, Editable, and Persisted results separately and investigate failed checks using the project guide and installed source.

This entry only directs discovery. Plugin-specific instructions belong with the plugin's implementation and version.
