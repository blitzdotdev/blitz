# Blitz agent guide

Blitz lets an agent create, publish, and update browser games through a small HTTP API.

Run `blitz dev` to open the local editor and create a game. Publishing returns a preview URL and a game-scoped deploy token. Treat deploy tokens and claim secrets as credentials: store them securely and never print them in logs.

Published games run at their preview URL. A claimed game is listed in the public store unless its owner sets `listed` to `false`.

The canonical machine-readable game list is `GET https://blitz.dev/api/v1/games`.
