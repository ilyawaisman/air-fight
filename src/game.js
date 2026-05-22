const canvas = document.querySelector("#board");
const ctx = canvas.getContext("2d");

const controls = {
  width: document.querySelector("#fieldWidth"),
  height: document.querySelector("#fieldHeight"),
  planes: document.querySelector("#planeCount"),
  turrets: document.querySelector("#turretCount"),
  metric: document.querySelector("#metric"),
  blueControl: document.querySelector("#blueControl"),
  newGame: document.querySelector("#newGame"),
  replay: document.querySelector("#replay"),
};

const labels = {
  turn: document.querySelector("#turnLabel"),
  moving: document.querySelector("#moveLabel"),
  velocity: document.querySelector("#velocityLabel"),
  redAlive: document.querySelector("#redAlive"),
  blueAlive: document.querySelector("#blueAlive"),
  message: document.querySelector("#message"),
};

const TEAM = {
  red: { color: "#d43d3d", pale: "rgba(212, 61, 61, 0.2)", name: "Red" },
  blue: { color: "#2563c7", pale: "rgba(37, 99, 199, 0.2)", name: "Blue" },
};

const HIT_RADIUS = 1;
const TURRET_RADIUS = 5;
const TRAIL_DECAY = 0.9;
const REPLAY_STEP_MS = 260;
const REPLAY_ANIMATION_MS = 220;

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

let state;
let replayTimer = 0;
let replayFrame = null;
let replayAnimationFrame = null;
let aiTimer = 0;

function newState() {
  const width = clamp(Number(controls.width.value) || 24, 12, 80);
  const height = clamp(Number(controls.height.value) || 48, 16, 96);
  controls.width.value = width;
  controls.height.value = height;

  const planeCount = Number(controls.planes.value);
  const turretCount = Number(controls.turrets.value);
  const tokens = [];
  let id = 1;

  for (const team of ["red", "blue"]) {
    const planeY = team === "red" ? 2 : height - 2;
    const turretY = team === "red" ? 0 : height;
    for (let i = 0; i < planeCount; i += 1) {
      const x = evenPoint(i, planeCount, width);
      tokens.push({
        id: `p${id++}`,
        type: "plane",
        team,
        x,
        y: planeY,
        vx: 0,
        vy: 0,
        history: [{ x, y: planeY }],
        alive: true,
      });
    }

    for (let i = 0; i < turretCount; i += 1) {
      tokens.push({
        id: `t${id++}`,
        type: "turret",
        team,
        x: turretPoint(i, turretCount, width),
        y: turretY,
        vx: 0,
        vy: 0,
        alive: true,
      });
    }
  }

  return {
    width,
    height,
    metric: controls.metric.value,
    tokens,
    turn: "red",
    activeId: null,
    moves: [],
    explosions: [],
    gameOver: false,
    replaying: false,
    aiTeam: controls.blueControl.value === "computer" ? "blue" : null,
    aiThinking: false,
  };
}

function evenPoint(index, count, width) {
  return clamp(Math.round(((index + 1) * width) / (count + 1)), 0, width);
}

function turretPoint(index, count, width) {
  const center = width / 2;
  if (count === 1) return Math.round(center);
  return clamp(Math.round(center + (index === 0 ? -2 : 2)), 0, width);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function activeToken() {
  if (!state || state.gameOver) return null;
  if (!state.activeId) state.activeId = nextTokenId(state.turn);
  return state.tokens.find((token) => token.id === state.activeId && token.alive) || null;
}

function nextTokenId(team) {
  const candidate = state.tokens.find((token) => token.team === team && token.alive && !token.movedThisTurn);
  if (candidate) return candidate.id;

  for (const token of state.tokens) {
    if (token.team === team) token.movedThisTurn = false;
  }

  state.turn = team === "red" ? "blue" : "red";
  const next = state.tokens.find((token) => token.team === state.turn && token.alive);
  return next ? next.id : null;
}

function legalMoves(token) {
  if (!token) return [];
  const anchor = token.type === "plane"
    ? { x: token.x + token.vx, y: token.y + token.vy }
    : { x: token.x, y: token.y };
  const moves = [];

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const move = {
        x: anchor.x + dx,
        y: anchor.y + dy,
        ax: token.type === "plane" ? dx : 0,
        ay: token.type === "plane" ? dy : 0,
      };
      if (token.type !== "turret" || inside(move)) {
        moves.push(move);
      }
    }
  }

  return moves;
}

function moveToken(destination) {
  if (state.gameOver || state.replaying) return;
  const token = activeToken();
  if (!token) return;

  const move = legalMoves(token).find((item) => item.x === destination.x && item.y === destination.y);
  if (!move) {
    labels.message.textContent = "Choose one of the highlighted points.";
    return;
  }

  const before = snapshotTokens();
  const start = { x: token.x, y: token.y };
  token.x = move.x;
  token.y = move.y;
  if (token.type === "plane") {
    token.vx += move.ax;
    token.vy += move.ay;
    if (outside(token)) {
      smashPlaneAtBoundary(token, start, move);
      token.boundaryCrash = true;
    } else {
      token.history.push({ x: token.x, y: token.y });
    }
  }
  token.movedThisTurn = true;

  const eliminated = resolveCombat(token);
  const after = snapshotTokens();
  const moveRecord = {
    before,
    after,
    tokenId: token.id,
    eliminated,
    turn: state.turn,
    gameOver: false,
  };
  state.moves.push(moveRecord);

  if (!token.alive) {
    labels.message.textContent = `${TEAM[token.team].name} ${token.type} was eliminated.`;
  } else if (eliminated.length > 0) {
    labels.message.textContent = `${TEAM[token.team].name} scored a hit.`;
  } else {
    labels.message.textContent = "Choose one highlighted point.";
  }

  checkWin();
  moveRecord.gameOver = state.gameOver;

  if (!state.gameOver) {
    state.activeId = nextTokenId(state.turn);
    resolveForcedCrashes();
  }
  updateStatus();
  updateReplayButton();
  draw();
  scheduleComputerMove();
}

function resolveCombat(mover) {
  const eliminated = [];

  if (mover.type === "plane" && mover.boundaryCrash) {
    eliminate(mover, eliminated);
    delete mover.boundaryCrash;
  } else if (mover.type === "plane" && outside(mover)) {
    smashPlaneAtBoundary(mover, lastHistoryPoint(mover), mover);
    eliminate(mover, eliminated);
  }

  resolvePlaneStackCollisions(eliminated);

  if (mover.alive && mover.type === "plane") {
    for (const target of state.tokens) {
      if (!target.alive || target.team === mover.team) continue;
      if (distance(mover, target) <= HIT_RADIUS) eliminate(target, eliminated);
    }
  }

  for (const plane of state.tokens) {
    if (!plane.alive || plane.type !== "plane") continue;
    for (const turret of state.tokens) {
      if (!turret.alive || turret.type !== "turret" || turret.team === plane.team) continue;
      if (distance(plane, turret) <= TURRET_RADIUS) {
        eliminate(plane, eliminated);
        break;
      }
    }
  }

  return eliminated;
}

function resolvePlaneStackCollisions(eliminated) {
  const groups = new Map();

  for (const plane of state.tokens) {
    if (!plane.alive || plane.type !== "plane" || !isGridPoint(plane)) continue;
    const key = `${plane.x},${plane.y}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(plane);
  }

  for (const planes of groups.values()) {
    if (planes.length < 2) continue;
    for (const plane of planes) eliminate(plane, eliminated);
  }
}

function resolveForcedCrashes() {
  let changed = true;

  while (changed && !state.gameOver) {
    changed = false;
    const token = activeToken();
    if (!token || token.type !== "plane") return;

    const hasInsideMove = legalMoves(token).some((move) => inside(move));
    if (hasInsideMove) return;

    const before = snapshotTokens();
    const start = { x: token.x, y: token.y };
    const intended = { x: token.x + token.vx, y: token.y + token.vy };
    smashPlaneAtBoundary(token, start, intended);
    token.movedThisTurn = true;

    const eliminated = [];
    eliminate(token, eliminated);
    const after = snapshotTokens();
    const moveRecord = {
      before,
      after,
      tokenId: token.id,
      eliminated,
      forced: true,
      turn: state.turn,
      gameOver: false,
    };
    state.moves.push(moveRecord);
    labels.message.textContent = `${TEAM[token.team].name} plane had no in-field move and crashed on the boundary.`;

    checkWin();
    moveRecord.gameOver = state.gameOver;

    if (!state.gameOver) state.activeId = nextTokenId(state.turn);
    changed = true;
  }
}

function eliminate(token, eliminated) {
  if (!token.alive) return;
  token.alive = false;
  eliminated.push(token.id);
  addExplosion(token.x, token.y, TEAM[token.team].color);
}

function smashPlaneAtBoundary(token, start, end) {
  const impact = boundaryImpactPoint(start, end);
  token.x = impact.x;
  token.y = impact.y;

  const last = lastHistoryPoint(token);
  if (!last || last.x !== impact.x || last.y !== impact.y) {
    token.history.push({ x: impact.x, y: impact.y });
  }
}

function boundaryImpactPoint(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const candidates = [];
  const maxX = state.width;
  const maxY = state.height;

  if (dx !== 0) {
    candidates.push((0 - start.x) / dx, (maxX - start.x) / dx);
  }
  if (dy !== 0) {
    candidates.push((0 - start.y) / dy, (maxY - start.y) / dy);
  }

  for (const t of candidates.filter((value) => value >= 0 && value <= 1).sort((a, b) => a - b)) {
    const point = { x: start.x + dx * t, y: start.y + dy * t };
    if (insideBoundary(point)) return point;
  }

  return nearestBoundaryPoint(end);
}

function nearestBoundaryPoint(point) {
  const x = clamp(point.x, 0, state.width);
  const y = clamp(point.y, 0, state.height);
  const distances = [
    { x: 0, y, d: Math.abs(x - 0) },
    { x: state.width, y, d: Math.abs(x - state.width) },
    { x, y: 0, d: Math.abs(y - 0) },
    { x, y: state.height, d: Math.abs(y - state.height) },
  ];
  distances.sort((a, b) => a.d - b.d);
  return { x: distances[0].x, y: distances[0].y };
}

function lastHistoryPoint(token) {
  return token.history && token.history.length ? token.history[token.history.length - 1] : { x: token.x, y: token.y };
}

function outside(token) {
  return token.x < 0 || token.y < 0 || token.x > state.width || token.y > state.height;
}

function inside(point) {
  return point.x >= 0 && point.y >= 0 && point.x <= state.width && point.y <= state.height;
}

function isGridPoint(point) {
  return Number.isInteger(point.x) && Number.isInteger(point.y);
}

function insideBoundary(point) {
  const epsilon = 0.000001;
  return point.x >= -epsilon
    && point.y >= -epsilon
    && point.x <= state.width + epsilon
    && point.y <= state.height + epsilon;
}

function distance(a, b) {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return state.metric === "taxicab" ? dx + dy : Math.max(dx, dy);
}

function checkWin() {
  const redTokens = state.tokens.some((token) => token.team === "red" && token.alive);
  const blueTokens = state.tokens.some((token) => token.team === "blue" && token.alive);
  const redPlanes = state.tokens.some((token) => token.team === "red" && token.type === "plane" && token.alive);
  const bluePlanes = state.tokens.some((token) => token.team === "blue" && token.type === "plane" && token.alive);

  if (!redTokens || !blueTokens) {
    state.gameOver = true;
    state.activeId = null;
    if (redTokens && !blueTokens) labels.message.textContent = "Red wins.";
    else if (blueTokens && !redTokens) labels.message.textContent = "Blue wins.";
    else labels.message.textContent = "Both teams are gone.";
  } else if (!redPlanes && !bluePlanes) {
    state.gameOver = true;
    state.activeId = null;
    labels.message.textContent = "No planes remain.";
  }
}

function snapshotTokens() {
  return state.tokens.map((token) => ({
    ...token,
    history: token.history ? token.history.map((point) => ({ ...point })) : undefined,
  }));
}

function restoreSnapshot(snapshot) {
  state.tokens = snapshot.map((token) => ({
    ...token,
    history: token.history ? token.history.map((point) => ({ ...point })) : undefined,
  }));
}

function addExplosion(x, y, color) {
  state.explosions.push({ x, y, color, born: performance.now() });
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

  const padding = 28 * dpr;
  const cell = Math.min((width - padding * 2) / state.width, (height - padding * 2) / state.height);
  const gridWidth = cell * state.width;
  const gridHeight = cell * state.height;
  return {
    dpr,
    cell,
    left: (width - gridWidth) / 2,
    top: (height - gridHeight) / 2,
    width,
    height,
  };
}

function gridToPixel(point, geo) {
  return {
    x: geo.left + point.x * geo.cell,
    y: geo.top + (state.height - point.y) * geo.cell,
  };
}

function eventToGrid(event) {
  const geo = boardGeometry();
  const rect = canvas.getBoundingClientRect();
  const px = (event.clientX - rect.left) * geo.dpr;
  const py = (event.clientY - rect.top) * geo.dpr;
  return {
    x: Math.round((px - geo.left) / geo.cell),
    y: Math.round(state.height - (py - geo.top) / geo.cell),
  };
}

function draw() {
  if (!state) return;
  const geo = boardGeometry();
  ctx.clearRect(0, 0, geo.width, geo.height);
  drawPaper(geo);
  drawTrajectories(geo);
  drawHighlights(geo);
  drawTokens(geo);
  drawExplosions(geo);

  if (state.explosions.length) {
    replayFrame = requestAnimationFrame(draw);
  }
}

function drawPaper(geo) {
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

function drawTrajectories(geo) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const token of state.tokens) {
    if (token.type !== "plane" || !token.history || token.history.length < 2) continue;

    const baseLineAlpha = token.alive ? 0.62 : 0.38;
    const basePointAlpha = token.alive ? 0.48 : 0.28;
    ctx.lineWidth = Math.max(2 * geo.dpr, geo.cell * 0.14);

    for (let i = 1; i < token.history.length; i += 1) {
      const from = gridToPixel(token.history[i - 1], geo);
      const to = gridToPixel(token.history[i], geo);
      const age = token.history.length - 1 - i;
      ctx.strokeStyle = TEAM[token.team].color;
      ctx.globalAlpha = baseLineAlpha * Math.pow(TRAIL_DECAY, age);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }

    token.history.forEach((point, index) => {
      const p = gridToPixel(point, geo);
      ctx.fillStyle = TEAM[token.team].color;
      ctx.globalAlpha = basePointAlpha * Math.pow(TRAIL_DECAY, token.history.length - 1 - index);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2.5 * geo.dpr, geo.cell * 0.11), 0, Math.PI * 2);
      ctx.fill();
    });
  }

  ctx.restore();
}

function drawHighlights(geo) {
  const token = activeToken();
  if (!token || state.replaying) return;
  const moves = legalMoves(token);
  const anchor = token.type === "plane"
    ? { x: token.x + token.vx, y: token.y + token.vy }
    : { x: token.x, y: token.y };

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontSize = Math.max(9 * geo.dpr, geo.cell * 0.35);
  ctx.font = `600 ${fontSize}px sans-serif`;

  for (const move of moves) {
    const p = gridToPixel(move, geo);
    ctx.fillStyle = TEAM[token.team].pale;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(5 * geo.dpr, geo.cell * 0.35), 0, Math.PI * 2);
    ctx.fill();

    const dx = move.x - anchor.x;
    const dy = move.y - anchor.y;
    let keyLetter = "";
    for (const val of Object.values(KEY_MAP)) {
      if (val.dx === dx && val.dy === dy) {
        keyLetter = val.char;
        break;
      }
    }

    if (keyLetter) {
      ctx.fillStyle = TEAM[token.team].color;
      ctx.fillText(keyLetter, p.x, p.y);
    }
  }

  const p = gridToPixel(anchor, geo);
  ctx.strokeStyle = TEAM[token.team].color;
  ctx.lineWidth = 2 * geo.dpr;
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(7 * geo.dpr, geo.cell * 0.45), 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function drawTokens(geo) {
  for (const token of state.tokens) {
    if (!token.alive || outside(token)) continue;
    const p = gridToPixel(token, geo);
    if (token.type === "plane") drawPlane(p, token, geo);
    else drawTurret(p, token, geo);
  }
}

function drawPlane(p, token, geo) {
  const color = TEAM[token.team].color;
  const size = Math.max(10 * geo.dpr, geo.cell * 0.52);
  const angle = token.vx !== 0 || token.vy !== 0
    ? Math.atan2(-token.vy, token.vx)
    : token.team === "red" ? -Math.PI / 2 : Math.PI / 2;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5 * geo.dpr;
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.65, -size * 0.5);
  ctx.lineTo(-size * 0.28, 0);
  ctx.lineTo(-size * 0.65, size * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawTurret(p, token, geo) {
  const color = TEAM[token.team].color;
  const size = Math.max(9 * geo.dpr, geo.cell * 0.45);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.fillStyle = color;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5 * geo.dpr;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4 * geo.dpr;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, token.team === "red" ? -size * 1.15 : size * 1.15);
  ctx.stroke();
  ctx.restore();
}

function drawExplosions(geo) {
  const now = performance.now();
  state.explosions = state.explosions.filter((boom) => now - boom.born < 620);

  for (const boom of state.explosions) {
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

function updateStatus() {
  const token = activeToken();
  labels.turn.textContent = state.gameOver ? "Finished" : TEAM[state.turn].name;
  labels.moving.textContent = token ? `${TEAM[token.team].name} ${token.type}` : "None";
  labels.velocity.textContent = token && token.type === "plane" ? `(${token.vx}, ${token.vy})` : "(0, 0)";
  labels.redAlive.textContent = aliveSummary("red");
  labels.blueAlive.textContent = aliveSummary("blue");
}

function updateReplayButton() {
  controls.replay.disabled = state.replaying || state.moves.length === 0;
}

function aliveSummary(team) {
  const planes = state.tokens.filter((token) => token.team === team && token.type === "plane" && token.alive).length;
  const turrets = state.tokens.filter((token) => token.team === team && token.type === "turret" && token.alive).length;
  return `${planes} planes, ${turrets} turrets`;
}

function scheduleComputerMove() {
  if (state.gameOver || state.replaying || state.aiThinking || !state.aiTeam) return;

  const token = activeToken();
  if (!token || token.team !== state.aiTeam) return;

  state.aiThinking = true;
  labels.message.textContent = `Computer is moving ${TEAM[token.team].name} ${token.type}.`;
  draw();

  clearTimeout(aiTimer);
  aiTimer = setTimeout(() => {
    state.aiThinking = false;
    const current = activeToken();
    if (!current || current.team !== state.aiTeam || state.gameOver || state.replaying) return;

    const move = chooseComputerMove(current);
    if (move) moveToken(move);
  }, 420);
}

function chooseComputerMove(token) {
  const moves = legalMoves(token);
  const insideMoves = moves.filter((move) => inside(move));
  const candidates = insideMoves.length ? insideMoves : moves;

  let best = candidates[0];
  let bestScore = -Infinity;

  for (const move of candidates) {
    const score = token.type === "plane"
      ? scoreComputerPlaneMove(token, move)
      : scoreComputerTurretMove(token, move);

    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }

  return best;
}

function scoreComputerPlaneMove(token, move) {
  const enemies = state.tokens.filter((target) => target.alive && target.team !== token.team);
  const enemyTurrets = enemies.filter((target) => target.type === "turret");
  let score = inside(move) ? 0 : -100000;

  for (const target of enemies) {
    const d = distancePoints(move, target);
    if (d <= HIT_RADIUS) score += target.type === "turret" ? 12000 : 8000;
    score += 80 / (d + 1);
  }

  for (const turret of enemyTurrets) {
    if (distancePoints(move, turret) <= TURRET_RADIUS) score -= 6500;
  }

  const nextVx = token.vx + move.ax;
  const nextVy = token.vy + move.ay;
  score -= 0.08 * (nextVx * nextVx + nextVy * nextVy);
  return score;
}

function scoreComputerTurretMove(token, move) {
  if (!inside(move)) return -100000;
  const enemyPlanes = state.tokens.filter((target) => target.alive && target.team !== token.team && target.type === "plane");
  if (!enemyPlanes.length) return 0;

  const nearest = Math.min(...enemyPlanes.map((plane) => distancePoints(move, plane)));
  return -nearest;
}

function distancePoints(a, b) {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return state.metric === "taxicab" ? dx + dy : Math.max(dx, dy);
}

function startReplay() {
  if (!state.moves.length || state.replaying) return;
  clearTimeout(aiTimer);
  cancelAnimationFrame(replayAnimationFrame);
  state.aiThinking = false;

  const savedState = {
    tokens: snapshotTokens(),
    turn: state.turn,
    activeId: state.activeId,
    gameOver: state.gameOver,
    message: labels.message.textContent,
  };

  const moves = [...state.moves];
  state.replaying = true;
  controls.replay.disabled = true;
  controls.newGame.disabled = true;
  labels.message.textContent = "Replaying the fight.";
  restoreSnapshot(moves[0].before);
  state.explosions = [];
  draw();

  let index = 0;
  clearTimeout(replayTimer);
  const showNextMove = () => {
    const move = moves[index];
    state.turn = move.turn;
    state.activeId = move.tokenId;
    state.gameOver = move.gameOver;
    updateStatus();

    animateReplayMove(move, () => {
      index += 1;

      if (index >= moves.length) {
        clearTimeout(replayTimer);
        cancelAnimationFrame(replayAnimationFrame);
        state.replaying = false;

        restoreSnapshot(savedState.tokens);
        state.turn = savedState.turn;
        state.activeId = savedState.activeId;
        state.gameOver = savedState.gameOver;
        labels.message.textContent = savedState.message;

        updateReplayButton();
        controls.newGame.disabled = false;
        updateStatus();
        draw();
        return;
      }

      replayTimer = setTimeout(showNextMove, Math.max(0, REPLAY_STEP_MS - REPLAY_ANIMATION_MS));
    });
  };

  showNextMove();
}

function animateReplayMove(move, done) {
  const started = performance.now();
  const before = move.before;
  const after = move.after;

  const tick = (now) => {
    const progress = Math.min(1, (now - started) / REPLAY_ANIMATION_MS);
    state.tokens = interpolateSnapshots(before, after, progress);
    draw();

    if (progress < 1) {
      replayAnimationFrame = requestAnimationFrame(tick);
      return;
    }

    restoreSnapshot(after);
    for (const id of move.eliminated) {
      const token = after.find((item) => item.id === id);
      if (token) addExplosion(token.x, token.y, TEAM[token.team].color);
    }
    updateStatus();
    draw();
    done();
  };

  cancelAnimationFrame(replayAnimationFrame);
  replayAnimationFrame = requestAnimationFrame(tick);
}

function interpolateSnapshots(before, after, progress) {
  return after.map((afterToken) => {
    const beforeToken = before.find((token) => token.id === afterToken.id) || afterToken;
    const token = {
      ...afterToken,
      x: beforeToken.x + (afterToken.x - beforeToken.x) * progress,
      y: beforeToken.y + (afterToken.y - beforeToken.y) * progress,
      history: afterToken.history ? afterToken.history.map((point) => ({ ...point })) : undefined,
    };
    if (progress < 1 && beforeToken.alive) token.alive = true;
    return token;
  });
}

function resetGame() {
  clearTimeout(replayTimer);
  clearTimeout(aiTimer);
  cancelAnimationFrame(replayFrame);
  cancelAnimationFrame(replayAnimationFrame);
  state = newState();
  state.activeId = state.tokens.find((token) => token.team === "red" && token.alive)?.id || null;
  labels.message.textContent = "Choose one highlighted point.";
  resolveForcedCrashes();
  updateReplayButton();
  controls.newGame.disabled = false;
  updateStatus();
  draw();
  scheduleComputerMove();
  canvas.focus();
}

canvas.addEventListener("click", (event) => {
  canvas.focus();
  if (!state || state.replaying) return;
  const token = activeToken();
  if (token && token.team === state.aiTeam) {
    labels.message.textContent = "Computer is moving Blue.";
    return;
  }
  moveToken(eventToGrid(event));
});

window.addEventListener("keydown", (event) => {
  if (!state || state.replaying || state.gameOver || state.aiThinking) return;

  // Prevent controls interaction conflicts (e.g. typing in width/height input fields)
  if (
    document.activeElement &&
    (document.activeElement.tagName === "INPUT" ||
     document.activeElement.tagName === "SELECT")
  ) {
    return;
  }

  const token = activeToken();
  if (!token || token.team === state.aiTeam) return;

  // Use event.code for layout independence, with a fallback using event.key
  let offset = KEY_MAP[event.code];
  if (!offset && event.key) {
    const fallbackCode = "Key" + event.key.toUpperCase();
    offset = KEY_MAP[fallbackCode];
  }
  if (!offset) return;

  const moves = legalMoves(token);
  const anchor = token.type === "plane"
    ? { x: token.x + token.vx, y: token.y + token.vy }
    : { x: token.x, y: token.y };

  const targetX = anchor.x + offset.dx;
  const targetY = anchor.y + offset.dy;

  const matchedMove = moves.find((m) => m.x === targetX && m.y === targetY);
  if (matchedMove) {
    event.preventDefault();
    moveToken(matchedMove);
  }
});

controls.newGame.addEventListener("click", resetGame);
controls.replay.addEventListener("click", startReplay);
controls.blueControl.addEventListener("change", resetGame);
window.addEventListener("resize", draw);

resetGame();
