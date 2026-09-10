# Integrating the ai-game-prototype branch into Blitz

Date: 2026-09-09, evening. Status: plan. Source: `docs/prototype-branch-inventory-2026-09-09.md` (file-level inventory) and the branch docs under `docs/ai-game-prototype/` on repalash/threepipe-blueprint-editor `codex/ai-game-prototype` (head 9a3c7c2).

## What the branch is

An in-editor AI prototype. A local companion process owns the project folder, checkpoints, build, export, publish, and the provider process. The official Codex App Server runs prompts from a panel inside the editor. A project-scoped MCP relay lets the agent operate the scene. Milestones 0 to 3A are validated, 3B and 5 are automated, publish is a labeled POC.

## How it maps to our decisions

- Their companion is our `blitz dev`. Same loopback role and capability model. Our server already replaces their folder-permission pairing, which they list as an awkward deferred problem.
- Prompt Mode, Codex App Server, and the MCP relay conflict with our terminal-agent model. See "Optional: Prompt Mode" below for the conditional path.
- Their publish POC splits files into text modules for old platform limits. Our blob store supersedes it. Their publish hardening is worth taking.
- They keep `main.scene.glb` authoritative and call their semantic scene report evidence, not a second format. That matches our journal rule. Only the file format differs, and our text glTF fits scripts better.
- No feature is reusable as-is. Every one assumes MCP, the File System Access API, a per-project vendored runtime, or the old publish path. Ideas, rules, fixtures, and tests transfer. Transports do not.

## Passes, in order

Each pass ends with tests that fail without the change. No time estimates. Decisions recorded at the end of this file.

### P1. Authoring contract, validator, and `blitz check`

The highest value. It targets the failure mode agents produce: a controller-only scene that builds everything at play time, or a saved camera inside the floor.

- Engine: `packages/engine/src/authoring.ts` with `userData.blitzAuthoring` `{role: 'direct'|'template'|'generator', id, sourceId, allowCameraInside}`; `RuntimeObjectOwner` with `attachRuntimeRoot`, `trackEffect`, `cloneFrom`, `cleanup`; runtime roots live outside `modelRoot` and are removed on Stop. Extend `GeneratorComponent` with the bounded, non-multiplying preview rule.
- Engine: `packages/engine/src/authoringValidation.ts` extracted from their `MCPBridgeHandler.ts`: the stopped-mode quality report (visible authored renderables, selectable, traceable sources, camera frustum coverage, camera embedding by local mesh bounds), the save-and-reload semantic comparison, the Stop cleanup check, and hooks for project-defined assertions and telemetry. Failure codes as theirs: `NO_VISIBLE_AUTHORED_CONTENT`, `GENERATOR_PREVIEW_MISSING`, `RUNTIME_OBJECT_AFTER_STOP`, `MISSING_AUTHORING_SOURCE`, `RUNTIME_SOURCE_DRIFT`, `CAMERA_NOT_USEFUL`, `CAMERA_CONTAINMENT_UNVERIFIED`.
- Tests: their positive and negative fixture matrix, ported: direct room, template plus spawner, generator plus preview, controller-only, leaked runtime object, deleted source, stale clone, save-reload drift, camera in solid box, camera beside rotated floor, camera in torus hole.
- CLI and server: `blitz check` runs the report through the open editor (server asks over SSE, the editor runs and posts the result) or headless through the runtime; results to `.blitz/check.json` and the console. Playable, Editable, Persisted stay separate outcomes.
- Template: distill their 12-line AGENTS contract into ours: the three patterns, runtime roots outside `modelRoot`, `start()` repeatable and `stop()` mandatory, no play state in the saved scene, camera framed on every load, run `blitz check` before calling a change done.

### P2. Transitive hot reload

Our fix pass F covers a changed entry script. It does not cover a changed dependency behind an unchanged entry, nor cycles. Their `module-reload.spec.ts` does.

- Server: rewrite relative imports in served modules with `?v=<sha256 of the target>` using a real ES module lexer, so a change anywhere bumps every importer's URL. No regex parser.
- Tests: port the re-export chain and cycle cases into `packages/editor/test/editor/dev-server.spec.ts`.

### P3. Publish hardening

- `blitz publish`: refuse during Play or with an unsaved editor draft (from `.blitz/state.json`), save the scene first, reject symlinks, lock duplicate attempts, retry 429 and 5xx with uncertain-write reconciliation, verify every public asset byte for byte by SHA-256 from the live URL after release, strip tokens from diagnostics, keep status across reloads.
- Tests: their conflict, rate-limit, timeout, connection-loss, uncertain-write, and hash-mismatch matrix in `packages/blitz/test/publish.test.ts` against `mockBackend.ts`.

### P4. Source editing in the Inspector

- Editor: `SourceEditorPanel.tsx` with their draft state machine: late reads rejected, the draft being saved snapshotted, edits typed during save preserved, conflicts explicit with Reload or Overwrite. One write path only: `ProjectSource.write` with `If-Match`, external changes over SSE. Publish and export block while a draft is dirty.
- Tests: port `source-editor.spec.ts` race and conflict cases.

### P5. Runtime and persistence gates

- Engine tests: save, reload, page reopen, Play, Stop, semantic compare; startup order (components before plugins before scene); corrupt and missing scene produce a visible error; independent launch of a published release from a clean static directory with a check for foreign requests.

### P6. CLI conveniences

- `blitz doctor`: Node version, free port, pin match, packages installed, backend reachable.
- `blitz checkpoint <label>` and `blitz restore`: git-based, with an editor button. One checkpoint before agent work, one restore.
- `blitz archive`: the sanitized source ZIP with a provenance file. Later.


## Decided 2026-09-09, late

- Prompt Mode and the in-browser AI chat are deleted, not ported. Nothing from `AIAgentTab`, the Codex adapter, the companion's provider lifecycle, or the MCP relay comes over.
- P4, source editing in the Inspector, is a view over the project files only. Reads and writes go through the dev server with `If-Match`, the draft lives in memory while typing, nothing else persists.
- Crystal Vault is not ported. Blitz ships its own samples.
- Routine calls: `blitz init` creates a git repo so checkpoints are commits; `blitz check` runs through the open editor first, headless later; hot reload uses a server-side import rewrite with a real ES module lexer; telemetry and validation hooks ship with P1; Node 20 or newer.
- Order: P1, then P3 with the publish and claim dialog in the local editor, then P2, P5, P6, P4.

## Not taken

- The MCP bridge, relay, and tools. The Codex App Server smoke with MCP.
- The File System Access pairing and the workspace welcome flow.
- The split-file Worker publisher and the base64 ZIP transfer.
- The per-project vendored runtime builder and the `threepipe@0.4.4` pin. We run 0.5.1 with the patched three.
- The five large AI-format snapshot fixtures and their warn-only size checks.
