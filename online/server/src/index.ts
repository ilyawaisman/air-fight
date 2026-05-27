import http from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { applyMove, createGame } from "../../shared/game/engine.js";
import { isPresetId } from "../../shared/game/presets.js";
import { randomSeed } from "../../shared/game/random.js";
import type { GameState, PresetId, Team } from "../../shared/game/types.js";
import type { ClientMessage, ServerMessage } from "../../shared/protocol.js";

interface Player {
  id: string;
  name: string;
  socket: WebSocket;
  gameId: string | null;
  team: Team | null;
}

interface Room {
  id: string;
  state: GameState;
  players: Record<Team, Player>;
}

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const CLIENT_DIST = path.resolve(process.cwd(), "dist/client");

export interface AirFightServer {
  server: http.Server;
  wss: WebSocketServer;
  close: () => Promise<void>;
}

export function createAirFightServer(): AirFightServer {
  const queues = new Map<PresetId, Player[]>();
  const rooms = new Map<string, Room>();
  const players = new Map<string, Player>();

  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    void serveStaticClient(req, res);
  });

  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket) => {
    const player: Player = {
      id: randomUUID(),
      name: "Player",
      socket,
      gameId: null,
      team: null,
    };
    players.set(player.id, player);
    send(player, { type: "hello", playerId: player.id });
    sendQueueStatus();

    socket.on("message", (raw) => {
      const message = parseClientMessage(raw.toString());
      if (!message) return;
      handleMessage(player, message);
    });

    socket.on("close", () => {
      removeFromQueues(player);
      leaveRoom(player);
      players.delete(player.id);
      sendQueueStatus();
    });
  });

  function handleMessage(player: Player, message: ClientMessage): void {
    if (message.type === "joinQueue") {
      if (!isPresetId(message.presetId)) return;
      player.name = cleanName(message.playerName);
      removeFromQueues(player);
      leaveRoom(player);
      enqueue(player, message.presetId);
      sendQueueStatus();
      return;
    }

    if (message.type === "leaveQueue") {
      removeFromQueues(player);
      leaveRoom(player);
      sendQueueStatus();
      return;
    }

    if (message.type === "submitMove") {
      const room = player.gameId ? rooms.get(player.gameId) : null;
      if (!room || room.id !== message.gameId || !player.team) return;
      const result = applyMove(room.state, player.team, message.move);
      room.state = result.state;
      if (!result.ok) {
        send(player, { type: "moveRejected", reason: result.error ?? "Move rejected.", state: room.state });
        return;
      }
      broadcast(room, { type: "gameState", state: room.state, eliminated: result.eliminated });
      return;
    }

    if (message.type === "chatMessage") {
      const room = player.gameId ? rooms.get(player.gameId) : null;
      if (!room || room.id !== message.gameId || !player.team) return;
      const text = cleanChatText(message.text);
      if (!text) return;
      broadcast(room, {
        type: "chatMessage",
        gameId: room.id,
        fromTeam: player.team,
        fromName: player.name,
        text,
      });
    }
  }

  function enqueue(player: Player, presetId: PresetId): void {
    const queue = queues.get(presetId) ?? [];
    queues.set(presetId, queue);

    const opponent = queue.shift();
    if (!opponent || opponent.socket.readyState !== opponent.socket.OPEN) {
      queue.push(player);
      send(player, { type: "queued", presetId });
      return;
    }

    const roomId = randomUUID();
    const state = createGame(roomId, presetId, randomSeed());
    player.team = "blue";
    opponent.team = "red";
    player.gameId = roomId;
    opponent.gameId = roomId;

    const room: Room = {
      id: roomId,
      state,
      players: { red: opponent, blue: player },
    };
    rooms.set(roomId, room);

    send(opponent, { type: "matchFound", gameId: roomId, team: "red", opponentName: player.name, state });
    send(player, { type: "matchFound", gameId: roomId, team: "blue", opponentName: opponent.name, state });
  }

  function leaveRoom(player: Player): void {
    if (!player.gameId) return;
    const room = rooms.get(player.gameId);
    if (!room) {
      player.gameId = null;
      player.team = null;
      return;
    }

    const opponent = player.team === "red" ? room.players.blue : room.players.red;
    send(opponent, { type: "opponentDisconnected", state: room.state });
    rooms.delete(room.id);
    player.gameId = null;
    player.team = null;
    opponent.gameId = null;
    opponent.team = null;
  }

  function removeFromQueues(player: Player): void {
    for (const [presetId, queue] of queues) {
      queues.set(presetId, queue.filter((queuedPlayer) => queuedPlayer.id !== player.id));
    }
  }

  function sendQueueStatus(): void {
    for (const player of players.values()) {
      send(player, { type: "queueStatus", counts: queueCountsFor(player) });
    }
  }

  function queueCountsFor(player: Player): Record<PresetId, number> {
    return {
      duel: queueCountFor("duel", player),
      classic: queueCountFor("classic", player),
      tactical: queueCountFor("tactical", player),
    };
  }

  function queueCountFor(presetId: PresetId, player: Player): number {
    return (queues.get(presetId) ?? []).filter((queuedPlayer) => queuedPlayer.id !== player.id).length;
  }

  function broadcast(room: Room, message: ServerMessage): void {
    send(room.players.red, message);
    send(room.players.blue, message);
  }

  return {
    server,
    wss,
    close: () => closeServer(server, wss),
  };
}

function send(player: Player, message: ServerMessage): void {
  if (player.socket.readyState === player.socket.OPEN) {
    player.socket.send(JSON.stringify(message));
  }
}

function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const message = JSON.parse(raw) as ClientMessage;
    return typeof message === "object" && message !== null && "type" in message ? message : null;
  } catch {
    return null;
  }
}

function cleanName(value: string): string {
  const trimmed = value.trim().slice(0, 24);
  return trimmed || "Player";
}

function cleanChatText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 180);
}

function closeServer(server: http.Server, wss: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    wss.clients.forEach((client) => client.close());
    wss.close((wssError) => {
      if (!server.listening) {
        if (wssError) reject(wssError);
        else resolve();
        return;
      }
      server.close((serverError) => {
        const error = wssError ?? serverError;
        if (error) reject(error);
        else resolve();
      });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { server } = createAirFightServer();
  server.listen(PORT, HOST, () => {
    console.log(`Air Fight Online server listening on http://${HOST}:${PORT}`);
  });
}

async function serveStaticClient(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!existsSync(CLIENT_DIST)) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Air Fight Online server\n");
    return;
  }

  const pathname = safePathname(req.url);
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(CLIENT_DIST, requestedPath);
  const indexPath = path.join(CLIENT_DIST, "index.html");
  const resolvedPath = await readableFilePath(filePath) ?? indexPath;

  if (!isInsideClientDist(resolvedPath)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found\n");
    return;
  }

  createReadStream(resolvedPath)
    .on("error", () => {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("Server error\n");
    })
    .pipe(res.writeHead(200, { "content-type": contentType(resolvedPath) }));
}

async function readableFilePath(filePath: string): Promise<string | null> {
  try {
    const resolved = path.resolve(filePath);
    if (!isInsideClientDist(resolved)) return null;
    const info = await stat(resolved);
    return info.isFile() ? resolved : null;
  } catch {
    return null;
  }
}

function isInsideClientDist(filePath: string): boolean {
  const relative = path.relative(CLIENT_DIST, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safePathname(url: string | undefined): string {
  try {
    return decodeURIComponent(new URL(url ?? "/", "http://localhost").pathname);
  } catch {
    return "/";
  }
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}
