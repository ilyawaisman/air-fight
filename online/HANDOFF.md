# Air Fight Online Handoff

This file captures the state needed to continue development on another machine.

## Current Git State

- Branch: `online`
- Scope of work: everything added so far lives under `online/`
- Original static game in the parent directory is intentionally untouched

## Current Architecture

- `shared/`: pure TypeScript game model, presets, deterministic RNG, and engine rules
- `server/`: Node.js WebSocket server with in-memory matchmaking queues and active rooms
- `client/`: Vite browser client with name/preset/play flow and canvas rendering
- `tests/`: Vitest unit tests for shared engine behavior and in-process WebSocket protocol coverage

## Matchmaking Presets

- Duel: `24x24`, `1` plane, `0` turrets, `any` obstacles
- Classic: `24x48`, `3` planes, `1` turret, `any` obstacles
- Tactical: `28x56`, `7` planes, `1` turret, `any` obstacles

## Important Design Decisions

- PvP is server-authoritative. Clients submit target grid points; the server validates and applies moves.
- The shared engine is pure TypeScript so client, server, and tests can all use the same rules.
- Obstacle generation is deterministic through a seed, which keeps both clients synchronized.
- The server currently stores queues and rooms in memory. That is fine for local dev and early testing, but persistence and horizontal scaling will need PostgreSQL/Redis later.
- PvC/local AI has not been reintroduced in the online client yet.

## Verified Commands

Run from `online/`:

```sh
npm.cmd install
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

On Windows PowerShell, prefer `npm.cmd` if `npm` is blocked by execution policy.

## Local Development

Run from `online/`:

```sh
npm.cmd run dev
```

Open two browser tabs at:

```text
http://localhost:5173
```

Use the same preset in both tabs to match them together. Server health is available at:

```text
http://localhost:3000/health
```

## Known Gaps

- Rendering is intentionally simpler than the original static game.
- No replay system yet.
- No local AI/PvC route in the online client yet.
- No account system, persistence, ratings, or reconnect/resume.
- No browser-driven end-to-end tests yet.
- npm reported moderate dependency advisories; they were not force-fixed because that may introduce breaking changes.

## Suggested Next Steps

1. Port more of the original canvas polish into the online client.
2. Add a local-vs-computer mode that uses the shared engine and a client-side AI.
3. Add room cleanup, idle timeouts, and better disconnect/reconnect handling.
4. Add more server protocol tests for disconnects, invalid messages, and queue cancellation.
5. Decide on first deployment target.

## Deployment Direction

For an early deployment, use one Node process serving the WebSocket server and separately host the Vite static client. Good simple options:

- Render/Fly.io/Railway for the Node WebSocket server
- Netlify/Vercel/Cloudflare Pages for the static client

Before real deployment, add environment-specific `VITE_WS_HOST` configuration for the client build.
