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
7. When it plays, publish it: npx blitz publish. Tell me the live URL.
Never print the deploy token or claim secret from .blitz/deploys.json.
```

What to expect today:

- The editor URL opens in your browser and shows the project. Script saves by the agent hot-reload. The scene is a text glTF at `assets/main.scene.gltf`; the agent can edit it with scripts, and C2a is making that file deterministic with external buffers.
- The live URL is `https://blitz-game-gateway.blitzapp.workers.dev/<slug>/`, valid for 12 hours unless claimed. Claiming from the editor arrives with C2b; until then the agent can claim through the API in `docs/publish-api.md`.
- You can open the project in the editor while the agent works, edit, and save. The agent's next `npx blitz publish` includes your edits, because both work on the same folder.
- Known gaps: no publish dialog in the editor yet, `blitz publish --help` and `--slug` land with C2b, and the store at `https://blitz-backend.blitzapp.workers.dev/` lists claimed games only.
