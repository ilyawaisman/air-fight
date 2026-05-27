import "../src/styles.css";
import { activeToken, applyMove, cloneState, createGame, createGameFromPreset, legalMoves } from "../../shared/game/engine.js";
import { GAME_PRESETS, isPresetId } from "../../shared/game/presets.js";
import type { GamePreset, GameState, Move, ObstacleType, PresetId, Team, Token } from "../../shared/game/types.js";
import type { ClientMessage, ServerMessage } from "../../shared/protocol.js";

type PlayMode = "computer" | "local" | "network";
interface ExplosionEffect {
  x: number;
  y: number;
  color: string;
  born: number;
}

interface LaserEffect {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  born: number;
}

interface ChatLine {
  kind: "message" | "marker";
  text: string;
  fromTeam?: Team;
  fromName?: string;
}

type ChatChannel = "match" | "server";

interface StoredSettings {
  playerName?: string;
  local?: {
    width?: number;
    height?: number;
    planes?: number;
    turrets?: number;
    obstacles?: ObstacleType;
    showTurretZones?: boolean;
    mapOption?: "new" | "keep" | "swap";
  };
}

const HIT_RADIUS = 1;
const TURRET_RADIUS = 5;
const SETTINGS_KEY = "air-fight-online-settings";

const canvas = document.querySelector<HTMLCanvasElement>("#board")!;
const ctx = canvas.getContext("2d")!;

const controls = {
  mode: document.getElementsByName("playMode") as NodeListOf<HTMLInputElement>,
  width: document.querySelector<HTMLInputElement>("#fieldWidth")!,
  height: document.querySelector<HTMLInputElement>("#fieldHeight")!,
  planes: document.querySelector<HTMLSelectElement>("#planeCount")!,
  turrets: document.querySelector<HTMLSelectElement>("#turretCount")!,
  obstacles: document.querySelector<HTMLSelectElement>("#obstacles")!,
  showTurretZones: document.querySelector<HTMLInputElement>("#showTurretZones")!,
  playerName: document.querySelector<HTMLInputElement>("#playerName")!,
  mapOption: document.getElementsByName("mapOption") as NodeListOf<HTMLInputElement>,
  networkPreset: document.getElementsByName("networkPreset") as NodeListOf<HTMLInputElement>,
  newGame: document.querySelectorAll<HTMLButtonElement>(".new-game-btn"),
  replay: document.querySelectorAll<HTMLButtonElement>(".replay-btn"),
  speed: document.querySelectorAll<HTMLButtonElement>(".speed-btn"),
  chatPanel: document.querySelector<HTMLElement>("#chatPanel")!,
  mobileChatPanel: document.querySelector<HTMLElement>("#mobileChatPanel")!,
  chatHistories: document.querySelectorAll<HTMLElement>(".chat-history"),
  chatForms: document.querySelectorAll<HTMLFormElement>(".chat-form"),
  chatInputs: document.querySelectorAll<HTMLInputElement>(".chat-form input"),
  chatSends: document.querySelectorAll<HTMLButtonElement>(".chat-form button"),
  chatTabs: document.querySelectorAll<HTMLButtonElement>(".chat-tab"),
  chatCollapse: document.querySelector<HTMLButtonElement>("#collapseChat")!,
  chatToggle: document.querySelector<HTMLButtonElement>("#chatToggle")!,
  mobileChatClose: document.querySelector<HTMLButtonElement>("#closeMobileChat")!,
  queueCounts: document.querySelectorAll<HTMLElement>(".queue-count"),
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
const REPLAY_ANIMATION_MS = 220;
const LONG_TOUCH_MS = 600;

let mode: PlayMode = "computer";
let selectedPreset: PresetId = "classic";
let state: GameState | null = null;
let socket: WebSocket | null = null;
let reconnectTimer = 0;
let aiTimer = 0;
let gameId: string | null = null;
let myTeam: Team | null = null;
let queueing = false;
let queueCounts: Record<PresetId, number> = { duel: 0, classic: 0, tactical: 0 };
let highlightedMoves: Move[] = [];
let draggedMove: Move | null = null;
let history: GameState[] = [];
let matchChatLines: ChatLine[] = [];
let serverChatLines: ChatLine[] = [];
let activeChatChannel: ChatChannel = "match";
let chatCollapsed = false;
let replaying = false;
let replayTimer = 0;
let replayAnimationFrame = 0;
let effectsFrame = 0;
let speedIndex = 0;
let explosions: ExplosionEffect[] = [];
let lasers: LaserEffect[] = [];
let touchStartX = 0;
let touchStartY = 0;
let isSwiping = false;
let longTouchTimer = 0;
let longTouchActive = false;

function closeSettingsPanel(): void {
  document.querySelector<HTMLElement>(".control-panel")?.classList.remove("open");
  document.querySelector<HTMLElement>("#settingsBackdrop")?.classList.remove("active");
}

loadSettings();
applyModeUi();
startLocalGame();
connect();
bindControls();
renderChat();
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
      saveSettings();
    });
  });

  controls.planes.addEventListener("change", () => {
    selectedPreset = presetFromControls();
    saveSettings();
  });
  controls.turrets.addEventListener("change", () => {
    selectedPreset = presetFromControls();
    saveSettings();
  });
  controls.width.addEventListener("change", saveSettings);
  controls.height.addEventListener("change", saveSettings);
  controls.obstacles.addEventListener("change", saveSettings);
  controls.showTurretZones.addEventListener("change", () => {
    saveSettings();
    draw();
  });
  controls.playerName.addEventListener("input", saveSettings);

  controls.newGame.forEach((button) => {
    button.addEventListener("click", () => {
      newGameAction();
    });
  });

  controls.chatForms.forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      sendChatMessage(form);
    });
  });

  controls.chatTabs.forEach((button) => {
    button.addEventListener("click", () => {
      const channel = button.dataset.chatChannel;
      if (channel !== "match" && channel !== "server") return;
      activeChatChannel = channel;
      renderChat();
    });
  });

  controls.chatCollapse.addEventListener("click", () => {
    chatCollapsed = !chatCollapsed;
    controls.chatPanel.classList.toggle("collapsed", chatCollapsed);
    controls.chatCollapse.textContent = chatCollapsed ? "Expand" : "Collapse";
    controls.chatCollapse.setAttribute("aria-expanded", String(!chatCollapsed));
  });

  controls.chatToggle.addEventListener("click", () => {
    controls.mobileChatPanel.classList.toggle("mobile-open");
  });

  controls.mobileChatClose.addEventListener("click", () => {
    controls.mobileChatPanel.classList.remove("mobile-open");
  });

  canvas.addEventListener("click", (event) => {
    if (replaying) return;
    const move = moveAtPoint(eventToGrid(event));
    if (!move) {
      labels.message.textContent = "Choose one of the highlighted points.";
      return;
    }
    submitMove(move);
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement) return;
    if (target instanceof HTMLInputElement && (target.type === "text" || target.type === "number")) return;

    if ((event.key === "n" || event.key === "N") && !replaying) {
      event.preventDefault();
      newGameAction();
      return;
    }

    if ((event.key === "r" || event.key === "R") && !replaying && history.length >= 2) {
      event.preventDefault();
      startReplay();
      return;
    }

    if (event.code === "Space" && state?.gameOver) {
      event.preventDefault();
      showPersistentBannerOnly();
      return;
    }

    if (replaying) return;
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
  toggleSettings?.addEventListener("click", () => {
    panel?.classList.add("open");
    backdrop?.classList.add("active");
  });
  closeSettings?.addEventListener("click", closeSettingsPanel);
  backdrop?.addEventListener("click", closeSettingsPanel);

  document.getElementsByName("mapOption").forEach((input) => {
    input.addEventListener("change", () => {
      syncMapOptions("mapOption", "mapOptionMobile");
      saveSettings();
    });
  });
  document.getElementsByName("mapOptionMobile").forEach((input) => {
    input.addEventListener("change", () => {
      syncMapOptions("mapOptionMobile", "mapOption");
      saveSettings();
    });
  });

  bindTouchControls();
}

function newGameAction(): void {
  stopReplay();
  closeSettingsPanel();
  if (mode === "network") {
    if (gameId && state && !state.gameOver) leaveNetworkGame();
    else if (queueing) leaveQueue();
    else joinQueue();
    return;
  }
  startLocalGame();
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
    button.textContent = networkActionLabel();
  });
  updateNetworkControls();
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
    metric: "linf",
  };
}

function obstacleTypeFromControls(): ObstacleType {
  const value = controls.obstacles.value;
  return value === "none" || value === "big" || value === "small" || value === "mixed" ? value : "mixed";
}

function startLocalGame(): void {
  window.clearTimeout(aiTimer);
  clearEffects();
  gameId = null;
  myTeam = null;
  queueing = false;
  const previousState = state;
  const preset = localPresetFromControls();
  selectedPreset = preset.id;
  controls.width.value = String(preset.width);
  controls.height.value = String(preset.height);
  controls.planes.value = String(preset.planes);
  controls.turrets.value = String(preset.turrets);
  saveSettings();
  state = createGameFromPreset(`local-${Date.now()}`, preset, Math.floor(Math.random() * 0xffffffff));
  applyRestartMapOption(previousState, state);
  history = [cloneState(state)];
  hideEndGameUI();
  labels.message.textContent = mode === "computer" ? "Red to move. Blue is computer." : "Red to move.";
  updateHighlights();
  updateStatus();
  updateReplayControls();
  updateNetworkControls();
  draw();
}

function applyRestartMapOption(previousState: GameState | null, nextState: GameState): void {
  if (!previousState || previousState.width !== nextState.width || previousState.height !== nextState.height) return;
  syncMapOptions("mapOptionMobile", "mapOption");
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

function syncMapOptions(sourceName: string, targetName: string): void {
  const source = document.getElementsByName(sourceName) as NodeListOf<HTMLInputElement>;
  const target = document.getElementsByName(targetName) as NodeListOf<HTMLInputElement>;
  const value = Array.from(source).find((input) => input.checked)?.value;
  if (!value) return;
  const match = Array.from(target).find((input) => input.value === value);
  if (match) match.checked = true;
}

function loadSettings(): void {
  const settings = readStoredSettings();
  if (settings.playerName) controls.playerName.value = settings.playerName;

  const local = settings.local;
  if (!local) return;
  if (typeof local.width === "number") controls.width.value = String(clamp(local.width, 12, 80));
  if (typeof local.height === "number") controls.height.value = String(clamp(local.height, 16, 96));
  if (typeof local.planes === "number") controls.planes.value = String(clamp(local.planes, 1, 7));
  if (typeof local.turrets === "number") controls.turrets.value = String(clamp(local.turrets, 0, 2));
  if (local.obstacles) controls.obstacles.value = local.obstacles;
  if (typeof local.showTurretZones === "boolean") controls.showTurretZones.checked = local.showTurretZones;
  if (local.mapOption) setRadioValue("mapOption", local.mapOption);
  syncMapOptions("mapOption", "mapOptionMobile");
  selectedPreset = presetFromControls();
}

function saveSettings(): void {
  writeStoredSettings({
    playerName: controls.playerName.value.trim(),
    local: {
      width: Number(controls.width.value),
      height: Number(controls.height.value),
      planes: Number(controls.planes.value),
      turrets: Number(controls.turrets.value),
      obstacles: obstacleTypeFromControls(),
      showTurretZones: controls.showTurretZones.checked,
      mapOption: mapOptionFromControls(),
    },
  });
}

function readStoredSettings(): StoredSettings {
  try {
    return JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "{}") as StoredSettings;
  } catch {
    return {};
  }
}

function writeStoredSettings(settings: StoredSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures; gameplay should not depend on persistence.
  }
}

function mapOptionFromControls(): "new" | "keep" | "swap" {
  const value = Array.from(controls.mapOption).find((input) => input.checked)?.value;
  return value === "keep" || value === "swap" ? value : "new";
}

function setRadioValue(name: string, value: string): void {
  const input = Array.from(document.getElementsByName(name) as NodeListOf<HTMLInputElement>)
    .find((candidate) => candidate.value === value);
  if (input) input.checked = true;
}

function resetNetworkGame(): void {
  window.clearTimeout(aiTimer);
  clearEffects();
  gameId = null;
  myTeam = null;
  state = null;
  highlightedMoves = [];
  history = [];
  queueing = false;
  hideEndGameUI();
  updateStatus();
  updateReplayControls();
  updateNetworkControls();
  draw();
}

function joinQueue(): void {
  resetNetworkGame();
  selectedPreset = networkPresetFromControls();
  syncPresetControls(selectedPreset);
  queueing = true;
  appendChatMarker(`New ${GAME_PRESETS[selectedPreset].label} queue`);
  send({ type: "joinQueue", playerName: controls.playerName.value, presetId: selectedPreset });
  labels.message.textContent = `Queueing for ${GAME_PRESETS[selectedPreset].label}.`;
  updateNetworkControls();
}

function leaveQueue(): void {
  if (!queueing) return;
  send({ type: "leaveQueue" });
  queueing = false;
  labels.message.textContent = "Queue left.";
  updateNetworkControls();
}

function leaveNetworkGame(): void {
  if (!gameId) return;
  send({ type: "leaveQueue" });
  resetNetworkGame();
  labels.message.textContent = "Game left. Queue again when ready.";
}

function networkPresetFromControls(): PresetId {
  const value = Array.from(controls.networkPreset).find((input) => input.checked)?.value;
  return value && isPresetId(value) ? value : "duel";
}

function connect(): void {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = import.meta.env.VITE_WS_HOST ?? defaultWebSocketHost();
  socket = new WebSocket(`${protocol}//${host}/ws`);

  socket.addEventListener("open", () => {
    if (mode === "network") labels.message.textContent = "Connected. Choose Queue to play online.";
    updateNetworkControls();
  });

  socket.addEventListener("message", (event) => {
    handleServerMessage(JSON.parse(event.data as string) as ServerMessage);
  });

  socket.addEventListener("close", () => {
    if (mode === "network") labels.message.textContent = "Disconnected. Reconnecting...";
    queueing = false;
    updateNetworkControls();
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connect, 1200);
  });
}

function defaultWebSocketHost(): string {
  if (window.location.port === "5173") return `${window.location.hostname}:3000`;
  return window.location.host;
}

function handleServerMessage(message: ServerMessage): void {
  if (message.type === "queueStatus") {
    queueCounts = message.counts;
    renderQueueCounts();
    return;
  }

  if (mode !== "network") return;
  if (message.type === "queued") {
    queueing = true;
    labels.message.textContent = `Queued for ${GAME_PRESETS[message.presetId].label}.`;
    updateNetworkControls();
    return;
  }

  if (message.type === "matchFound") {
    clearEffects();
    state = message.state;
    history = [cloneState(state)];
    gameId = message.gameId;
    myTeam = message.team;
    queueing = false;
    appendChatMarker(`New match vs ${message.opponentName}`);
    labels.message.textContent = state.turn === myTeam
      ? `Matched as ${TEAM[message.team].name} vs ${message.opponentName}. Your turn.`
      : `Matched as ${TEAM[message.team].name} vs ${message.opponentName}. Opponent move.`;
    hideEndGameUI();
    updateHighlights();
    updateStatus();
    updateReplayControls();
    updateNetworkControls();
    draw();
    return;
  }

  if (message.type === "chatMessage") {
    if (message.gameId !== gameId) return;
    appendChatMessage(message.fromTeam, message.fromName, message.text);
    return;
  }

  if (message.type === "serverChatMessage") {
    appendServerChatMessage(message.fromName, message.text);
    return;
  }

  if (message.type === "gameState") {
    const previous = state ? cloneState(state) : null;
    state = message.state;
    history.push(cloneState(state));
    if (previous) addEffectsFromTransition(previous, state, message.eliminated);
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
    gameId = null;
    myTeam = null;
    labels.message.textContent = "The opponent disconnected. Queue again when ready.";
    queueing = false;
    updateHighlights();
    updateStatus();
    updateNetworkControls();
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
  const previous = cloneState(state);
  const result = applyMove(state, state.turn, move);
  state = result.state;
  if (!result.ok) labels.message.textContent = result.error ?? "Move rejected.";
  else {
    history.push(cloneState(state));
    addEffectsFromTransition(previous, state, result.eliminated);
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
      : "Opponent move.";
  } else {
    labels.message.textContent = `${TEAM[state.turn].name} to move.`;
  }
  updateHighlights();
  updateStatus();
  updateReplayControls();
  updateNetworkControls();
  draw();
}

function scheduleComputerMove(): void {
  if (!state || replaying || mode !== "computer" || state.gameOver || state.turn !== "blue") return;
  window.clearTimeout(aiTimer);
  labels.message.textContent = "Blue is thinking.";
  aiTimer = window.setTimeout(() => {
    if (!state || state.turn !== "blue" || state.gameOver) return;
    const token = activeToken(state);
    const move = token ? chooseComputerMove(token) : null;
    if (move) applyLocalMove(move);
  }, 380);
}

function chooseComputerMove(token: Token): Move | null {
  if (!state) return null;
  const moves = legalMoves(state, token);
  const insideMoves = moves.filter((move) => inside(move, token.type === "plane"));
  const candidates = insideMoves.length ? insideMoves : moves;
  const parsedObstacles = parseObstacles();

  let best = candidates[0] ?? null;
  let bestScore = -Infinity;
  for (const move of candidates) {
    const score = token.type === "plane"
      ? scoreComputerPlaneMove(token, move, parsedObstacles)
      : scoreComputerTurretMove(token, move, parsedObstacles);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

function scoreComputerPlaneMove(token: Token, move: Move, parsedObstacles: Array<{ cx: number; cy: number }>): number {
  if (!state) return 0;
  const start = { x: token.x, y: token.y };
  if (!inside(move, true)) return -100000;
  if (pathIntersectsObstaclesFast(start, move, parsedObstacles)) return -100000;

  for (const target of state.tokens) {
    if (target.alive && target.id !== token.id && pointOnSegment(target, start, move)) return -100000;
  }

  const enemies = state.tokens.filter((target) => target.alive && target.team !== token.team);
  const enemyTurrets = enemies.filter((target) => target.type === "turret");
  let score = Math.random() * 0.2;

  for (const target of enemies) {
    const d = distanceLInf(move, target);
    if (d <= HIT_RADIUS) score += target.type === "turret" ? 12000 : 8000;
    score += 80 / (d + 1);
  }

  for (const turret of enemyTurrets) {
    if (distanceManhattan(move, turret) <= TURRET_RADIUS && !pathIntersectsObstaclesOpen(move, turret)) score -= 6500;
  }

  const nextVx = token.vx + move.ax;
  const nextVy = token.vy + move.ay;
  score -= 0.08 * (nextVx * nextVx + nextVy * nextVy);

  const steps = survivalDepth(move.x, move.y, nextVx, nextVy, 1, 3, token.id, parsedObstacles);
  if (steps < 3) score -= (3 - steps) * 25000;

  return score;
}

function scoreComputerTurretMove(token: Token, move: Move, parsedObstacles: Array<{ cx: number; cy: number }>): number {
  if (!state) return 0;
  const start = { x: token.x, y: token.y };
  if (!inside(move, false)) return -100000;
  if (pathIntersectsObstaclesFast(start, move, parsedObstacles)) return -100000;

  for (const target of state.tokens) {
    if (target.alive && target.id !== token.id && pointOnSegment(target, start, move)) return -100000;
  }

  const enemyPlanes = state.tokens.filter((target) => target.alive && target.team !== token.team && target.type === "plane");
  if (enemyPlanes.length === 0) return 0;
  return -Math.min(...enemyPlanes.map((plane) => distanceManhattan(move, plane)));
}

function survivalDepth(
  x: number,
  y: number,
  vx: number,
  vy: number,
  currentDepth: number,
  maxDepth: number,
  tokenId: string,
  parsedObstacles: Array<{ cx: number; cy: number }>,
): number {
  if (!state || currentDepth === maxDepth) return maxDepth;
  let maxChildDepth = currentDepth;

  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const nvx = vx + dx;
      const nvy = vy + dy;
      const nx = x + nvx;
      const ny = y + nvy;
      const start = { x, y };
      const end = { x: nx, y: ny };

      if (!inside(end, true)) continue;
      if (pathIntersectsObstaclesFast(start, end, parsedObstacles)) continue;
      if (state.tokens.some((target) => target.alive && target.id !== tokenId && pointOnSegment(target, start, end))) continue;

      const depth = survivalDepth(nx, ny, nvx, nvy, currentDepth + 1, maxDepth, tokenId, parsedObstacles);
      if (depth > maxChildDepth) maxChildDepth = depth;
      if (maxChildDepth === maxDepth) return maxDepth;
    }
  }

  return maxChildDepth;
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
  const waitingForNetworkOpponent = Boolean(state && mode === "network" && myTeam && state.turn !== myTeam && !state.gameOver && !replaying);
  endGame.container.classList.toggle("waiting-network", waitingForNetworkOpponent);
  if (!state) {
    labels.turn.textContent = "-";
    labels.moving.textContent = "-";
    labels.velocity.textContent = "-";
    labels.redAlive.textContent = "0";
    labels.blueAlive.textContent = "0";
    labels.mobileRedStats.textContent = "Red: 0";
    labels.mobileBlueStats.textContent = "Blue: 0";
    updateActiveHud(null);
    return;
  }

  const token = activeToken(state);
  updateActiveHud(token);
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

function updateActiveHud(token: Token | null): void {
  const row = labels.moving.parentElement;
  if (!row) return;
  row.classList.remove("active-hud", "active-red", "active-blue");
  if (!token || state?.gameOver) return;
  row.classList.add("active-hud", token.team === "red" ? "active-red" : "active-blue");
}

function startReplay(): void {
  if (history.length < 2) return;
  replaying = true;
  window.clearTimeout(aiTimer);
  clearEffects();
  hideEndGameUI();
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
    const previous = index > 0 ? history[index - 1] ?? null : null;
    const delay = REPLAY_STEP_MS / replaySpeed();
    animateReplayFrame(previous, frame, () => {
      index += 1;
      if (index >= history.length) {
        replayTimer = window.setTimeout(stopReplay, delay);
        return;
      }
      replayTimer = window.setTimeout(step, Math.max(0, delay - REPLAY_ANIMATION_MS / replaySpeed()));
    });
  };

  step();
}

function stopReplay(): void {
  if (!replaying) return;
  replaying = false;
  window.clearTimeout(replayTimer);
  if (replayAnimationFrame) {
    cancelAnimationFrame(replayAnimationFrame);
    replayAnimationFrame = 0;
  }
  clearEffects();
  const latest = history.at(-1);
  if (latest) state = cloneState(latest);
  updateHighlights();
  updateStatus();
  updateReplayControls();
  draw();
  if (state?.gameOver) showPersistentBannerOnly();
  scheduleComputerMove();
}

function animateReplayFrame(previous: GameState | null, frame: GameState, done: () => void): void {
  if (!previous) {
    state = cloneState(frame);
    highlightedMoves = [];
    updateStatus();
    draw();
    done();
    return;
  }

  const started = performance.now();
  const duration = REPLAY_ANIMATION_MS / replaySpeed();
  const tick = (now: number) => {
    const progress = Math.min(1, (now - started) / duration);
    state = interpolateStates(previous, frame, progress);
    highlightedMoves = [];
    updateStatus();
    draw();

    if (progress < 1) {
      replayAnimationFrame = requestAnimationFrame(tick);
      return;
    }

    state = cloneState(frame);
    addEffectsFromTransition(previous, state, eliminatedBetween(previous, state));
    updateStatus();
    draw();
    done();
  };

  if (replayAnimationFrame) cancelAnimationFrame(replayAnimationFrame);
  replayAnimationFrame = requestAnimationFrame(tick);
}

function interpolateStates(before: GameState, after: GameState, progress: number): GameState {
  const interpolated = cloneState(after);
  interpolated.tokens = after.tokens.map((afterToken) => {
    const beforeToken = before.tokens.find((token) => token.id === afterToken.id) ?? afterToken;
    return {
      ...afterToken,
      x: beforeToken.x + (afterToken.x - beforeToken.x) * progress,
      y: beforeToken.y + (afterToken.y - beforeToken.y) * progress,
      vx: progress < 1 ? beforeToken.vx : afterToken.vx,
      vy: progress < 1 ? beforeToken.vy : afterToken.vy,
    };
  });
  return interpolated;
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

function updateNetworkControls(): void {
  controls.newGame.forEach((button) => {
    button.textContent = networkActionLabel();
    button.disabled = false;
  });
  const connected = socket?.readyState === WebSocket.OPEN;
  const canChat = mode === "network" && connected;
  controls.chatInputs.forEach((input) => {
    input.disabled = !canChat || (activeChatChannel === "match" && !gameId);
    input.placeholder = activeChatChannel === "match" ? "Message opponent" : "Message server";
  });
  controls.chatSends.forEach((button) => {
    button.disabled = !canChat || (activeChatChannel === "match" && !gameId);
  });
  controls.chatToggle.disabled = mode !== "network" || (matchChatLines.length === 0 && serverChatLines.length === 0);
  renderQueueCounts();
}

function networkActionLabel(): string {
  if (mode !== "network") return "New";
  if (gameId && state && !state.gameOver) return "Leave Game";
  if (queueing) return "Leave Queue";
  return "Queue";
}

function renderQueueCounts(): void {
  controls.queueCounts.forEach((element) => {
    const presetId = element.dataset.presetCount;
    if (!presetId || !isPresetId(presetId)) return;
    const count = queueCounts[presetId];
    element.textContent = count === 1 ? "1 waiting" : `${count} waiting`;
    element.classList.toggle("visible", mode === "network" && count > 0);
  });
}

function sendChatMessage(form: HTMLFormElement): void {
  const input = form.querySelector<HTMLInputElement>("input");
  const text = input?.value.trim() ?? "";
  if (!text) return;
  if (activeChatChannel === "match") {
    if (!gameId) return;
    send({ type: "chatMessage", gameId, text });
  } else {
    send({ type: "serverChatMessage", playerName: controls.playerName.value, text });
  }
  controls.chatInputs.forEach((chatInput) => {
    chatInput.value = "";
  });
}

function appendChatMarker(text: string): void {
  matchChatLines.push({ kind: "marker", text });
  matchChatLines = trimChatLines(matchChatLines);
  renderChat();
}

function appendChatMessage(fromTeam: Team, fromName: string, text: string): void {
  matchChatLines.push({ kind: "message", fromTeam, fromName, text });
  matchChatLines = trimChatLines(matchChatLines);
  renderChat();
}

function appendServerChatMessage(fromName: string, text: string): void {
  serverChatLines.push({ kind: "message", fromName, text });
  serverChatLines = trimChatLines(serverChatLines);
  renderChat();
}

function trimChatLines(lines: ChatLine[]): ChatLine[] {
  return lines.slice(-40);
}

function renderChat(): void {
  const chatLines = activeChatChannel === "match" ? matchChatLines : serverChatLines;
  controls.chatTabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.chatChannel === activeChatChannel);
  });
  controls.chatHistories.forEach((historyElement) => {
    historyElement.replaceChildren();
    if (chatLines.length === 0) {
      const empty = document.createElement("div");
      empty.className = "chat-empty";
      empty.textContent = "No messages yet.";
      historyElement.appendChild(empty);
    } else {
      for (const line of chatLines) {
        const element = document.createElement("div");
        if (line.kind === "marker") {
          element.className = "chat-marker";
          element.textContent = line.text;
        } else {
          element.className = `chat-line ${chatLineClass(line)}`;
          const name = document.createElement("span");
          name.className = "chat-name";
          name.textContent = line.fromName ?? (line.fromTeam ? TEAM[line.fromTeam].name : "Player");
          const message = document.createElement("span");
          message.className = "chat-text";
          message.textContent = line.text;
          element.append(name, message);
        }
        historyElement.appendChild(element);
      }
    }
    historyElement.scrollTop = historyElement.scrollHeight;
  });
  updateNetworkControls();
}

function chatLineClass(line: ChatLine): string {
  if (activeChatChannel === "server") return line.fromName === cleanPlayerName(controls.playerName.value) ? "mine" : "server";
  return line.fromTeam === myTeam ? "mine" : "theirs";
}

function cleanPlayerName(value: string): string {
  return value.trim().slice(0, 24) || "Player";
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
  drawTurretZones(geo);
  drawObstacles(geo);
  drawTrajectories(geo);
  drawHighlights(geo);
  drawLasers(geo);
  drawTokens(geo);
  drawExplosions(geo);
  if (lasers.length > 0 || explosions.length > 0) scheduleEffectsDraw();
}

function drawTurretZones(geo: ReturnType<typeof boardGeometry>): void {
  if (!state || !controls.showTurretZones.checked) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(geo.left, geo.top, state.width * geo.cell, state.height * geo.cell);
  ctx.clip();

  for (const token of state.tokens) {
    if (!token.alive || token.type !== "turret") continue;
    const right = gridToPixel({ x: token.x + TURRET_RADIUS, y: token.y }, geo);
    const top = gridToPixel({ x: token.x, y: token.y + TURRET_RADIUS }, geo);
    const left = gridToPixel({ x: token.x - TURRET_RADIUS, y: token.y }, geo);
    const bottom = gridToPixel({ x: token.x, y: token.y - TURRET_RADIUS }, geo);

    ctx.beginPath();
    ctx.moveTo(right.x, right.y);
    ctx.lineTo(top.x, top.y);
    ctx.lineTo(left.x, left.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.closePath();
    ctx.fillStyle = token.team === "red" ? "rgba(212, 61, 61, 0.05)" : "rgba(37, 99, 199, 0.05)";
    ctx.fill();
    ctx.strokeStyle = TEAM[token.team].color;
    ctx.lineWidth = 1.5 * geo.dpr;
    ctx.setLineDash([4 * geo.dpr, 4 * geo.dpr]);
    ctx.stroke();
  }

  ctx.restore();
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
    const isDragged = draggedMove?.x === move.x && draggedMove.y === move.y;
    ctx.fillStyle = isDragged ? TEAM[token.team].color : TEAM[token.team].pale;
    ctx.globalAlpha = isDragged ? 0.35 : 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(5 * geo.dpr, geo.cell * 0.35) * (isDragged ? 1.25 : 1), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (isDragged) {
      ctx.strokeStyle = TEAM[token.team].color;
      ctx.lineWidth = 2.5 * geo.dpr;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(5 * geo.dpr, geo.cell * 0.35) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }

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

  if (draggedMove) {
    const fromPos = gridToPixel(anchor, geo);
    const toPos = gridToPixel(draggedMove, geo);
    ctx.strokeStyle = TEAM[token.team].color;
    ctx.lineWidth = 3 * geo.dpr;
    ctx.beginPath();
    ctx.moveTo(fromPos.x, fromPos.y);
    ctx.lineTo(toPos.x, toPos.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTokens(geo: ReturnType<typeof boardGeometry>): void {
  if (!state) return;
  const active = activeToken(state);
  for (const token of state.tokens) {
    if (!token.alive) continue;
    const p = gridToPixel(token, geo);
    if (active?.id === token.id && !replaying) drawActiveMarker(p, token, geo);
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

function drawActiveMarker(p: { x: number; y: number }, token: Token, geo: ReturnType<typeof boardGeometry>): void {
  const size = token.type === "plane"
    ? Math.max(10 * geo.dpr, geo.cell * 0.52)
    : Math.max(9 * geo.dpr, geo.cell * 0.45);
  const radius = size * 1.1;
  const length = size * 0.35;

  ctx.save();
  ctx.strokeStyle = TEAM[token.team].color;
  ctx.fillStyle = TEAM[token.team].color;
  ctx.lineWidth = 1.8 * geo.dpr;

  drawMarkerBracket(p.x - radius, p.y - radius, length, 1, 1);
  drawMarkerBracket(p.x + radius, p.y - radius, length, -1, 1);
  drawMarkerBracket(p.x - radius, p.y + radius, length, 1, -1);
  drawMarkerBracket(p.x + radius, p.y + radius, length, -1, -1);

  ctx.globalAlpha = 0.08;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMarkerBracket(x: number, y: number, length: number, xDirection: -1 | 1, yDirection: -1 | 1): void {
  ctx.beginPath();
  ctx.moveTo(x, y + length * yDirection);
  ctx.lineTo(x, y);
  ctx.lineTo(x + length * xDirection, y);
  ctx.stroke();
}

function drawExplosions(geo: ReturnType<typeof boardGeometry>): void {
  const now = performance.now();
  explosions = explosions.filter((boom) => now - boom.born < 620);

  for (const boom of explosions) {
    const age = (now - boom.born) / 620;
    const p = gridToPixel(boom, geo);
    const radius = (0.35 + age * 1.6) * geo.cell;
    ctx.save();
    ctx.globalAlpha = 1 - age;
    ctx.strokeStyle = "#d8911d";
    ctx.fillStyle = boom.color;
    ctx.lineWidth = Math.max(2 * geo.dpr, geo.cell * 0.12);
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(angle) * radius * 0.35, p.y + Math.sin(angle) * radius * 0.35);
      ctx.lineTo(p.x + Math.cos(angle) * radius, p.y + Math.sin(angle) * radius);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawLasers(geo: ReturnType<typeof boardGeometry>): void {
  const now = performance.now();
  lasers = lasers.filter((laser) => now - laser.born < 800);

  ctx.save();
  for (const laser of lasers) {
    const age = now - laser.born;
    const baseOpacity = age > 300 ? Math.max(0, 1 - (age - 300) / 500) : 1;
    const flicker = 0.7 + 0.3 * Math.sin(age * 0.15);
    const opacity = baseOpacity * flicker;
    const fromPx = gridToPixel({ x: laser.fromX, y: laser.fromY }, geo);
    const toPx = gridToPixel({ x: laser.toX, y: laser.toY }, geo);
    const growProgress = Math.min(1, age / 200);
    const currentToX = fromPx.x + (toPx.x - fromPx.x) * growProgress;
    const currentToY = fromPx.y + (toPx.y - fromPx.y) * growProgress;

    ctx.strokeStyle = laser.color;
    ctx.lineWidth = Math.max(6 * geo.dpr, geo.cell * 0.28);
    ctx.globalAlpha = opacity * 0.55;
    ctx.shadowColor = laser.color;
    ctx.shadowBlur = Math.max(15 * geo.dpr, geo.cell * 0.6);
    ctx.beginPath();
    ctx.moveTo(fromPx.x, fromPx.y);
    ctx.lineTo(currentToX, currentToY);
    ctx.stroke();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(2 * geo.dpr, geo.cell * 0.08);
    ctx.globalAlpha = opacity;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(fromPx.x, fromPx.y);
    ctx.lineTo(currentToX, currentToY);
    ctx.stroke();

    const boltProgress = Math.min(1, age / 350);
    if (boltProgress < 1) {
      const bx = fromPx.x + (toPx.x - fromPx.x) * boltProgress;
      const by = fromPx.y + (toPx.y - fromPx.y) * boltProgress;
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = laser.color;
      ctx.shadowBlur = 12 * geo.dpr;
      ctx.globalAlpha = baseOpacity;
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(5 * geo.dpr, geo.cell * 0.22), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    if (age > 350) {
      const flashAge = age - 350;
      const flashProgress = Math.min(1, flashAge / 300);
      const flashOpacity = (1 - flashProgress) * baseOpacity;
      const flashRadius = flashProgress * geo.cell * 1.6;
      ctx.strokeStyle = laser.color;
      ctx.lineWidth = Math.max(2.5 * geo.dpr, geo.cell * 0.1);
      ctx.globalAlpha = flashOpacity;
      ctx.beginPath();
      ctx.arc(toPx.x, toPx.y, flashRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = flashOpacity * 0.4;
      ctx.beginPath();
      ctx.arc(toPx.x, toPx.y, flashRadius * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function turretAngle(token: Token): number {
  return token.team === "red" ? -Math.PI / 2 : Math.PI / 2;
}

function eventToGrid(event: Pick<MouseEvent | Touch, "clientX" | "clientY">): { x: number; y: number } {
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

function showPersistentBannerOnly(): void {
  if (!state?.gameOver) return;
  const outcome = state.winner ?? "draw";
  endGame.overlay.classList.remove("active");
  endGame.container.classList.remove("winner-red", "winner-blue", "winner-draw");
  endGame.container.classList.add(`winner-${outcome}`);
  endGame.banner.className = `end-game-banner active banner-${outcome} no-delay`;
  endGame.bannerText.textContent = outcome === "draw" ? "Draw" : `${TEAM[outcome].name} Team Won`;
}

function send(message: ClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function bindTouchControls(): void {
  const swipeTarget = endGame.container;
  let swipeOverlay = document.querySelector<HTMLElement>("#swipeOverlay");
  if (!swipeOverlay) {
    swipeOverlay = document.createElement("div");
    swipeOverlay.id = "swipeOverlay";
    swipeOverlay.className = "swipe-overlay";
    document.body.appendChild(swipeOverlay);
  }

  swipeTarget.addEventListener("touchstart", (event) => {
    if (!state || replaying || !canTouchMove()) return;
    const touch = event.touches[0];
    if (!touch) return;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    isSwiping = true;
    draggedMove = null;
    longTouchActive = false;
    window.clearTimeout(longTouchTimer);

    if (!state.gameOver) {
      longTouchTimer = window.setTimeout(() => {
        if (!isSwiping || !state || !canMoveNow()) return;
        const keepSpeedMove = keepSpeedMoveForActiveToken();
        if (!keepSpeedMove) return;
        longTouchActive = true;
        navigator.vibrate?.(40);
        submitMove(keepSpeedMove);
        isSwiping = false;
      }, LONG_TOUCH_MS);
    }
  });

  swipeTarget.addEventListener("touchmove", (event) => {
    if (!isSwiping || !state) return;
    if (event.cancelable) event.preventDefault();
    const touch = event.touches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    const dist = Math.hypot(dx, dy);

    if (dist > 10) {
      window.clearTimeout(longTouchTimer);
      longTouchTimer = 0;
    }

    if (state.gameOver) {
      if (dist >= 10 && Math.abs(dy) > Math.abs(dx)) {
        swipeOverlay?.classList.add("visible");
        if (swipeOverlay) swipeOverlay.textContent = dy > 0 ? "Swipe for New Game" : "Swipe for Replay";
      }
      return;
    }

    const move = swipeMoveFromDelta(dx, dy, dist);
    if (move && (!draggedMove || draggedMove.x !== move.x || draggedMove.y !== move.y)) {
      draggedMove = move;
      draw();
    } else if (!move && draggedMove) {
      draggedMove = null;
      draw();
    }
  }, { passive: false });

  swipeTarget.addEventListener("touchend", (event) => {
    window.clearTimeout(longTouchTimer);
    longTouchTimer = 0;

    if (longTouchActive) {
      longTouchActive = false;
      return;
    }
    if (!isSwiping || !state) return;
    isSwiping = false;
    swipeOverlay?.classList.remove("visible");
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    const dist = Math.hypot(dx, dy);

    if (state.gameOver) {
      if (dist >= 30 && Math.abs(dy) > Math.abs(dx)) {
        if (dy > 0) newGameAction();
        else startReplay();
      }
      return;
    }

    if (dist < 15) {
      const move = moveAtPoint(eventToGrid(touch));
      if (move) {
        if (event.cancelable) event.preventDefault();
        submitMove(move);
      }
    } else if (draggedMove) {
      if (event.cancelable) event.preventDefault();
      submitMove(draggedMove);
    }

    draggedMove = null;
    draw();
  });

  swipeTarget.addEventListener("touchcancel", () => {
    isSwiping = false;
    longTouchActive = false;
    window.clearTimeout(longTouchTimer);
    longTouchTimer = 0;
    draggedMove = null;
    swipeOverlay?.classList.remove("visible");
    draw();
  });
}

function keepSpeedMoveForActiveToken(): Move | null {
  if (!state) return null;
  const token = activeToken(state);
  if (!token) return null;
  const anchor = token.type === "plane" ? { x: token.x + token.vx, y: token.y + token.vy } : token;
  return legalMoves(state, token).find((move) => move.x === anchor.x && move.y === anchor.y) ?? null;
}

function canTouchMove(): boolean {
  if (!state) return false;
  if (state.gameOver) return mode !== "network" || history.length >= 2;
  return canMoveNow();
}

function swipeMoveFromDelta(dx: number, dy: number, dist: number): Move | null {
  if (!state || dist < 30) return null;
  const token = activeToken(state);
  if (!token) return null;
  const anchor = token.type === "plane" ? { x: token.x + token.vx, y: token.y + token.vy } : token;
  const angle = Math.atan2(-dy, dx);
  const octant = Math.round(angle / (Math.PI / 4));
  const offsets: Record<number, { dx: number; dy: number }> = {
    0: { dx: 1, dy: 0 },
    1: { dx: 1, dy: 1 },
    2: { dx: 0, dy: 1 },
    3: { dx: -1, dy: 1 },
    4: { dx: -1, dy: 0 },
    [-4]: { dx: -1, dy: 0 },
    [-3]: { dx: -1, dy: -1 },
    [-2]: { dx: 0, dy: -1 },
    [-1]: { dx: 1, dy: -1 },
  };
  const offset = offsets[octant] ?? { dx: 0, dy: 0 };
  return highlightedMoves.find((move) => move.x === anchor.x + offset.dx && move.y === anchor.y + offset.dy) ?? null;
}

function moveAtPoint(point: { x: number; y: number }): Move | null {
  return highlightedMoves.find((candidate) => candidate.x === point.x && candidate.y === point.y) ?? null;
}

function addEffectsFromTransition(before: GameState, after: GameState, eliminatedIds: string[]): void {
  const born = performance.now();
  for (const id of eliminatedIds) {
    const beforeToken = before.tokens.find((token) => token.id === id);
    const afterToken = after.tokens.find((token) => token.id === id) ?? beforeToken;
    if (!beforeToken || !afterToken) continue;
    explosions.push({ x: afterToken.x, y: afterToken.y, color: TEAM[beforeToken.team].color, born });
    const shot = inferShot(before, after, beforeToken);
    if (shot) lasers.push({ ...shot, born });
  }
  if (eliminatedIds.length > 0) scheduleEffectsDraw();
}

function inferShot(before: GameState, after: GameState, target: Token): Omit<LaserEffect, "born"> | null {
  const moverBefore = before.activeId ? before.tokens.find((token) => token.id === before.activeId) : null;
  const moverAfter = moverBefore ? after.tokens.find((token) => token.id === moverBefore.id) : null;
  if (moverBefore && moverAfter && moverAfter.id !== target.id && moverAfter.alive && moverAfter.type === "plane" && moverAfter.team !== target.team) {
    if (distanceLInf(moverAfter, target) <= HIT_RADIUS) {
      return { fromX: moverAfter.x, fromY: moverAfter.y, toX: target.x, toY: target.y, color: TEAM[moverAfter.team].color };
    }
  }

  if (target.type === "plane") {
    const turret = after.tokens.find((token) => (
      token.alive
      && token.type === "turret"
      && token.team !== target.team
      && distanceManhattan(token, target) <= TURRET_RADIUS
      && !pathIntersectsObstaclesOpenInState(after, token, target)
    ));
    if (turret) return { fromX: turret.x, fromY: turret.y, toX: target.x, toY: target.y, color: TEAM[turret.team].color };
  }

  return null;
}

function eliminatedBetween(before: GameState, after: GameState): string[] {
  return before.tokens
    .filter((token) => token.alive && !after.tokens.find((afterToken) => afterToken.id === token.id)?.alive)
    .map((token) => token.id);
}

function clearEffects(): void {
  explosions = [];
  lasers = [];
  if (effectsFrame) {
    cancelAnimationFrame(effectsFrame);
    effectsFrame = 0;
  }
}

function scheduleEffectsDraw(): void {
  if (effectsFrame) return;
  effectsFrame = requestAnimationFrame(() => {
    effectsFrame = 0;
    draw();
  });
}

function distanceLInf(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function distanceManhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function parseObstacles(): Array<{ cx: number; cy: number }> {
  if (!state) return [];
  return state.obstacles.map((key) => {
    const [cx = 0, cy = 0] = key.split(",").map(Number);
    return { cx, cy };
  });
}

function inside(point: { x: number; y: number }, isPlane = false): boolean {
  if (!state) return false;
  if (isPlane) return point.x > 0 && point.y > 0 && point.x < state.width && point.y < state.height;
  return point.x >= 0 && point.y >= 0 && point.x <= state.width && point.y <= state.height;
}

function pathIntersectsObstaclesFast(
  start: { x: number; y: number },
  end: { x: number; y: number },
  parsedObstacles: Array<{ cx: number; cy: number }>,
): boolean {
  if (parsedObstacles.length === 0) return false;
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  for (const obstacle of parsedObstacles) {
    if (obstacle.cx + 1 < minX || obstacle.cx > maxX || obstacle.cy + 1 < minY || obstacle.cy > maxY) continue;
    if (segmentIntersectsCell(start, end, obstacle.cx, obstacle.cy, true)) return true;
  }
  return false;
}

function pathIntersectsObstaclesOpen(start: { x: number; y: number }, end: { x: number; y: number }): boolean {
  return parseObstacles().some((obstacle) => segmentIntersectsCell(start, end, obstacle.cx, obstacle.cy, false));
}

function pathIntersectsObstaclesOpenInState(game: GameState, start: { x: number; y: number }, end: { x: number; y: number }): boolean {
  return game.obstacles.some((key) => {
    const [cx = 0, cy = 0] = key.split(",").map(Number);
    return segmentIntersectsCell(start, end, cx, cy, false);
  });
}

function segmentIntersectsCell(
  start: { x: number; y: number },
  end: { x: number; y: number },
  cx: number,
  cy: number,
  closed: boolean,
): boolean {
  const range = segmentIntersectionRange(start, end, cx, cy);
  if (!range) return false;
  return closed ? range[0] <= range[1] : range[0] < range[1];
}

function segmentIntersectionRange(
  start: { x: number; y: number },
  end: { x: number; y: number },
  cx: number,
  cy: number,
): [number, number] | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let txMin = -Infinity;
  let txMax = Infinity;
  if (dx === 0) {
    if (start.x < cx || start.x > cx + 1) return null;
  } else {
    const t1 = (cx - start.x) / dx;
    const t2 = (cx + 1 - start.x) / dx;
    txMin = Math.min(t1, t2);
    txMax = Math.max(t1, t2);
  }

  let tyMin = -Infinity;
  let tyMax = Infinity;
  if (dy === 0) {
    if (start.y < cy || start.y > cy + 1) return null;
  } else {
    const t1 = (cy - start.y) / dy;
    const t2 = (cy + 1 - start.y) / dy;
    tyMin = Math.min(t1, t2);
    tyMax = Math.max(t1, t2);
  }

  const tStart = Math.max(txMin, tyMin, 0);
  const tEnd = Math.min(txMax, tyMax, 1);
  return tStart <= tEnd ? [tStart, tEnd] : null;
}

function pointOnSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): boolean {
  if (point.x === start.x && point.y === start.y) return false;
  const crossProduct = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(crossProduct) > 0.000001) return false;
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hasKeyboard(): boolean {
  return !window.matchMedia("(pointer: coarse)").matches;
}

window.addEventListener("resize", draw);
