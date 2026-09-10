# Testing Blitz with another agent

The packages are on npm. Paste this to the other agent, substituting your own game idea if needed:

```
use npx @blitzdev/blitz and build me an FPS shooting practice game
Never print the deploy token or claim secret from .blitz/deploys.json.
```

The CLI output carries the loop from project creation through reading `AGENTS.md`, running the editor, checking the game, and publishing it.

Outside a project, `npx blitz` runs Blitz.js, an unrelated package with the same bare name. Use `npx @blitzdev/blitz` for init. Inside a project, `npx blitz` runs the local Blitz command.

## Testing unreleased changes from this machine

To test a build of `main` that is not published yet, pack the four packages into local tarballs after each merge:

```sh
npm run build && rm -rf /Users/minjunes/blitz-packs && mkdir -p /Users/minjunes/blitz-packs && for p in engine editor blitz template; do npm pack --silent --pack-destination /Users/minjunes/blitz-packs ./packages/$p; done
```

For an unreleased test, give the agent these local setup commands in place of the public package command:

```
node /Users/minjunes/blitz/packages/blitz/dist/cli.js init fps-practice && cd fps-practice
npm install --save-dev --ignore-scripts --install-links --cache /tmp/blitz-npm-cache /Users/minjunes/blitz-packs/*.tgz
(do not run a plain npm install; the file: pins resolve from the installed package versions)
```

What to expect today:

- The editor URL opens in your browser and shows the project in the upstream editor layout, with Play, Check, Checkpoint, and Open game at the top right. Script saves by the agent hot-reload, including modules they import. The scene is a deterministic text glTF at `assets/main.scene.gltf` with an external `.bin`; the agent edits it with scripts, and generated content lives under Generator nodes.
- `npx blitz check` is the required step before publish. It resolves scripts, plugins, and generators, then reports Playable, Editable, and Persisted, headless or through the open editor. Results go to `.blitz/check.json` and `.blitz/console.log`. Publish repeats the check unless `--no-check` is supplied, refuses while the editor is playing or has an unsaved draft, and verifies every public asset after release.
- The live URL is `https://<slug>.app.blitz.dev/`, valid for 12 hours unless claimed. Claim from the editor's Open game dialog or with `npx blitz claim`.
- The legacy workers.dev path form `https://blitz-game-gateway.blitzapp.workers.dev/<slug>/` still works for unclaimed test games.
- You can open the project in the editor while the agent works, edit the scene or a script in the Inspector, and save. The agent's next `npx blitz publish` includes your edits, because both work on the same folder. Run `npx blitz checkpoint` before handing the folder to an agent and `npx blitz restore` to undo its work.
- `npx blitz doctor` checks Node, the version pin, installed packages, a free port, the backend, the runtime registry, and Playwright. `npx blitz status` shows the running dev server.
- The store at `https://blitz.dev/` lists claimed games only.
