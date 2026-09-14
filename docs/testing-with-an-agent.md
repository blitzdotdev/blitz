# Testing Kite3D with another agent

The packages are on npm. Paste this to the other agent, substituting your own game idea if needed:

```
use npx kite3d and build me an FPS shooting practice game
Never print the deploy token or claim secret from .kite3d/deploys.json.
```

The CLI output carries the loop from project creation through reading `AGENTS.md`, running the editor, and inspecting the game. Bundled skills describe agent-owned procedures such as releasing it.

Outside a project, `npx kite3d` runs Kite3D.js, an unrelated package with the same bare name. Use `npx kite3d` for init. Inside a project, `npx kite3d` runs the local Kite3D command.

## Testing unreleased changes from this machine

To test a build of `main` that is not published yet, pack the three packages into local tarballs after each merge:

```sh
npm run build && rm -rf /Users/minjunes/kite3d-packs && mkdir -p /Users/minjunes/kite3d-packs && for p in engine editor kite3d; do npm pack --silent --pack-destination /Users/minjunes/kite3d-packs ./packages/$p; done
```

For an unreleased test, give the agent these local setup commands in place of the public package command:

```
node /Users/minjunes/blitz/packages/kite3d/dist/cli.js init fps-practice && cd fps-practice
npm install --no-save --ignore-scripts --install-links --cache /tmp/kite3d-npm-cache /Users/minjunes/kite3d-packs/*.tgz
(do not run a plain npm install; the file: pins resolve from the installed package versions)
```

What to expect today:

- The editor URL opens in your browser and shows the project in the upstream editor layout, with Play and Save Scene in the toolbar. Script saves by the agent hot-reload, including modules they import. The scene is a deterministic text glTF at `assets/main.scene.gltf` with an external `.bin`; the agent edits it with scripts, and generated content lives under Generator nodes.
- Before releasing, stop Play, save, reload the editor page, and inspect the result. Follow the bundled release skill and verify every public asset after activation.
- The live URL is `https://<slug>.app.blitz.dev/`, valid for 12 hours unless claimed. The private deploy record contains the claim URL.
- You can open the project in the editor while the agent works, edit the scene or a script in the Inspector, and save. Both work on the same folder.
- The store at `https://blitz.dev/` lists claimed games only.
