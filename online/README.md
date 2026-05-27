# Air Fight Online

Online multiplayer version of Air Fight. The original static game in the parent directory is treated as a reference; this project separates shared game rules, browser client, and Node.js server.

## Development

```sh
npm install
npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:3000
- WebSocket endpoint: `ws://localhost:3000/ws`

## Testing

```sh
npm test
npm run typecheck
```

The shared engine is intentionally pure TypeScript so rules can be unit-tested without a browser or server.

## Production

```sh
npm run build
npm start
```

The production server listens on `PORT` (`3000` by default), serves the built client from `dist/client`, and exposes the WebSocket endpoint at `/ws`.

## Fly.io

This project is prepared for a single-machine Fly.io deploy:

```sh
fly launch --no-deploy
fly deploy
```

Before the first deploy, make sure the app name in `fly.toml` is available or let `fly launch` rewrite it. Keep one Machine for now because queues and active rooms are stored in memory.
