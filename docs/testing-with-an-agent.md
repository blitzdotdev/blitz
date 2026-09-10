# Testing Blitz with another agent, before npm publish

The packages are not on npm yet. Another agent on this machine installs them from local tarballs. Rebuild the tarballs after each merge to `main`:

```sh
npm run build && rm -rf /Users/minjunes/blitz-packs && mkdir -p /Users/minjunes/blitz-packs && for p in engine editor blitz template; do npm pack --silent --pack-destination /Users/minjunes/blitz-packs ./packages/$p; done
```

Paste this to the other agent, with your own game idea in the first line:

```
Build me an FPS shooting practice game with Blitz.

Setup, on this machine:
1. mkdir -p ~/blitz-games && cd ~/blitz-games
2. node /Users/minjunes/blitz/packages/blitz/dist/cli.js init fps-practice && cd fps-practice
3. npm install --save-dev --ignore-scripts --install-links --cache /tmp/blitz-npm-cache /Users/minjunes/blitz-packs/*.tgz
   (the packages are not on npm yet; do not run a plain npm install; the resulting file: pins are accepted and resolved from the installed package versions)
4. Read AGENTS.md in the project. It is the guide. The engine and editor source are in node_modules, grep them when unsure.
5. Start the editor: npx blitz dev --no-open, and tell me the URL it prints. Keep it running.
6. Build the game in this folder: scripts, assets, package.json. The editor reloads scripts when you save them.
7. When it plays, run npx blitz check and fix every failure. Then publish it with npx blitz publish. Tell me the live URL.
Never print the deploy token or claim secret from .blitz/deploys.json.
```

What to expect today:

- The editor URL opens in your browser and shows the project in the upstream editor layout, with Play, Check, Checkpoint, and Open game at the top right. Script saves by the agent hot-reload, including modules they import. The scene is a deterministic text glTF at `assets/main.scene.gltf` with an external `.bin`; the agent edits it with scripts, and generated content lives under Generator nodes.
- `npx blitz check` is the required step before publish. It resolves scripts, plugins, and generators, then reports Playable, Editable, and Persisted, headless or through the open editor. Results go to `.blitz/check.json` and `.blitz/console.log`. Publish repeats the check unless `--no-check` is supplied, refuses while the editor is playing or has an unsaved draft, and verifies every public asset after release.
- The live URL is `https://blitz-game-gateway.blitzapp.workers.dev/<slug>/`, valid for 12 hours unless claimed. Claim from the editor's Open game dialog or with `npx blitz claim`.
- You can open the project in the editor while the agent works, edit the scene or a script in the Inspector, and save. The agent's next `npx blitz publish` includes your edits, because both work on the same folder. Run `npx blitz checkpoint` before handing the folder to an agent and `npx blitz restore` to undo its work.
- `npx blitz doctor` checks Node, the version pin, installed packages, a free port, the backend, the runtime registry, and Playwright. `npx blitz status` shows the running dev server.
- Known gaps: the store at `https://blitz-backend.blitzapp.workers.dev/` lists claimed games only, and `<game>.app.blitz.dev` waits for the domain cutover.
