import "../src/styles.css";
import { activeToken, applyMove, cloneState, createGame, createGameFromPreset, legalMoves } from "../../shared/game/engine.js";
import { GAME_PRESETS, isPresetId } from "../../shared/game/presets.js";
import type { GamePreset, GameState, Metric, Move, ObstacleType, PresetId, Team, Token } from "../../shared/game/types.js";
import type { ClientMessage, ServerMessage } from "../../shared/protocol.js";

type PlayMode = "computer" | "local" | "network";

const canvas = document.querySelector<HTMLCanvasElement>("#board")!;
const ctx = canvas.getContext("2d")!;

const controls = {
  mode: document.getElementsByName("playMode") as NodeListOf<HTMLInputElement>,
  width: document.querySelector<HTMLInputElement>("#fieldWidth")!,
  height: document.querySelector<HTMLInputElement>("#fieldHeight")!,
  planes: document.querySelector<HTMLSelectElement>("#planeCount")!,
  turrets: document.querySelector<HTMLSelectElement>("#turretCount")!,
  obstacles: document.querySelector<HTMLSelectElement>("#obstacles")!,
  metric: document.querySelector<HTMLSelectElement>("#metric")!,
  playerName: document.querySelector<HTMLInputElement>("#playerName")!,
  mapOption: document.getElementsByName("mapOption") as NodeListOf<HTMLInputElement>,
  networkPreset: document.getElementsByName("networkPreset") as NodeListOf<HTMLInputElement>,
  newGame: document.querySelectorAll<HTMLButtonElement>(".new-game-btn"),
  replay: document.querySelectorAll<HTMLButtonElement>(".replay-btn"),
  speed: document.querySelectorAll<HTMLButtonElement>(".speed-btn"),
  leaveQueue: document.querySelector<HTMLButtonElement>("#leaveQueue")!,
  presetButtons: document.querySelectorAll<HTMLButtonElement>(".preset-btn"),
  networkOnly: document.querySelectorAll<HTMLElement>(".network-only"),
  localOnly: document.querySelectorAll<HTMLElement>(".local-only"),
};

const labels = {
  mode: document.querySelector<HTMLElement>("#modeLabel")!,
  turn: document.querySelector<HTMLElement>("#turnLabel")!,
  moving: document.querySelector<HTMLElement>("#moveLabel")!,
  velocity: document.querySelector<HTMLElement>("#velocityLabel")!,
  redAlive: document.querySelector<HTMLElement>("#redAlive")!,
  blueAlive: document.querySelector<HTMLElement>("#blueAlive")!,
  message: document.querySelector<HTMLElement>("#message")!,
  mobileRedStats: document.querySelector<HTMLElement>("#mobileRedStats")!,
  mobileBlueStats: document.querySelector<HTMLElement>("#mobileBlueStats")!,
};

const endGame = {
  container: document.querySelector<HTMLElement>("#boardContainer")!,
  overlay: document.querySelector<HTMLElement>("#endGameOverlay")!,
  overlayTitle: document.querySelector<HTMLElement>("#overlayTitle")!,
  banner: document.querySelector<HTMLElement>("#endGameBanner")!,
  bannerText: document.querySelector<HTMLElement>("#bannerText")!,
};

const TEAM = {
  red: { color: "#d43d3d", pale: "rgba(212, 61, 61, 0.2)", name: "Red" },
  blue: { color: "#2563c7", pale: "rgba(37, 99, 199, 0.2)", name: "Blue" },
} satisfies Record<Team, { color: string; pale: string; name: string }>;

const KEY_MAP = {
  KeyQ: { dx: -1, dy: 1, char: "Q" },
  KeyW: { dx: 0, dy: 1, char: "W" },
  KeyE: { dx: 1, dy: 1, char: "E" },
  KeyA: { dx: -1, dy: 0, char: "A" },
  KeyS: { dx: 0, dy: 0, char: "S" },
  KeyD: { dx: 1, dy: 0, char: "D" },
  KeyZ: { dx: -1, dy: -1, char: "Z" },
  KeyX: { dx: 0, dy: -1, char: "X" },
  KeyC: { dx: 1, dy: -1, char: "C" },
};

const REPLAY_SPEEDS = [1, 2, 4, 8] as const;
const REPLAY_STEP_MS = 520;

let mode: PlayMode = "computer";
let selectedPreset: PresetId = "classic";
let state: GameState | null = null;
let socket: WebSocket | null = null;
let reconnectTimer = 0;
let aiTimer = 0;
let gameId: string | null = null;
let myTeam: Team | null = null;
let highlightedMoves: Move[] = [];
let history: GameState[] = [];
let replaying = false;
let replayTimer = 0;
let speedIndex = 0;

applyModeUi();
startLocalGame();
connect();
bindControls();
draw();

function bindControls(): void {
  controls.mode.forEach((input) => {
    input.addEventListener("change", () => {
      stopReplay();
      mode = selectedMode();
      applyModeUi();
      if (mode === "network") {
        resetNetworkGame();
        labels.message.textContent = "Choose New to queue for an online game.";
      } else {
        startLocalGame();
      }
    });
  });

  controls.presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.w) controls.width.value = button.dataset.w;
      if (button.dataset.h) controls.height.value = button.dataset.h;
      selectedPreset = presetFromControls();
    });
  });

  controls.planes.addEventListener("change", () => {
    selectedPreset = presetFromControls();
  });
  controls.turrets.addEventListener("change", () => {
    selectedPreset = presetFromControls();
  });

  controls.newGame.forEach((button) => {
    button.addEventListener("click", () => {
      stopReplay();
      if (mode === "network") joinQueue();
      else startLocalGame();
    });
  });

  controls.leaveQueue.addEventListener("click", () => {
    stopReplay();
    send({ type: "leaveQueue" });
    controls.leaveQueue.disabled = true;
    labels.message.textContent = "Queue left.";
  });

  canvas.addEventListener("click", (event) => {
    if (replaying) return;
    const move = highlightedMoves.find((candidate) => {
      const point = eventToGrid(event);
      return candidate.x === point.x && candidate.y === point.y;
    });
    if (!move) {
      labels.message.textContent = "Choose one of the highlighted points.";
      return;
    }
    submitMove(move);
  });

  document.addEventListener("keydown", (event) => {
    if (replaying) return;
    const target = event.target;
    if (target instanceof HTMLSelectElement) return;
    if (target instanceof HTMLInputElement && (target.type === "text" || target.type === "number")) return;
    const key = KEY_MAP[event.code as keyof typeof KEY_MAP];
    if (!key || !state) return;
    const token = activeToken(state);
    if (!token) return;
    const anchor = token.type === "plane" ? { x: token.x + token.vx, y: token.y + token.vy } : token;
    const move = highlightedMoves.find((candidate) => candidate.x === anchor.x + key.dx && candidate.y === anchor.y + key.dy);
    if (!move) return;
    event.preventDefault();
    submitMove(move);
  });

  controls.replay.forEach((button) => {
    button.addEventListener("click", () => {
      if (replaying) stopReplay();
      else startReplay();
    });
  });

  controls.speed.forEach((button) => {
    button.addEventListener("click", () => {
      speedIndex = (speedIndex + 1) % REPLAY_SPEEDS.length;
      updateReplayControls();
    });
  });

  const toggleSettings = document.querySelector<HTMLButtonElement>("#toggleSettings");
  const closeSettings = document.querySelector<HTMLButtonElement>("#closeSettings");
  const backdrop = document.querySelector<HTMLElement>("#settingsBackdrop");
  const panel = document.querySelector<HTMLElement>(".control-panel");
  const closePanel = () => {
    panel?.classList.remove("open");
    backdrop?.classList.remove("active");
  };
  toggleSettings?.addEventListener("click", () => {
    panel?.classList.add("open");
    backdrop?.classList.add("active");
  });
  closeSettings?.addEventListener("click", closePanel);
  backdrop?.addEventListener("click", closePanel);
}

function selectedMode(): PlayMode {
  const value = Array.from(controls.mode).find((input) => input.checked)?.value;
  return value === "local" || value === "network" ? value : "computer";
}

function applyModeUi(): void {
  labels.mode.textContent = mode === "computer" ? "Computer" : mode === "local" ? "Hot Seat" : "Network";
  controls.networkOnly.forEach((element) => {
    element.classList.toggle("is-hidden", mode !== "network");
  });
  controls.localOnly.forEach((element) => {
    element.classList.toggle("is-hidden", mode === "network");
  });
  controls.newGame.forEach((button) => {
    button.textContent = mode === "network" ? "Queue" : "New";
  });
  controls.leaveQueue.disabled = true;
  updateReplayControls();
}

function syncPresetControls(presetId: PresetId): void {
  const preset = GAME_PRESETS[presetId];
  controls.width.value = String(preset.width);
  controls.height.value = String(preset.height);
  controls.planes.value = String(preset.planes);
  controls.turrets.value = String(preset.turrets);
}

function presetFromControls(): PresetId {
  const width = Number(controls.width.value);
  const height = Number(controls.height.value);
  const planes = Number(controls.planes.value);
  const turrets = Number(controls.turrets.value);
  if (width === 24 && height === 24 && planes === 1 && turrets === 0) return "duel";
  if (width === 28 && height === 56 && planes === 7 && turrets === 1) return "tactical";
  return "classic";
}

function localPresetFromControls(): GamePreset {
  return {
    id: presetFromControls(),
    label: "Custom",
    width: clamp(Number(controls.width.value) || 24, 12, 80),
    height: clamp(Number(controls.height.value) || 48, 16, 96),
    planes: clamp(Number(controls.planes.value) || 3, 1, 7),
    turrets: clamp(Number(controls.turrets.value) || 1, 0, 2),
    obstacles: obstacleTypeFromControls(),
    metric: metricFromControls(),
  };
}

function obstacleTypeFromControls(): ObstacleType {
  const value = controls.obstacles.value;
  return value === "none" || value === "big" || value === "small" || value === "any" ? value : "any";
}

function metricFromControls(): Metric {
  return controls.metric.value === "taxicab" ? "taxicab" : "linf";
}

function startLocalGame(): void {
  window.clearTimeout(aiTimer);
  gameId = null;
  myTeam = null;
  const previousState = state;
  const preset = localPresetFromControls();
  selectedPreset = preset.id;
  controls.width.value = String(preset.width);
  controls.height.value = String(preset.height);
  controls.planes.value = String(preset.planes);
  controls.turrets.value = String(preset.turrets);
  state = createGameFromPreset(`local-${Date.now()}`, preset, Math.floor(Math.random() * 0xffffffff));
  applyRestartMapOption(previousState, state);
  history = [cloneState(state)];
  hideEndGameUI();
  labels.message.textContent = mode === "computer" ? "Red to move. Blue is computer." : "Red to move.";
  updateHighlights();
  updateStatus();
  updateReplayControls();
  draw();
}

function applyRestartMapOption(previousState: GameState | null, nextState: GameState): void {
  if (!previousState || previousState.width !== nextState.width || previousState.height !== nextState.height) return;
  const option = Array.from(controls.mapOption).find((input) => input.checked)?.value ?? "new";
  if (option === "keep") {
    nextState.obstacles = [...previousState.obstacles];
    return;
  }
  if (option === "swap") {
    nextState.obstacles = previousState.obstacles.map((key) => {
      const [cx = 0, cy = 0] = key.split(",").map(Number);
      return `${nextState.width - 1 - cx},${nextState.height - 1 - cy}`;
    });
  }
}

function resetNetworkGame(): void {
  window.clearTimeout(aiTimer);
  gameId = null;
  myTeam = null;
  state = null;
  highlightedMoves = [];
  history = [];
  hideEndGameUI();
  updateStatus();
  updateReplayControls();
  draw();
}

function joinQueue(): void {
  resetNetworkGame();
  selectedPreset = networkPresetFromControls();
  syncPresetControls(selectedPreset);
  send({ type: "joinQueue", playerName: controls.playerName.value, presetId: selectedPreset });
  controls.leaveQueue.disabled = false;
  labels.message.textContent = `Queueing for ${GAME_PRESETS[selectedPreset].label}.`;
}

function networkPresetFromControls(): PresetId {
  const value = Array.from(controls.networkPreset).find((input) => input.checked)?.value;
  return value && isPresetId(value) ? value : "duel";
}

function connect(): void {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = import.meta.env.VITE_WS_HOST ?? `${window.location.hostname}:3000`;
  socket = new WebSocket(`${protocol}//${host}/ws`);

  socket.addEventListener("open", () => {
    if (mode === "network") labels.message.textContent = "Connected. Choose Queue to play online.";
  });

  socket.addEventListener("message", (event) => {
    handleServerMessage(JSON.parse(event.data as string) as ServerMessage);
  });

  socket.addEventListener("close", () => {
    if (mode === "network") labels.message.textContent = "Disconnected. Reconnecting...";
    controls.leaveQueue.disabled = true;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connect, 1200);
  });
}

function handleServerMessage(message: ServerMessage): void {
  if (mode !== "network") return;
  if (message.type === "queued") {
    labels.message.textContent = `Queued for ${GAME_PRESETS[message.presetId].label}.`;
    return;
  }

  if (message.type === "matchFound") {
    state = message.state;
    history = [cloneState(state)];
    gameId = message.gameId;
    myTeam = message.team;
    controls.leaveQueue.disabled = true;
    labels.message.textContent = state.turn === myTeam
      ? `Matched as ${TEAM[message.team].name} vs ${message.opponentName}. Your turn.`
      : `Matched as ${TEAM[message.team].name} vs ${message.opponentName}. Waiting for opponent move.`;
    hideEndGameUI();
    updateHighlights();
    updateStatus();
    updateReplayControls();
    draw();
    return;
  }

  if (message.type === "gameState") {
    state = message.state;
    history.push(cloneState(state));
    updateAfterStateChange(message.eliminated);
    return;
  }

  if (message.type === "moveRejected") {
    state = message.state;
    labels.message.textContent = message.reason;
    updateHighlights();
    updateStatus();
    draw();
    return;
  }

  if (message.type === "opponentDisconnected") {
    if (message.state) state = message.state;
    labels.message.textContent = "The opponent disconnected. Queue again when ready.";
    controls.leaveQueue.disabled = true;
    updateHighlights();
    updateStatus();
    draw();
  }
}

function submitMove(move: Move): void {
  if (!state || replaying || !canMoveNow()) return;
  if (mode === "network") {
    if (!gameId) return;
    send({ type: "submitMove", gameId, move: { x: move.x, y: move.y } });
    return;
  }

  applyLocalMove(move);
}

function applyLocalMove(move: Move): void {
  if (!state) return;
  const result = applyMove(state, state.turn, move);
  state = result.state;
  if (!result.ok) labels.message.textContent = result.error ?? "Move rejected.";
  else {
    history.push(cloneState(state));
    updateAfterStateChange(result.eliminated);
  }
  scheduleComputerMove();
}

function updateAfterStateChange(eliminated: string[]): void {
  if (!state) return;
  if (state.gameOver) {
    labels.message.textContent = state.winner === "draw" ? "Draw." : `${TEAM[state.winner ?? "red"].name} won.`;
    triggerEndGameUI(state.winner);
  } else if (eliminated.length > 0) {
    labels.message.textContent = "Hit scored. Choose one highlighted point.";
  } else if (mode === "network") {
    labels.message.textContent = state.turn === myTeam
      ? "Your turn."
      : "Waiting for opponent move.";
  } else {
    labels.message.textContent = `${TEAM[state.turn].name} to move.`;
  }
  updateHighlights();
  updateStatus();
  updateReplayControls();
  draw();
}

function scheduleComputerMove(): void {
  if (!state || replaying || mode !== "computer" || state.gameOver || state.turn !== "blue") return;
  window.clearTimeout(aiTimer);
  labels.message.textContent = "Blue is thinking.";
  aiTimer = window.setTimeout(() => {
    if (!state || state.turn !== "blue" || state.gameOver) return;
    const moves = legalMoves(state);
    const move = chooseComputerMove(moves);
    if (move) applyLocalMove(move);
  }, 380);
}

function chooseComputerMove(moves: Move[]): Move | null {
  if (!state || moves.length === 0) return null;
  const token = activeToken(state);
  if (!token) return moves[0] ?? null;
  return [...moves].sort((a, b) => scoreMove(token, b) - scoreMove(token, a))[0] ?? null;
}

function scoreMove(token: Token, move: Move): number {
  if (!state) return 0;
  const enemies = state.tokens.filter((item) => item.alive && item.team !== token.team);
  const nearest = enemies.reduce((best, enemy) => Math.min(best, distance(move, enemy)), Infinity);
  const centerBias = -distance(move, { x: state.width / 2, y: state.height / 2 }) * 0.05;
  const aggression = Number.isFinite(nearest) ? -nearest : 0;
  return aggression + centerBias + Math.random() * 0.2;
}

function canMoveNow(): boolean {
  if (!state || replaying || state.gameOver) return false;
  if (mode === "network") return state.turn === myTeam;
  if (mode === "computer") return state.turn !== "blue";
  return true;
}

function updateHighlights(): void {
  highlightedMoves = [];
  if (!state || !canMoveNow()) return;
  const token = activeToken(state);
  if (token) highlightedMoves = legalMoves(state, token);
}

function updateStatus(): void {
  const waitingForNetworkOpponent = Boolean(state && mode === "network" && myTeam && state.turn !== myTeam && !state.gameOver);
  endGame.container.classList.toggle("waiting-network", waitingForNetworkOpponent);
  if (!state) {
    labels.turn.textContent = "-";
    labels.moving.textContent = "-";
    labels.velocity.textContent = "-";
    labels.redAlive.textContent = "0";
    labels.blueAlive.textContent = "0";
    labels.mobileRedStats.textContent = "Red: 0";
    labels.mobileBlueStats.textContent = "Blue: 0";
    return;
  }

  const token = activeToken(state);
  labels.turn.textContent = state.gameOver
    ? "Game over"
    : waitingForNetworkOpponent
      ? "Opponent move"
      : TEAM[state.turn].name;
  labels.moving.textContent = token ? `${TEAM[token.team].name} ${token.type}` : "-";
  labels.velocity.textContent = token ? `(${token.vx}, ${token.vy})` : "-";
  labels.redAlive.textContent = aliveSummary("red");
  labels.blueAlive.textContent = aliveSummary("blue");
  labels.mobileRedStats.textContent = `Red: ${aliveSummaryCompact("red")}`;
  labels.mobileBlueStats.textContent = `Blue: ${aliveSummaryCompact("blue")}`;
}

function startReplay(): void {
  if (history.length < 2) return;
  replaying = true;
  window.clearTimeout(aiTimer);
  let index = 0;
  controls.replay.forEach((button) => {
    button.textContent = "Stop";
  });

  const step = () => {
    const frame = history[index];
    if (!frame) {
      stopReplay();
      return;
    }
    state = cloneState(frame);
    highlightedMoves = [];
    updateStatus();
    draw();
    index += 1;
    const delay = REPLAY_STEP_MS / replaySpeed();
    if (index >= history.length) {
      replayTimer = window.setTimeout(stopReplay, delay);
      return;
    }
    replayTimer = window.setTimeout(step, delay);
  };

  step();
}

function stopReplay(): void {
  if (!replaying) return;
  replaying = false;
  window.clearTimeout(replayTimer);
  const latest = history.at(-1);
  if (latest) state = cloneState(latest);
  updateHighlights();
  updateStatus();
  updateReplayControls();
  draw();
  scheduleComputerMove();
}

function updateReplayControls(): void {
  controls.replay.forEach((button) => {
    button.disabled = history.length < 2;
    button.textContent = replaying ? "Stop" : "Replay";
  });
  controls.speed.forEach((button) => {
    button.textContent = `${replaySpeed()}x`;
  });
}

function replaySpeed(): number {
  return REPLAY_SPEEDS[speedIndex] ?? 1;
}

function aliveSummary(team: Team): string {
  if (!state) return "0";
  const planes = state.tokens.filter((token) => token.team === team && token.type === "plane" && token.alive).length;
  const turrets = state.tokens.filter((token) => token.team === team && token.type === "turret" && token.alive).length;
  return `${planes} planes, ${turrets} turrets`;
}

function aliveSummaryCompact(team: Team): string {
  if (!state) return "0";
  const planes = state.tokens.filter((token) => token.team === team && token.type === "plane" && token.alive).length;
  const turrets = state.tokens.filter((token) => token.team === team && token.type === "turret" && token.alive).length;
  return `${planes}P ${turrets}T`;
}

function draw(): void {
  const geo = boardGeometry();
  ctx.clearRect(0, 0, geo.width, geo.height);
  if (!state) {
    drawEmptyBoard(geo);
    return;
  }
  drawPaper(geo);
  drawObstacles(geo);
  drawTrajectories(geo);
  drawHighlights(geo);
  drawTokens(geo);
}

function boardGeometry() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const boardWidth = state?.width ?? GAME_PRESETS[selectedPreset].width;
  const boardHeight = state?.height ?? GAME_PRESETS[selectedPreset].height;
  const padding = 28 * dpr;
  const cell = Math.min((width - padding * 2) / boardWidth, (height - padding * 2) / boardHeight);
  const gridWidth = cell * boardWidth;
  const gridHeight = cell * boardHeight;
  return {
    dpr,
    cell,
    left: (width - gridWidth) / 2,
    top: (height - gridHeight) / 2,
    width,
    height,
    boardWidth,
    boardHeight,
  };
}

function drawEmptyBoard(geo: ReturnType<typeof boardGeometry>): void {
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, geo.width, geo.height);
  ctx.fillStyle = "#67748a";
  ctx.font = `${18 * geo.dpr}px system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Queue for a network match", geo.width / 2, geo.height / 2);
}

function drawPaper(geo: ReturnType<typeof boardGeometry>): void {
  if (!state) return;
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, geo.width, geo.height);
  ctx.lineWidth = Math.max(1, geo.dpr);

  for (let x = 0; x <= state.width; x += 1) {
    const point = gridToPixel({ x, y: 0 }, geo);
    ctx.strokeStyle = x % 4 === 0 ? "#8fb0d9" : "#c8d5e7";
    ctx.beginPath();
    ctx.moveTo(point.x, geo.top);
    ctx.lineTo(point.x, geo.top + state.height * geo.cell);
    ctx.stroke();
  }

  for (let y = 0; y <= state.height; y += 1) {
    const point = gridToPixel({ x: 0, y }, geo);
    ctx.strokeStyle = y % 4 === 0 ? "#8fb0d9" : "#c8d5e7";
    ctx.beginPath();
    ctx.moveTo(geo.left, point.y);
    ctx.lineTo(geo.left + state.width * geo.cell, point.y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#24364f";
  ctx.lineWidth = 2 * geo.dpr;
  ctx.strokeRect(geo.left, geo.top, state.width * geo.cell, state.height * geo.cell);
}

function drawObstacles(geo: ReturnType<typeof boardGeometry>): void {
  if (!state) return;
  ctx.save();
  ctx.fillStyle = "rgba(71, 85, 105, 0.08)";
  ctx.strokeStyle = "#64748b";
  ctx.lineWidth = geo.dpr;

  for (const key of state.obstacles) {
    const [cx = 0, cy = 0] = key.split(",").map(Number);
    const x = geo.left + cx * geo.cell;
    const y = geo.top + (state.height - 1 - cy) * geo.cell;
    ctx.fillRect(x, y, geo.cell, geo.cell);
    ctx.strokeRect(x, y, geo.cell, geo.cell);
    ctx.beginPath();
    ctx.moveTo(x, y + geo.cell);
    ctx.lineTo(x + geo.cell, y);
    ctx.moveTo(x, y + geo.cell / 2);
    ctx.lineTo(x + geo.cell / 2, y);
    ctx.moveTo(x + geo.cell / 2, y + geo.cell);
    ctx.lineTo(x + geo.cell, y + geo.cell / 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTrajectories(geo: ReturnType<typeof boardGeometry>): void {
  if (!state) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const token of state.tokens) {
    if (token.type !== "plane" || token.history.length < 2) continue;
    ctx.strokeStyle = TEAM[token.team].color;
    ctx.globalAlpha = token.alive ? 0.62 : 0.38;
    ctx.lineWidth = Math.max(2 * geo.dpr, geo.cell * 0.14);
    ctx.beginPath();
    token.history.forEach((point, index) => {
      const p = gridToPixel(point, geo);
      if (index === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  }
  ctx.restore();
}

function drawHighlights(geo: ReturnType<typeof boardGeometry>): void {
  if (!state) return;
  const token = activeToken(state);
  if (!token || !canMoveNow()) return;
  const anchor = token.type === "plane" ? { x: token.x + token.vx, y: token.y + token.vy } : token;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.max(9 * geo.dpr, geo.cell * 0.35)}px sans-serif`;

  for (const move of highlightedMoves) {
    const p = gridToPixel(move, geo);
    ctx.fillStyle = TEAM[token.team].pale;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(5 * geo.dpr, geo.cell * 0.35), 0, Math.PI * 2);
    ctx.fill();

    const dx = move.x - anchor.x;
    const dy = move.y - anchor.y;
    const key = Object.values(KEY_MAP).find((value) => value.dx === dx && value.dy === dy);
    if (key && hasKeyboard()) {
      ctx.fillStyle = TEAM[token.team].color;
      ctx.fillText(key.char, p.x, p.y);
    }
  }

  if (token.type === "plane") {
    const tokenPos = gridToPixel(token, geo);
    const anchorPos = gridToPixel(anchor, geo);
    ctx.strokeStyle = TEAM[token.team].color;
    ctx.lineWidth = 1.2 * geo.dpr;
    ctx.globalAlpha = 0.45;
    ctx.setLineDash([4 * geo.dpr, 3 * geo.dpr]);
    ctx.beginPath();
    ctx.moveTo(tokenPos.x, tokenPos.y);
    ctx.lineTo(anchorPos.x, anchorPos.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  const p = gridToPixel(anchor, geo);
  ctx.strokeStyle = TEAM[token.team].color;
  ctx.lineWidth = 2 * geo.dpr;
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(7 * geo.dpr, geo.cell * 0.45), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawTokens(geo: ReturnType<typeof boardGeometry>): void {
  if (!state) return;
  for (const token of state.tokens) {
    if (!token.alive) continue;
    const p = gridToPixel(token, geo);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = TEAM[token.team].color;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1.5 * geo.dpr, geo.cell * 0.08);

    if (token.type === "plane") {
      const size = Math.max(10 * geo.dpr, geo.cell * 0.52);
      const angle = token.vx !== 0 || token.vy !== 0
        ? Math.atan2(-token.vy, token.vx)
        : token.team === "red" ? -Math.PI / 2 : Math.PI / 2;
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.65, -size * 0.5);
      ctx.lineTo(-size * 0.28, 0);
      ctx.lineTo(-size * 0.65, size * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      const size = Math.max(9 * geo.dpr, geo.cell * 0.45);
      ctx.rotate(turretAngle(token));
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = TEAM[token.team].color;
      ctx.lineWidth = 4 * geo.dpr;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(size * 1.15, 0);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function turretAngle(token: Token): number {
  return token.team === "red" ? -Math.PI / 2 : Math.PI / 2;
}

function eventToGrid(event: MouseEvent): { x: number; y: number } {
  const geo = boardGeometry();
  const rect = canvas.getBoundingClientRect();
  const px = (event.clientX - rect.left) * geo.dpr;
  const py = (event.clientY - rect.top) * geo.dpr;
  return {
    x: Math.round((px - geo.left) / geo.cell),
    y: Math.round((geo.boardHeight * geo.cell - (py - geo.top)) / geo.cell),
  };
}

function gridToPixel(point: { x: number; y: number }, geo: ReturnType<typeof boardGeometry>): { x: number; y: number } {
  return {
    x: geo.left + point.x * geo.cell,
    y: geo.top + (geo.boardHeight - point.y) * geo.cell,
  };
}

function triggerEndGameUI(winner: Team | "draw" | null): void {
  hideEndGameUI();
  const outcome = winner ?? "draw";
  endGame.overlayTitle.textContent = outcome === "draw" ? "Draw" : `${TEAM[outcome].name} Wins`;
  endGame.overlayTitle.className = `winner-${outcome}`;
  endGame.bannerText.textContent = outcome === "draw" ? "Draw" : `${TEAM[outcome].name} Team Won`;
  endGame.banner.className = `end-game-banner active banner-${outcome}`;
  endGame.container.classList.add(`winner-${outcome}`);
  endGame.overlay.classList.add("active");
}

function hideEndGameUI(): void {
  endGame.overlay.classList.remove("active");
  endGame.overlayTitle.className = "";
  endGame.overlayTitle.textContent = "";
  endGame.banner.className = "end-game-banner";
  endGame.bannerText.textContent = "";
  endGame.container.classList.remove("winner-red", "winner-blue", "winner-draw");
}

function send(message: ClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hasKeyboard(): boolean {
  return !window.matchMedia("(pointer: coarse)").matches;
}

window.addEventListener("resize", draw);
