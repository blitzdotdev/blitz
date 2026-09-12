# Multiplayer on kite3d: proof of concept and proposal

Status: proof of concept in progress, started 2026-09-12. Nothing here ships to kite3d users yet.
This page is the map back to the POC. Read it before building the real version.

## Why

Published kite3d games are static bundles. A game that wants co-op today must run its own server
somewhere. Terminator (the first complete kite3d game) proved that with a WebSocket relay on the
host's own machine and a cloudflared tunnel. Players had to run two commands and paste a wss URL.
That is not a product.

The decision: free players get peer-to-peer play, and the platform pays only for the handshake.
Game developers can later opt into paid tiers (relay for strict NAT, hosted authoritative servers).

## What exists today (verified 2026-09-12)

- Hosting: game-gateway reads release metadata and streams content-addressed files. GET, HEAD, and
  OPTIONS only. No WebSocket, Durable Object, or Container anywhere on the platform.
- Publish manifest: file paths, hashes, sizes, MIME types. No server entry point.
- Identity: developer accounts exist. No billing, no per-game quotas, no player analytics.
- kite3d packages: no networking, lobby, room, or transport code.

## The POC (where to find it)

Two pieces, built against one written contract (below), so either side can be replaced.

1. Signaling service: one Cloudflare Worker `blitz-games-signal` with one Durable Object class
   `Room` (WebSocket Hibernation API, 10 minute idle expiry, 120 messages per peer per minute).
   Code: blitz-cloud repository, branch `poc/p2p-signaling`, folder `signaling/`, with a README,
   vitest suite, and `test/load.mjs` for 20, 100, and 300 concurrent rooms.
2. WebRTC transport in Terminator: `lib/net/signaling.js` (contract client) and `lib/net/webrtc.js`
   (star topology, host initiates, two data channels). Party screens create and join rooms by a
   six character code. The old relay stays behind `?relay=` for LAN use.
   Code: the Terminator game repository (`~/games/terminator`), branch `pass/webrtc`, then master.
   Design notes: `docs/coop-design.md`. Proof runs: `docs/evidence/`.

Live game: https://terminator.app.blitz.dev

## Signaling contract v0

Purpose: let browsers find each other by a room code and exchange WebRTC offers, answers, and ICE
candidates. After the peers connect, no game traffic crosses the server. The server keeps no game
state.

HTTP

| Route | Result |
|-------|--------|
| `POST /rooms` (body `{"capacity":3}` optional, 2 to 8) | `200 {"code":"ABC234","ttlSeconds":3600}` |
| `GET /rooms/<code>` | `200 {code, capacity, peers:[{peerId,name,role}], open}` or 404 |
| `GET /rooms/<code>/ws` | WebSocket upgrade. 404 unknown room, 409 full |
| `GET /health` | `200 {"ok":true,"version":"v0"}` |

Codes use A to Z and 2 to 9 without 0, O, 1, I. CORS allows any origin.

Client to server

| Message | Meaning |
|---------|---------|
| `{"type":"hello","role":"host"\|"guest","name":"Fighter"}` | first message, required |
| `{"type":"signal","to":"p2","data":{...}}` | data is opaque: `{sdp}` or `{candidate}` |
| `{"type":"ping"}` | keepalive, every 25 s |
| `{"type":"leave"}` | leave the room |

Server to client

| Message | Meaning |
|---------|---------|
| `{"type":"welcome","peerId","role","code","peers":[...]}` | peers already in the room |
| `{"type":"peer_joined","peer":{peerId,name,role}}` | to everyone else |
| `{"type":"peer_left","peerId"}` | to everyone else |
| `{"type":"signal","from","data"}` | relayed verbatim |
| `{"type":"pong"}` | keepalive reply |
| `{"type":"room_closed","reason":"host_left"\|"expired"}` | then the socket closes |
| `{"type":"error","code":"full"\|"bad_message"\|"unknown_peer"\|"host_exists"\|"rate_limited"}` | then the socket may close |

Rules: one host per room. The host leaving closes the room. Message size limit 64 KB.

Client decisions in the POC: star topology, host initiates on `peer_joined`, channels `reliable`
(ordered) for events and `state` (unordered, `maxRetransmits: 0`) for inputs and snapshots,
STUN only (`stun:stun.cloudflare.com:3478`), 15 s connect timeout with a visible message.

## Proposed developer experience (not built)

One package, `@kite3d/net`. No CLI command for P2P. The runtime knows the game slug from publish,
and rooms are scoped `<slug>/<code>`, so codes never collide across games and usage is metered per
game.

```js
import {hostRoom, joinRoom} from '@kite3d/net'

// host
const room = await hostRoom({capacity: 4})          // room.code is the invite
room.onPeer(peer => peer.onState(inputs => apply(peer.id, inputs)))
setInterval(() => room.broadcastState(world.snapshot()), 50)

// guest
const room = await joinRoom(code)
room.host.onState(snapshot => world.applySnapshot(snapshot))
room.host.sendState(inputs)
```

The package also carries the host-authoritative helper Terminator wrote by hand: snapshot at a
rate, inputs per tick, guest prediction hooks. The developer supplies `snapshot()`,
`applySnapshot()`, and `step(inputs)`.

Documentation lands as a "Multiplayer" page in this repository's docs and JSDoc on the package.

## Tiers and cost

| Tier | Who pays | Cost driver | Rough number |
|------|----------|-------------|--------------|
| P2P with platform signaling | platform | Durable Object requests and a few seconds of active time per match | about $4 per million matches |
| Relay for strict NAT | developer, opt in | relayed gigabytes (Cloudflare Realtime TURN with short-lived credentials) | per GB |
| Hosted authoritative server | developer, opt in | container CPU, memory, egress per room hour | cents per room hour, depends on rooms packed per container |

## Limits of the P2P tier

| Limit | Value | Why |
|-------|-------|-----|
| Room size | 2 to 8 | the host uploads one stream per guest |
| Connect success | about 85 to 95 percent | STUN only until the relay tier exists |
| Authority | the host browser | the host can cheat; fine for co-op, wrong for ranked play |
| Persistence | none | the room dies with the host tab |

Fits: co-op waves, small PvP among friends, turn based, party games. Does not fit: lobbies above
8, ranked or anti-cheat play, persistent worlds.

## What the real version needs

1. Scope rooms by game slug and issue short-lived host and guest tickets from the backend.
2. Move signaling behind the gateway (same origin as the game) or a fixed blitz.dev domain.
3. `@kite3d/net` package with the API above, tests, and the docs page.
4. Relay tier: backend endpoint that mints Realtime TURN credentials, per-game quotas.
5. Hosted tier: `server` field in the publish manifest, server bundle upload, match and lease
   routes, Containers behind the gateway, billing.
6. Abuse controls and metrics per game.

## Results so far (2026-09-12)

Signaling worker `blitz-games-signal`, deployed on the sandbox account, contract v0, 10 unit tests.

| Concurrent rooms (host plus two guests each, six signals per pair) | Completed | p50 | p95 | Errors |
|---|---:|---:|---:|---|
| 20 | 20 | 1.8 s | 2.6 s | none |
| 100 | 100 | 1.6 s | 2.8 s | none |
| 300 | 300 | 3.9 s | 6.1 s | none |
| 100 again | 100 | 2.9 s | 4.5 s | none |

Terminator through the deployed worker, three headless players on one machine: room creation
776 ms, guests connected in 627 ms and 601 ms, 60 inputs per second sent and 20 snapshots per
second received per guest, zero errors, all three reached the wave one intermission. The two
browser reliability harness (18 assertions: join, ready, start, pause, movement, reconnect, kills,
spectate, wipe, return to the same party, restart) passes over WebRTC.

Landed in the game as one squash commit; the WebSocket relay stays only behind `?relay=` for LAN.
Independent QA through the deployed worker (three headless players on one Mac, no stub):

| Alive enemies | Host step p99 | Snapshot bytes p99 | Snapshots per s per guest | Inputs per s | Loss | Remote position error |
|---:|---:|---:|---:|---:|---:|---:|
| 12 | 1.7 ms | 28.7 KB | 19.9 | 60.0 | 0 | 0.30 m |
| 24 | 2.2 ms | 40.2 KB | 19.9 | 60.0 | 0 | 0.33 m |
| 36 | 2.7 ms | 48.9 KB | 20.0 | 60.0 | 0 | 0.31 m |

Also in that run: a guest dropped and rejoined twice in under 0.6 s keeping its player; 30 rooms
and 90 fake peers churned on the signaling service during the match with zero errors; the party
wiped, returned to the same code, and restarted. Two limits found: JSON snapshots reach 49 KB at
36 enemies against a 64 KiB data channel message ceiling (binary encoding is the fix), and the
host uploads about 185 KB per second per guest, which is heavy for home connections at three players.

## Open questions

- Room codes: global or per game in the URL (`?party=ABC234` versus `?party=terminator/ABC234`)?
- Should the platform absorb relay traffic for small games and meter only above a threshold?
- Binary snapshot encoding in the package, or leave it to the game?
- Reconnect: the POC has none. Which tier owns it?

## Revisit checklist

1. Read the signaling README on the `poc/p2p-signaling` branch of blitz-cloud for the load numbers.
2. Read Terminator's `docs/coop-design.md` and `lib/net/` for the transport.
3. Run Terminator's three-player headless proof (`npm run e2e:webrtc` and the co-op e2e script).
4. Decide the open questions above, then design `@kite3d/net`.
