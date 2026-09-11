# blitz.dev storefront plan

Date: 2026-09-09, evening. Status: plan, approved direction. blitz.dev is the distribution channel for published games. Consumer facing. Dead simple for now.

## Domain map after cutover

| Host | Serves | Worker |
|---|---|---|
| `blitz.dev` | the store: all published games, plus `/api/*` and `/agents.md` | `blitz-backend` |
| `<slug>.app.blitz.dev` | one game | `blitz-game-gateway` |

The editor runs only from `kite3d dev` on localhost. There is no hosted editor.

## The store page

- `GET /` renders a grid of games, newest release first. Each card: thumbnail, name, author, one Play button that opens `https://<slug>.app.blitz.dev/`.
- A search box filters the loaded list in the browser. No accounts on the page. A small "Sign in" link goes to the claim and my-games pages.
- Server-rendered from D1 in the backend worker, cached at the edge for 60 seconds. No client framework.
- `GET /api/v1/games` returns the same list as JSON, paginated, for future clients.
- `GET /agents.md` and `GET /llms.txt` are served here. That is the canonical agents URL.

## What is listed

- A game is listed when it has an active release, its owner is an account, and `listed` is true. `listed` defaults to true when a game is claimed.
- Anonymous games are playable by link and never listed. This keeps the store free of spam and of expired links.
- The owner can unlist a game with `PATCH /api/v1/games/:id {listed: false}`.

## Data

- New columns: `games.listed INTEGER NOT NULL DEFAULT 1`, `games.description TEXT`. Description comes from `package.json` at publish.
- Thumbnail: a release file named `thumbnail.png`, served by the gateway. `kite3d publish` copies the editor's main scene thumbnail from `.kite3d/thumbs/` into the release when present, else `icon.svg` from the template. The card falls back to a placeholder.
- Author: the owner's username.
- Ordering: by the active release's `created_at`.

## Later, not now

Categories, likes, play counts, comments, featured rows, moderation queue, reports. Ship the grid first.

## Phase

**D. Storefront.** Backend only: columns and migration, the two routes, the list query with the listed rule, the `PATCH` unlist, thumbnail in the release convention, `agents.md` served from the backend, edge cache. Tests: listed rule, unlist, pagination, cache headers. Deploy to workers.dev, then the same worker takes `blitz.dev` at cutover. Runs in parallel with C1, since C1 touches the editor and the new `kite3d` package, not the backend.
