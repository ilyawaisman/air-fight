import http from "node:http";
import { randomUUID } from "node:crypto";
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
const queues = new Map<PresetId, Player[]>();
const rooms = new Map<string, Room>();
const players = new Map<string, Player>();

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Air Fight Online server\n");
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

  socket.on("message", (raw) => {
    const message = parseClientMessage(raw.toString());
    if (!message) return;
    handleMessage(player, message);
  });

  socket.on("close", () => {
    removeFromQueues(player);
    leaveRoom(player);
    players.delete(player.id);
  });
});

server.listen(PORT, () => {
  console.log(`Air Fight Online server listening on http://localhost:${PORT}`);
});

function handleMessage(player: Player, message: ClientMessage): void {
  if (message.type === "joinQueue") {
    if (!isPresetId(message.presetId)) return;
    player.name = cleanName(message.playerName);
    removeFromQueues(player);
    leaveRoom(player);
    enqueue(player, message.presetId);
    return;
  }

  if (message.type === "leaveQueue") {
    removeFromQueues(player);
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

function broadcast(room: Room, message: ServerMessage): void {
  send(room.players.red, message);
  send(room.players.blue, message);
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
