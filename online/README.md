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
