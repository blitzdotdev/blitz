# Testing Blitz with another agent

The packages are on npm. Paste this to the other agent, with your own game idea in the first line:

```
Build me an FPS shooting practice game with Blitz.

Setup:
1. mkdir -p ~/blitz-games && cd ~/blitz-games
2. npx @blitzdev/blitz init fps-practice && cd fps-practice && npm install
3. Read AGENTS.md in the project. It is the guide. The engine and editor source are in node_modules, grep them when unsure.
4. Start the editor: npx blitz dev --no-open, and tell me the URL it prints. Keep it running.
5. Build the game in this folder: scripts, assets, package.json. The editor reloads scripts when you save them.
6. When it plays, run npx blitz check and fix every failure. Then publish it with npx blitz publish. Tell me the live URL.
Never print the deploy token or claim secret from .blitz/deploys.json.
```

Outside a project, `npx blitz` runs Blitz.js, an unrelated package with the same bare name. Use `npx @blitzdev/blitz` for init. Inside a project, `npx blitz` runs the local Blitz command.

## Testing unreleased changes from this machine

To test a build of `main` that is not published yet, pack the four packages into local tarballs after each merge:

```sh
npm run build && rm -rf /Users/minjunes/blitz-packs && mkdir -p /Users/minjunes/blitz-packs && for p in engine editor blitz template; do npm pack --silent --pack-destination /Users/minjunes/blitz-packs ./packages/$p; done
```

Then replace step 2 of the paste block with these two lines:

```
2. node /Users/minjunes/blitz/packages/blitz/dist/cli.js init fps-practice && cd fps-practice
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
