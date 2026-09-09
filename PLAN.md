# Blitz games

Goal - maximally accessible game development and distribution with AI. anyone with any AI connected to internet should be able to prompt "build me a game X using blitz" and the agent should read blitz.dev/agents.md and build a complete blitz game in the user's local filesystem, (follow the AGENTS.md guidelien in threepipe-blueprint-editor/src/data/AgentsMdTemplate.md) with blitz.dev acting as a client game editor. on the top-right corner of the editor, there should be a "open game" button that when pressed, loads an <game>.app.blitz.dev teenybase app running the deployed version of the game via a canonical createGame() method. <game>.app.blitz.dev should be accessible to any anon user who creates a project without acc - however the app will be expire in 12 hours unless they create an account at blitz.dev. there should be API to commit/deploy the game state to the <game>.appl.blitz.dev app (all src and assets should be saved in R2, D1 for game auth / economy /etc additional logic). Since the project source is just a git repo, agents should be aable to develop different versions of the game in parallel and deploy them to their respective <game-some-version>.app.blitz.dev without account creation (same 12 hr expiry applies) so the user can rapidly "checkout" new game versions. the anon game app creation and expiry system, and blitz.dev platform backend code should copy teenyapp.com in ~/superapp/teenybase/backend (with exceptions maybe optimized for game hosting, please note what these exceptions are).

# Plan

## Project source of truth

NOW

In dir in user's local filesys. Use chrome file system access API to watch and update files. Editor scene graph updates write directly to the filesystem. On change:  
- scripts -> auto-reload 
- settings/asset-map -> re-read and apply
- Scene-file -> reload the changed file 
- Assets -> refetch the entry and reload bytes on next use 
- The editor's own writes -> ignore the echo by comparing the version it just wrote.

Rm indexDB

Add the kite3d engine version in manifest. Detect and load an editor per engine version, so there is no editor and project mismatch causing errors. 

What about human actions in editor? 
- record actions in a journal log, use this do undo/redo  
- keep the in memory undo stack for speed? 

## main.scene.glb to gltf 

NOW

If there is a deserialized version of the main.scene.glb, just save that and allow agents to directly edit that gltf file. Agent shouldn't need API protocol to update the scene graph.

## Runtime state controller  

DEFER  

one createGame() function (instead of the three seperate places where game plays right now) should return a game handler, from here player input can be scripted. Also tick based system for scripted game stepping.  

```
kite.player
kite.test
```
unclear 

## Agent connection 

DEFER  

Websocket from open page. Give agent a small CLI that runs the websocket server?  
- Can agent socket be used?

## Publishing  

NOW

automatically create playable link in <game>.app.blitz.dev -- expires in 12 hours unless user signs up. project files uploaded to existing d1 + r2.
