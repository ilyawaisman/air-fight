import "../src/styles.css";
import { activeToken, legalMoves } from "../../shared/game/engine.js";
import { GAME_PRESETS, isPresetId } from "../../shared/game/presets.js";
import type { GameState, Move, PresetId, Team } from "../../shared/game/types.js";
import type { ClientMessage, ServerMessage } from "../../shared/protocol.js";

const canvas = document.querySelector<HTMLCanvasElement>("#board")!;
const ctx = canvas.getContext("2d")!;
const joinForm = document.querySelector<HTMLFormElement>("#joinForm")!;
const playerName = document.querySelector<HTMLInputElement>("#playerName")!;
const playButton = document.querySelector<HTMLButtonElement>("#playButton")!;
const leaveButton = document.querySelector<HTMLButtonElement>("#leaveButton")!;
const connectionLabel = document.querySelector("#connectionLabel")!;
const matchLabel = document.querySelector("#matchLabel")!;
const teamLabel = document.querySelector("#teamLabel")!;
const messageLabel = document.querySelector("#messageLabel")!;

let socket: WebSocket | null = null;
let reconnectTimer = 0;
let state: GameState | null = null;
let myTeam: Team | null = null;
let gameId: string | null = null;
let highlightedMoves: Move[] = [];

connect();
draw();

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const presetId = new FormData(joinForm).get("presetId");
  if (typeof presetId !== "string" || !isPresetId(presetId)) return;
  send({ type: "joinQueue", playerName: playerName.value, presetId });
  matchLabel.textContent = `Queueing for ${GAME_PRESETS[presetId].label}`;
  messageLabel.textContent = "Waiting for one more player.";
  playButton.disabled = true;
  leaveButton.disabled = false;
});

leaveButton.addEventListener("click", () => {
  send({ type: "leaveQueue" });
  matchLabel.textContent = "Not queued";
  messageLabel.textContent = "Queue left.";
  playButton.disabled = false;
  leaveButton.disabled = true;
});

canvas.addEventListener("click", (event) => {
  if (!state || !gameId || !myTeam || state.turn !== myTeam || state.gameOver) return;
  const point = eventToGrid(event);
  const move = highlightedMoves.find((candidate) => candidate.x === point.x && candidate.y === point.y);
  if (!move) {
    messageLabel.textContent = "Choose one highlighted point.";
    return;
  }
  send({ type: "submitMove", gameId, move: { x: move.x, y: move.y } });
});

function connect(): void {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = import.meta.env.VITE_WS_HOST ?? `${window.location.hostname}:3000`;
  socket = new WebSocket(`${protocol}//${host}/ws`);
  connectionLabel.textContent = "Connecting";

  socket.addEventListener("open", () => {
    connectionLabel.textContent = "Connected";
  });

  socket.addEventListener("message", (event) => {
    handleServerMessage(JSON.parse(event.data as string) as ServerMessage);
  });

  socket.addEventListener("close", () => {
    connectionLabel.textContent = "Disconnected";
    playButton.disabled = false;
    leaveButton.disabled = true;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connect, 1200);
  });
}

function handleServerMessage(message: ServerMessage): void {
  if (message.type === "queued") {
    matchLabel.textContent = `Queued for ${GAME_PRESETS[message.presetId].label}`;
    return;
  }

  if (message.type === "matchFound") {
    state = message.state;
    myTeam = message.team;
    gameId = message.gameId;
    matchLabel.textContent = `Vs ${message.opponentName}`;
    teamLabel.textContent = message.team === "red" ? "Red" : "Blue";
    leaveButton.disabled = true;
    updateTurnMessage();
    updateHighlights();
    draw();
    return;
  }

  if (message.type === "gameState") {
    state = message.state;
    updateTurnMessage();
    updateHighlights();
    draw();
    return;
  }

  if (message.type === "moveRejected") {
    state = message.state;
    messageLabel.textContent = message.reason;
    updateHighlights();
    draw();
    return;
  }

  if (message.type === "opponentDisconnected") {
    if (message.state) state = message.state;
    matchLabel.textContent = "Opponent left";
    messageLabel.textContent = "The opponent disconnected. Start a new queue when ready.";
    playButton.disabled = false;
    leaveButton.disabled = true;
    updateHighlights();
    draw();
  }
}

function updateTurnMessage(): void {
  if (!state) return;
  if (state.gameOver) {
    messageLabel.textContent = state.winner === "draw" ? "Draw." : `${labelTeam(state.winner)} wins.`;
    playButton.disabled = false;
    return;
  }
  messageLabel.textContent = state.turn === myTeam ? "Your turn. Choose a highlighted point." : "Opponent's turn.";
}

function updateHighlights(): void {
  highlightedMoves = [];
  if (!state || state.gameOver || state.turn !== myTeam) return;
  const token = activeToken(state);
  if (token?.team === myTeam) highlightedMoves = legalMoves(state, token);
}

function draw(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!state) {
    drawEmptyBoard();
    return;
  }

  const geo = boardGeometry();
  drawPaper(geo);
  drawObstacles(geo);
  drawTrajectories(geo);
  drawHighlights(geo);
  drawTokens(geo);
}

function drawEmptyBoard(): void {
  ctx.fillStyle = "#f8fbff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#66758a";
  ctx.font = "24px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("Waiting for match", canvas.width / 2, canvas.height / 2);
}

function boardGeometry() {
  const margin = 42;
  const width = state?.width ?? 24;
  const height = state?.height ?? 24;
  const cell = Math.min((canvas.width - margin * 2) / width, (canvas.height - margin * 2) / height);
  const left = (canvas.width - width * cell) / 2;
  const top = (canvas.height - height * cell) / 2;
  return { width, height, cell, left, top };
}

function drawPaper(geo: ReturnType<typeof boardGeometry>): void {
  ctx.fillStyle = "#f8fbff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#c7d8eb";
  ctx.lineWidth = 1;
  for (let x = 0; x <= geo.width; x += 1) {
    const px = geo.left + x * geo.cell;
    ctx.beginPath();
    ctx.moveTo(px, geo.top);
    ctx.lineTo(px, geo.top + geo.height * geo.cell);
    ctx.stroke();
  }
  for (let y = 0; y <= geo.height; y += 1) {
    const py = geo.top + y * geo.cell;
    ctx.beginPath();
    ctx.moveTo(geo.left, py);
    ctx.lineTo(geo.left + geo.width * geo.cell, py);
    ctx.stroke();
  }
  ctx.strokeStyle = "#8fb1d7";
  ctx.lineWidth = 2;
  ctx.strokeRect(geo.left, geo.top, geo.width * geo.cell, geo.height * geo.cell);
}

function drawObstacles(geo: ReturnType<typeof boardGeometry>): void {
  if (!state) return;
  ctx.fillStyle = "rgba(23, 32, 51, 0.14)";
  ctx.strokeStyle = "rgba(23, 32, 51, 0.28)";
  for (const key of state.obstacles) {
    const [cx, cy] = key.split(",").map(Number);
    const x = geo.left + (cx ?? 0) * geo.cell;
    const y = geo.top + (cy ?? 0) * geo.cell;
    ctx.fillRect(x, y, geo.cell, geo.cell);
    ctx.beginPath();
    ctx.moveTo(x, y + geo.cell);
    ctx.lineTo(x + geo.cell, y);
    ctx.stroke();
  }
}

function drawTrajectories(geo: ReturnType<typeof boardGeometry>): void {
  if (!state) return;
  for (const token of state.tokens) {
    if (token.type !== "plane" || token.history.length < 2) continue;
    ctx.strokeStyle = token.team === "red" ? "rgba(212,61,61,0.45)" : "rgba(37,99,199,0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    token.history.forEach((point, index) => {
      const p = gridToPixel(point, geo);
      if (index === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  }
}

function drawHighlights(geo: ReturnType<typeof boardGeometry>): void {
  ctx.fillStyle = "rgba(47, 133, 90, 0.22)";
  ctx.strokeStyle = "rgba(47, 133, 90, 0.75)";
  ctx.lineWidth = 2;
  for (const move of highlightedMoves) {
    const p = gridToPixel(move, geo);
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(6, geo.cell * 0.22), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawTokens(geo: ReturnType<typeof boardGeometry>): void {
  if (!state) return;
  for (const token of state.tokens) {
    if (!token.alive) continue;
    const p = gridToPixel(token, geo);
    ctx.fillStyle = token.team === "red" ? "#d43d3d" : "#2563c7";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    if (token.type === "plane") {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - geo.cell * 0.36);
      ctx.lineTo(p.x + geo.cell * 0.28, p.y + geo.cell * 0.28);
      ctx.lineTo(p.x, p.y + geo.cell * 0.14);
      ctx.lineTo(p.x - geo.cell * 0.28, p.y + geo.cell * 0.28);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(7, geo.cell * 0.28), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

function eventToGrid(event: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const geo = boardGeometry();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  return {
    x: Math.round((x - geo.left) / geo.cell),
    y: Math.round((y - geo.top) / geo.cell),
  };
}

function gridToPixel(point: { x: number; y: number }, geo: ReturnType<typeof boardGeometry>): { x: number; y: number } {
  return {
    x: geo.left + point.x * geo.cell,
    y: geo.top + point.y * geo.cell,
  };
}

function send(message: ClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function labelTeam(team: Team | "draw" | null): string {
  if (team === "red") return "Red";
  if (team === "blue") return "Blue";
  return "Nobody";
}
