# Notes

- In this project, we are building Blitz - An advanced web based game engine using threepipe, three.js for rendering, entity component framework and other utility.
- The game engine has a User Interface(UI) editor to design scenes, setup objects and components visually.
- `threepipe` is a three.js framework, API is similar to vanilla three.js with js/ts.
- Users write custom components to add game-specific behavior to objects in the scene.
- The components extend from `Object3DComponent` class from threepipe and are attached to objects using the UI editor. These components are present as `.script.js` or `.script.ts` files in the game folder.
- These components have lifecycle methods like `start()`, `stop()`, `update()`, and `preFrame()` to manage behavior, as well as StateProperties for serialized primitive properties that can be configured via UI.
- `EntityComponentPlugin` from threepipe is used to manage components on objects in the scene. When in doubt check the source code in `node_modules/threepipe/src`.
- The game developer is expected to write scripts manually or using agenetic coding tools to create full-featured game components and systems. Many users prefer to use local AI in their IDE like copilot, claude code etc.
- Game editor UI is built using React, Blueprint.js 5, and uiconfig.js. It has many custom styles and overrides the blueprint default theme heavily.
- After doing the task, do NOT explain all the changes in a summary.
- Do not create extra markdown files unless necessary
