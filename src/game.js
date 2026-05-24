const canvas = document.querySelector("#board");
const ctx = canvas.getContext("2d");

const controls = {
  width: document.querySelector("#fieldWidth"),
  height: document.querySelector("#fieldHeight"),
  planes: document.querySelector("#planeCount"),
  turrets: document.querySelector("#turretCount"),
  obstacles: document.querySelector("#obstacles"),
  metric: document.querySelector("#metric"),
  blueControl: document.querySelector("#blueControl"),
  replaySpeed: document.querySelector("#replaySpeed"),
  mapOption: document.getElementsByName("mapOption"),
  newGame: document.querySelectorAll(".new-game-btn"),
  replay: document.querySelectorAll(".replay-btn"),
};

const labels = {
  turn: document.querySelector("#turnLabel"),
  moving: document.querySelector("#moveLabel"),
  velocity: document.querySelector("#velocityLabel"),
  redAlive: document.querySelector("#redAlive"),
  blueAlive: document.querySelector("#blueAlive"),
  message: document.querySelector("#message"),
  mobileRedStats: document.querySelector("#mobileRedStats"),
  mobileBlueStats: document.querySelector("#mobileBlueStats"),
};

const endGame = {
  container: document.querySelector("#boardContainer"),
  overlay: document.querySelector("#endGameOverlay"),
  overlayTitle: document.querySelector("#overlayTitle"),
  banner: document.querySelector("#endGameBanner"),
  bannerText: document.querySelector("#bannerText"),
};

const TEAM = {
  red: { color: "#d43d3d", pale: "rgba(212, 61, 61, 0.2)", name: "Red" },
  blue: { color: "#2563c7", pale: "rgba(37, 99, 199, 0.2)", name: "Blue" },
};

const HIT_RADIUS = 1;
const TURRET_RADIUS = 5;
const OBSTACLE_CONFIGS = {
  none: { density: 0, minSize: 0, maxSize: 0 },
  big: { density: 3, minSize: 20, maxSize: 40 },
  small: { density: 7.5, minSize: 3, maxSize: 10 },
  any: { density: 6, minSize: 3, maxSize: 40 }
};
const VERSION = "1.3.11";
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
let endGameUITimer = 0;
let savedReplayState = null;
let touchStartX = 0;
let touchStartY = 0;
let isSwiping = false;

function hasKeyboard() {
  return !window.matchMedia("(pointer: coarse)").matches;
}

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

  const startingPoints = [];
  for (const team of ["red", "blue"]) {
    const planeY = team === "red" ? 2 : height - 2;
    const turretY = team === "red" ? 0 : height;
    for (let i = 0; i < planeCount; i += 1) {
      startingPoints.push({ x: evenPoint(i, planeCount, width), y: planeY });
    }
    for (let i = 0; i < turretCount; i += 1) {
      startingPoints.push({ x: turretPoint(i, turretCount, width), y: turretY });
    }
  }

  const isSafeCell = (cx, cy) => {
    return startingPoints.every((pt) => {
      const dx = Math.abs(pt.x - (cx + 0.5));
      const dy = Math.abs(pt.y - (cy + 0.5));
      return Math.max(dx, dy) >= 2.5;
    });
  };

  const isValidObstacleCell = (cx, cy) => {
    if (cx < 3 || cx >= width - 3 || cy < 3 || cy >= height - 3) {
      return false;
    }
    return isSafeCell(cx, cy);
  };

  let obstacles = new Set();
  const obstacleType = controls.obstacles.value;
  const config = OBSTACLE_CONFIGS[obstacleType] || OBSTACLE_CONFIGS.none;
  let mapKept = false;

  // Sync mobile map-option radio to desktop before reading,
  // so the correct value is used regardless of which UI was touched.
  syncMapOptions("mapOptionMobile", "mapOption");
  const mapOpt = Array.from(controls.mapOption).find((r) => r.checked)?.value || "new";

  if (state && state.width === width && state.height === height && state.obstacleType === obstacleType) {
    if (mapOpt === "keep") {
      obstacles = new Set(state.obstacles);
      mapKept = true;
    } else if (mapOpt === "swap" && state.obstacles) {
      for (const key of state.obstacles) {
        const [cx, cy] = key.split(",").map(Number);
        const rx = (width - 1) - cx;
        const ry = (height - 1) - cy;
        obstacles.add(`${rx},${ry}`);
      }
      mapKept = true;
    }
  }

  if (!mapKept && config.density > 0) {
    const totalCells = width * height;
    const expectedBlobs = (config.density * totalCells) / 1000;
    const numBlobs = Math.max(1, Math.round(expectedBlobs + (Math.random() - 0.5) * (expectedBlobs * 0.4)));

    for (let b = 0; b < numBlobs; b += 1) {
      let seed = null;
      for (let attempts = 0; attempts < 150; attempts += 1) {
        const sx = Math.floor(Math.random() * width);
        const sy = Math.floor(Math.random() * height);
        if (!obstacles.has(`${sx},${sy}`) && isValidObstacleCell(sx, sy)) {
          seed = { x: sx, y: sy };
          break;
        }
      }
      if (!seed) continue;

      const blob = new Set([`${seed.x},${seed.y}`]);
      obstacles.add(`${seed.x},${seed.y}`);

      const targetSize = Math.floor(Math.random() * (config.maxSize - config.minSize + 1)) + config.minSize;
      while (blob.size < targetSize) {
        const neighbors = [];
        for (const key of blob) {
          const [cx, cy] = key.split(",").map(Number);
          const dirs = [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }];
          for (const d of dirs) {
            const nx = cx + d.x;
            const ny = cy + d.y;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nkey = `${nx},${ny}`;
              if (!obstacles.has(nkey) && isValidObstacleCell(nx, ny)) {
                neighbors.push(nkey);
              }
            }
          }
        }
        if (neighbors.length === 0) break;
        const chosen = neighbors[Math.floor(Math.random() * neighbors.length)];
        blob.add(chosen);
        obstacles.add(chosen);
      }
    }

    if (!mapKept && obstacles.size > 0) {
      const cells = [];
      let sumX = 0;
      let sumY = 0;
      let minCx = Infinity, maxCx = -Infinity;
      let minCy = Infinity, maxCy = -Infinity;

      for (const key of obstacles) {
        const [cx, cy] = key.split(",").map(Number);
        cells.push({ x: cx, y: cy });
        sumX += cx;
        sumY += cy;
        if (cx < minCx) minCx = cx;
        if (cx > maxCx) maxCx = cx;
        if (cy < minCy) minCy = cy;
        if (cy > maxCy) maxCy = cy;
      }

      const N = cells.length;
      const mx = sumX / N;
      const my = sumY / N;

      const fieldCx = (width - 1) / 2;
      const fieldCy = (height - 1) / 2;

      const minTx = 3 - minCx;
      const maxTx = width - 4 - maxCx;
      const minTy = 3 - minCy;
      const maxTy = height - 4 - maxCy;

      let bestTx = 0;
      let bestTy = 0;
      let minSquareDist = Infinity;

      for (let tx = minTx; tx <= maxTx; tx++) {
        for (let ty = minTy; ty <= maxTy; ty++) {
          let isTxTySafe = true;
          for (let i = 0; i < cells.length; i++) {
            const nx = cells[i].x + tx;
            const ny = cells[i].y + ty;
            if (!isSafeCell(nx, ny)) {
              isTxTySafe = false;
              break;
            }
          }
          if (!isTxTySafe) continue;

          const shiftedMx = mx + tx;
          const shiftedMy = my + ty;
          const dx = shiftedMx - fieldCx;
          const dy = shiftedMy - fieldCy;
          const squareDist = dx * dx + dy * dy;

          if (squareDist < minSquareDist) {
            minSquareDist = squareDist;
            bestTx = tx;
            bestTy = ty;
          }
        }
      }

      if (bestTx !== 0 || bestTy !== 0) {
        obstacles.clear();
        for (let i = 0; i < cells.length; i++) {
          const nx = cells[i].x + bestTx;
          const ny = cells[i].y + bestTy;
          obstacles.add(`${nx},${ny}`);
        }
      }
    }
  }

  return {
    width,
    height,
    metric: controls.metric.value,
    tokens,
    obstacles,
    obstacleType,
    turn: "red",
    activeId: null,
    moves: [],
    explosions: [],
    lasers: [],
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
  if (count === 1) return Math.round(width / 2);
  // Space turrets evenly across the center portion of the field
  return clamp(Math.round(((index + 1) * width) / (count + 1)), 0, width);
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
  state.pendingShots = [];
  const start = { x: token.x, y: token.y };
  token.x = move.x;
  token.y = move.y;
  if (token.type === "plane") {
    token.vx += move.ax;
    token.vy += move.ay;
    if (outside(token)) {
      smashPlaneAtBoundary(token, start, move);
      token.boundaryCrash = true;
    } else if (pathIntersectsObstacles(start, move)) {
      smashPlaneAtObstacle(token, start, move);
      token.obstacleCrash = true;
    } else {
      token.history.push({ x: token.x, y: token.y });
    }
  } else if (token.type === "turret") {
    if (outside(token)) {
      token.boundaryCrash = true;
    } else if (pathIntersectsObstacles(start, move)) {
      token.obstacleCrash = true;
    }
  }
  token.movedThisTurn = true;

  const eliminated = resolveCombat(token, start);
  const after = snapshotTokens();
  const moveRecord = {
    before,
    after,
    tokenId: token.id,
    eliminated,
    shots: [...state.pendingShots],
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

function resolveCombat(mover, start) {
  const eliminated = [];

  // Trajectory-based collisions with other tokens
  for (const target of state.tokens) {
    if (!target.alive || target.id === mover.id) continue;
    if (pointOnSegment(target, start, { x: mover.x, y: mover.y })) {
      eliminate(mover, eliminated);
      eliminate(target, eliminated);
    }
  }

  if (mover.boundaryCrash) {
    eliminate(mover, eliminated);
    delete mover.boundaryCrash;
  } else if (outside(mover)) {
    if (mover.type === "plane") {
      smashPlaneAtBoundary(mover, lastHistoryPoint(mover), mover);
    }
    eliminate(mover, eliminated);
  }

  if (mover.obstacleCrash) {
    eliminate(mover, eliminated);
    delete mover.obstacleCrash;
  } else if (pathIntersectsObstacles(start, { x: mover.x, y: mover.y })) {
    if (mover.type === "plane") {
      smashPlaneAtObstacle(mover, start, { x: mover.x, y: mover.y });
    }
    eliminate(mover, eliminated);
  }

  resolvePlaneStackCollisions(eliminated);

  if (mover.alive && mover.type === "plane") {
    for (const target of state.tokens) {
      if (!target.alive || target.team === mover.team) continue;
      if (distance(mover, target) <= HIT_RADIUS) {
        eliminate(target, eliminated);
        const shot = { fromX: mover.x, fromY: mover.y, toX: target.x, toY: target.y, color: TEAM[mover.team].color };
        if (!state.pendingShots) state.pendingShots = [];
        state.pendingShots.push(shot);
        addLaserShot(shot.fromX, shot.fromY, shot.toX, shot.toY, shot.color);
      }
    }
  }

  for (const plane of state.tokens) {
    if (!plane.alive || plane.type !== "plane") continue;
    for (const turret of state.tokens) {
      if (!turret.alive || turret.type !== "turret" || turret.team === plane.team) continue;
      if (distance(plane, turret) <= TURRET_RADIUS && !pathIntersectsObstaclesOpen(turret, plane)) {
        eliminate(plane, eliminated);
        turret.angle = Math.atan2(-(plane.y - turret.y), plane.x - turret.x);
        const shot = { fromX: turret.x, fromY: turret.y, toX: plane.x, toY: plane.y, color: TEAM[turret.team].color };
        if (!state.pendingShots) state.pendingShots = [];
        state.pendingShots.push(shot);
        addLaserShot(shot.fromX, shot.fromY, shot.toX, shot.toY, shot.color);
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

function isSafePlaneMove(token, start, move) {
  if (!inside(move, true)) return false;
  if (pathIntersectsObstacles(start, move)) return false;
  for (const target of state.tokens) {
    if (target.alive && target.id !== token.id) {
      if (pointOnSegment(target, start, move)) return false;
    }
  }
  return true;
}

function resolveForcedCrashes() {
  let changed = true;

  while (changed && !state.gameOver) {
    changed = false;
    const token = activeToken();
    if (!token || token.type !== "plane") return;

    const start = { x: token.x, y: token.y };
    const hasSafeMove = legalMoves(token).some((move) => isSafePlaneMove(token, start, move));
    if (hasSafeMove) return;

    const before = snapshotTokens();
    const intended = { x: token.x + token.vx, y: token.y + token.vy };

    const boundaryImpact = boundaryImpactPoint(start, intended);
    const obstacleImpact = obstacleImpactPoint(start, intended);
    const dB = distance(start, boundaryImpact);
    const dO = distance(start, obstacleImpact);

    let hitObstacle = false;
    if (pathIntersectsObstacles(start, intended) && dO < dB) {
      smashPlaneAtObstacle(token, start, intended);
      hitObstacle = true;
    } else {
      smashPlaneAtBoundary(token, start, intended);
    }
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
    
    const msg = hitObstacle
      ? `${TEAM[token.team].name} plane had no safe move and crashed into an obstacle.`
      : `${TEAM[token.team].name} plane had no safe move and crashed on the boundary.`;
    labels.message.textContent = msg;

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
  if (token.type === "plane") {
    return token.x <= 0 || token.y <= 0 || token.x >= state.width || token.y >= state.height;
  }
  return token.x < 0 || token.y < 0 || token.x > state.width || token.y > state.height;
}

function inside(point, isPlane = false) {
  if (isPlane) {
    return point.x > 0 && point.y > 0 && point.x < state.width && point.y < state.height;
  }
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

function segmentIntersectsCell(start, end, cx, cy) {
  const x0 = start.x;
  const y0 = start.y;
  const x1 = end.x;
  const y1 = end.y;

  const dx = x1 - x0;
  const dy = y1 - y0;

  let txMin = -Infinity, txMax = Infinity;
  if (dx === 0) {
    if (x0 < cx || x0 > cx + 1) return false;
  } else {
    const t1 = (cx - x0) / dx;
    const t2 = (cx + 1 - x0) / dx;
    txMin = Math.min(t1, t2);
    txMax = Math.max(t1, t2);
  }

  let tyMin = -Infinity, tyMax = Infinity;
  if (dy === 0) {
    if (y0 < cy || y0 > cy + 1) return false;
  } else {
    const t1 = (cy - y0) / dy;
    const t2 = (cy + 1 - y0) / dy;
    tyMin = Math.min(t1, t2);
    tyMax = Math.max(t1, t2);
  }

  const tStart = Math.max(txMin, tyMin, 0);
  const tEnd = Math.min(txMax, tyMax, 1);

  return tStart <= tEnd;
}

function pathIntersectsObstacles(start, end) {
  if (!state.obstacles || !state.obstacles.size) return false;
  for (const key of state.obstacles) {
    const [cx, cy] = key.split(",").map(Number);
    if (segmentIntersectsCell(start, end, cx, cy)) {
      return true;
    }
  }
  return false;
}

function pathIntersectsObstaclesFast(start, end, parsedObstacles) {
  if (!parsedObstacles || !parsedObstacles.length) return false;
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  for (let i = 0; i < parsedObstacles.length; i++) {
    const obs = parsedObstacles[i];
    if (obs.cx + 1 < minX || obs.cx > maxX || obs.cy + 1 < minY || obs.cy > maxY) {
      continue;
    }
    if (segmentIntersectsCell(start, end, obs.cx, obs.cy)) {
      return true;
    }
  }
  return false;
}

function segmentIntersectsCellOpen(start, end, cx, cy) {
  const x0 = start.x;
  const y0 = start.y;
  const x1 = end.x;
  const y1 = end.y;

  const dx = x1 - x0;
  const dy = y1 - y0;

  let txMin = -Infinity, txMax = Infinity;
  if (dx === 0) {
    if (x0 <= cx || x0 >= cx + 1) return false;
  } else {
    const t1 = (cx - x0) / dx;
    const t2 = (cx + 1 - x0) / dx;
    txMin = Math.min(t1, t2);
    txMax = Math.max(t1, t2);
  }

  let tyMin = -Infinity, tyMax = Infinity;
  if (dy === 0) {
    if (y0 <= cy || y0 >= cy + 1) return false;
  } else {
    const t1 = (cy - y0) / dy;
    const t2 = (cy + 1 - y0) / dy;
    tyMin = Math.min(t1, t2);
    tyMax = Math.max(t1, t2);
  }

  const tStart = Math.max(txMin, tyMin, 0);
  const tEnd = Math.min(txMax, tyMax, 1);

  return tStart < tEnd;
}

function pathIntersectsObstaclesOpen(start, end) {
  if (!state.obstacles || !state.obstacles.size) return false;
  for (const key of state.obstacles) {
    const [cx, cy] = key.split(",").map(Number);
    if (segmentIntersectsCellOpen(start, end, cx, cy)) {
      return true;
    }
  }
  return false;
}

function pointOnSegment(p, start, end) {
  // Exclude the segment start point to avoid false collisions
  // when a token begins its move at the same position as another token.
  if (p.x === start.x && p.y === start.y) return false;

  const crossProduct = (p.x - start.x) * (end.y - start.y) - (p.y - start.y) * (end.x - start.x);
  if (Math.abs(crossProduct) > 0.000001) return false;

  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

function obstacleImpactPoint(start, end) {
  if (!state.obstacles || !state.obstacles.size) return end;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let minT = 1.0;
  let found = false;

  for (const key of state.obstacles) {
    const [cx, cy] = key.split(",").map(Number);
    const x0 = start.x;
    const y0 = start.y;

    let txMin = -Infinity, txMax = Infinity;
    if (dx === 0) {
      if (x0 >= cx && x0 <= cx + 1) {
        txMin = -Infinity;
        txMax = Infinity;
      } else continue;
    } else {
      const t1 = (cx - x0) / dx;
      const t2 = (cx + 1 - x0) / dx;
      txMin = Math.min(t1, t2);
      txMax = Math.max(t1, t2);
    }

    let tyMin = -Infinity, tyMax = Infinity;
    if (dy === 0) {
      if (y0 >= cy && y0 <= cy + 1) {
        tyMin = -Infinity;
        tyMax = Infinity;
      } else continue;
    } else {
      const t1 = (cy - y0) / dy;
      const t2 = (cy + 1 - y0) / dy;
      tyMin = Math.min(t1, t2);
      tyMax = Math.max(t1, t2);
    }

    const tStart = Math.max(txMin, tyMin, 0);
    const tEnd = Math.min(txMax, tyMax, 1);

    if (tStart <= tEnd) {
      if (tStart < minT) {
        minT = tStart;
        found = true;
      }
    }
  }

  if (found) {
    return { x: start.x + dx * minT, y: start.y + dy * minT };
  }
  return end;
}

function smashPlaneAtObstacle(token, start, end) {
  const impact = obstacleImpactPoint(start, end);
  token.x = impact.x;
  token.y = impact.y;

  const last = lastHistoryPoint(token);
  if (!last || last.x !== impact.x || last.y !== impact.y) {
    token.history.push({ x: impact.x, y: impact.y });
  }
}

function distance(a, b) {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return state.metric === "taxicab" ? dx + dy : Math.max(dx, dy);
}

function checkWin() {
  if (state.gameOver) return;

  const redPlanes = state.tokens.some((token) => token.team === "red" && token.type === "plane" && token.alive);
  const bluePlanes = state.tokens.some((token) => token.team === "blue" && token.type === "plane" && token.alive);

  let outcome = null;
  if (!redPlanes && !bluePlanes) {
    state.gameOver = true;
    state.activeId = null;
    labels.message.textContent = "No planes remain.";
    outcome = "draw";
  } else if (!bluePlanes) {
    state.gameOver = true;
    state.activeId = null;
    labels.message.textContent = "Red won.";
    outcome = "red";
  } else if (!redPlanes) {
    state.gameOver = true;
    state.activeId = null;
    labels.message.textContent = "Blue won.";
    outcome = "blue";
  }

  if (outcome) {
    clearTimeout(endGameUITimer);
    endGameUITimer = setTimeout(() => {
      if (state && state.gameOver) {
        triggerEndGameUI(outcome);
      }
    }, 900);
  }
}

function triggerEndGameUI(outcome) {
  if (!endGame.container) return;

  hideEndGameUI();

  if (outcome === "red") {
    endGame.overlayTitle.textContent = "Red Wins";
    endGame.overlayTitle.className = "winner-red";
    endGame.bannerText.textContent = "🏆 Red Team Won";
    endGame.banner.className = "end-game-banner active banner-red";
    endGame.container.classList.add("winner-red");
  } else if (outcome === "blue") {
    endGame.overlayTitle.textContent = "Blue Wins";
    endGame.overlayTitle.className = "winner-blue";
    endGame.bannerText.textContent = "🏆 Blue Team Won";
    endGame.banner.className = "end-game-banner active banner-blue";
    endGame.container.classList.add("winner-blue");
  } else {
    endGame.overlayTitle.textContent = "Draw";
    endGame.overlayTitle.className = "winner-draw";
    endGame.bannerText.textContent = "🤝 Draw";
    endGame.banner.className = "end-game-banner active banner-draw";
    endGame.container.classList.add("winner-draw");
  }

  endGame.overlay.classList.add("active");
}

function hideEndGameUI() {
  if (!endGame.container) return;
  endGame.overlay.classList.remove("active");
  endGame.overlayTitle.className = "";
  endGame.overlayTitle.textContent = "";
  endGame.banner.className = "end-game-banner";
  endGame.bannerText.textContent = "";
  endGame.container.classList.remove("winner-red", "winner-blue", "winner-draw");
}

function showPersistentBannerOnly() {
  if (!endGame.container) return;

  const redPlanes = state.tokens.some((token) => token.team === "red" && token.type === "plane" && token.alive);
  const bluePlanes = state.tokens.some((token) => token.team === "blue" && token.type === "plane" && token.alive);

  let outcome = "draw";
  if (!redPlanes || !bluePlanes) {
    if (redPlanes && !bluePlanes) outcome = "red";
    else if (bluePlanes && !redPlanes) outcome = "blue";
  }

  endGame.overlay.classList.remove("active");

  endGame.container.classList.remove("winner-red", "winner-blue", "winner-draw");
  endGame.container.classList.add(`winner-${outcome}`);

  endGame.banner.className = `end-game-banner active banner-${outcome} no-delay`;

  if (outcome === "red") {
    endGame.bannerText.textContent = "🏆 Red Team Won";
  } else if (outcome === "blue") {
    endGame.bannerText.textContent = "🏆 Blue Team Won";
  } else {
    endGame.bannerText.textContent = "🤝 Draw";
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

function addLaserShot(fromX, fromY, toX, toY, color) {
  if (!state.lasers) state.lasers = [];
  state.lasers.push({
    fromX,
    fromY,
    toX,
    toY,
    color,
    born: performance.now(),
  });
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
  cancelAnimationFrame(replayFrame);
  if (!state) return;
  const geo = boardGeometry();
  ctx.clearRect(0, 0, geo.width, geo.height);
  drawPaper(geo);
  drawObstacles(geo);
  drawTrajectories(geo);
  drawHighlights(geo);
  drawLasers(geo);
  drawTokens(geo);
  drawExplosions(geo);

  if (labels.mobileRedStats) {
    labels.mobileRedStats.textContent = `Red: ${aliveSummaryCompact("red")}`;
  }
  if (labels.mobileBlueStats) {
    labels.mobileBlueStats.textContent = `Blue: ${aliveSummaryCompact("blue")}`;
  }

  if (state.explosions.length || (state.lasers && state.lasers.length)) {
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

function drawObstacles(geo) {
  if (!state.obstacles || !state.obstacles.size) return;
  ctx.save();
  ctx.fillStyle = "rgba(71, 85, 105, 0.08)";
  ctx.strokeStyle = "#64748b";
  ctx.lineWidth = 1 * geo.dpr;

  for (const key of state.obstacles) {
    const [cx, cy] = key.split(",").map(Number);
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
    const isDragged = state.draggedMove && state.draggedMove.x === move.x && state.draggedMove.y === move.y;

    ctx.fillStyle = isDragged ? TEAM[token.team].color : TEAM[token.team].pale;
    ctx.globalAlpha = isDragged ? 0.35 : 1.0;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(5 * geo.dpr, geo.cell * 0.35) * (isDragged ? 1.25 : 1), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;

    if (isDragged) {
      ctx.strokeStyle = TEAM[token.team].color;
      ctx.lineWidth = 2.5 * geo.dpr;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(5 * geo.dpr, geo.cell * 0.35) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    const dx = move.x - anchor.x;
    const dy = move.y - anchor.y;
    let keyLetter = "";
    for (const val of Object.values(KEY_MAP)) {
      if (val.dx === dx && val.dy === dy) {
        keyLetter = val.char;
        break;
      }
    }

    if (keyLetter && token.team !== state.aiTeam && hasKeyboard()) {
      ctx.fillStyle = TEAM[token.team].color;
      ctx.fillText(keyLetter, p.x, p.y);
    }
  }

  const p = gridToPixel(anchor, geo);

  if (token.type === "plane") {
    const tokenPos = gridToPixel(token, geo);
    ctx.strokeStyle = TEAM[token.team].color;
    ctx.lineWidth = 1.2 * geo.dpr;
    ctx.globalAlpha = 0.45;
    ctx.setLineDash([4 * geo.dpr, 3 * geo.dpr]);
    ctx.beginPath();
    ctx.moveTo(tokenPos.x, tokenPos.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1.0;
  }

  ctx.strokeStyle = TEAM[token.team].color;
  ctx.lineWidth = 2 * geo.dpr;
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(7 * geo.dpr, geo.cell * 0.45), 0, Math.PI * 2);
  ctx.stroke();

  if (state.draggedMove) {
    const fromPos = gridToPixel(anchor, geo);
    const toPos = gridToPixel(state.draggedMove, geo);
    ctx.strokeStyle = TEAM[token.team].color;
    ctx.lineWidth = 3 * geo.dpr;
    ctx.beginPath();
    ctx.moveTo(fromPos.x, fromPos.y);
    ctx.lineTo(toPos.x, toPos.y);
    ctx.stroke();
  }

  ctx.restore();
}

function drawActiveHighlight(p, token, geo) {
  const size = token.type === "plane"
    ? Math.max(10 * geo.dpr, geo.cell * 0.52)
    : Math.max(9 * geo.dpr, geo.cell * 0.45);

  const r = size * 1.1;
  const len = size * 0.35;

  ctx.save();
  ctx.strokeStyle = TEAM[token.team].color;
  ctx.lineWidth = 1.8 * geo.dpr;

  // Top-Left Bracket
  ctx.beginPath();
  ctx.moveTo(p.x - r, p.y - r + len);
  ctx.lineTo(p.x - r, p.y - r);
  ctx.lineTo(p.x - r + len, p.y - r);
  ctx.stroke();

  // Top-Right Bracket
  ctx.beginPath();
  ctx.moveTo(p.x + r, p.y - r + len);
  ctx.lineTo(p.x + r, p.y - r);
  ctx.lineTo(p.x + r - len, p.y - r);
  ctx.stroke();

  // Bottom-Left Bracket
  ctx.beginPath();
  ctx.moveTo(p.x - r, p.y + r - len);
  ctx.lineTo(p.x - r, p.y + r);
  ctx.lineTo(p.x - r + len, p.y + r);
  ctx.stroke();

  // Bottom-Right Bracket
  ctx.beginPath();
  ctx.moveTo(p.x + r, p.y + r - len);
  ctx.lineTo(p.x + r, p.y + r);
  ctx.lineTo(p.x + r - len, p.y + r);
  ctx.stroke();

  // Draw a subtle background highlight fill behind active token
  ctx.fillStyle = TEAM[token.team].color;
  ctx.globalAlpha = 0.08;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 0.85, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawTokens(geo) {
  const active = activeToken();
  for (const token of state.tokens) {
    if (!token.alive || outside(token)) continue;
    const p = gridToPixel(token, geo);
    if (active && active.id === token.id && !state.replaying) {
      drawActiveHighlight(p, token, geo);
    }
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
  const defaultAngle = token.team === "red" ? -Math.PI / 2 : Math.PI / 2;
  const angle = token.angle !== undefined ? token.angle : defaultAngle;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
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
  ctx.lineTo(size * 1.15, 0);
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

function drawLasers(geo) {
  if (!state.lasers || !state.lasers.length) return;
  const now = performance.now();
  state.lasers = state.lasers.filter((laser) => now - laser.born < 800);

  ctx.save();
  for (const laser of state.lasers) {
    const age = now - laser.born;
    
    // Calculate base opacity (stay at 1.0 for first 300ms, then fade)
    let baseOpacity = 1;
    if (age > 300) {
      baseOpacity = Math.max(0, 1 - (age - 300) / 500);
    }
    
    // Unstable electricity flicker effect
    const flicker = 0.7 + 0.3 * Math.sin(age * 0.15);
    const opacity = baseOpacity * flicker;

    const fromPx = gridToPixel({ x: laser.fromX, y: laser.fromY }, geo);
    const toPx = gridToPixel({ x: laser.toX, y: laser.toY }, geo);

    // 1. Draw glowing outer laser beam line
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

    // 2. Draw inner bright core line
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(2 * geo.dpr, geo.cell * 0.08);
    ctx.globalAlpha = opacity;
    ctx.shadowBlur = 0; // reset shadow for core
    ctx.beginPath();
    ctx.moveTo(fromPx.x, fromPx.y);
    ctx.lineTo(currentToX, currentToY);
    ctx.stroke();

    // 3. Draw traveling energy pulse (charge particle)
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

    // 4. Draw expanding impact flash ring when it hits
    if (age > 350) {
      const flashAge = age - 350;
      const flashProgress = Math.min(1, flashAge / 300); // lasts 300ms
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

function updateStatus() {
  const token = activeToken();
  labels.turn.textContent = state.gameOver ? "Finished" : TEAM[state.turn].name;
  labels.moving.textContent = token ? `${TEAM[token.team].name} ${token.type}` : "None";
  labels.velocity.textContent = token && token.type === "plane" ? `(${token.vx}, ${token.vy})` : "(0, 0)";
  labels.redAlive.textContent = aliveSummary("red");
  labels.blueAlive.textContent = aliveSummary("blue");
}

function updateReplayButton() {
  const suffix = hasKeyboard() ? " (R)" : "";
  if (state.replaying) {
    controls.replay.forEach((b) => {
      b.textContent = "Stop" + suffix;
      b.disabled = false;
    });
  } else {
    controls.replay.forEach((b) => {
      b.textContent = "Replay" + suffix;
      b.disabled = state.moves.length === 0;
    });
  }
}

function aliveSummary(team) {
  const planes = state.tokens.filter((token) => token.team === team && token.type === "plane" && token.alive).length;
  const turrets = state.tokens.filter((token) => token.team === team && token.type === "turret" && token.alive).length;
  return `${planes} planes, ${turrets} turrets`;
}

function aliveSummaryCompact(team) {
  const planes = state.tokens.filter((token) => token.team === team && token.type === "plane" && token.alive).length;
  const turrets = state.tokens.filter((token) => token.team === team && token.type === "turret" && token.alive).length;
  return `${planes}✈️ ${turrets}📡`;
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

function survivalDepth(x, y, vx, vy, currentDepth, maxDepth, targetTokenId, parsedObstacles) {
  if (currentDepth === maxDepth) {
    return maxDepth;
  }

  let maxChildDepth = currentDepth;

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const nvx = vx + dx;
      const nvy = vy + dy;
      const nx = x + nvx;
      const ny = y + nvy;

      const start = { x, y };
      const end = { x: nx, y: ny };

      if (!inside(end, true)) continue;
      if (pathIntersectsObstaclesFast(start, end, parsedObstacles)) continue;

      let tokenCollision = false;
      for (const target of state.tokens) {
        if (target.alive && target.id !== targetTokenId) {
          if (pointOnSegment(target, start, end)) {
            tokenCollision = true;
            break;
          }
        }
      }
      if (tokenCollision) continue;

      const d = survivalDepth(nx, ny, nvx, nvy, currentDepth + 1, maxDepth, targetTokenId, parsedObstacles);
      if (d > maxChildDepth) {
        maxChildDepth = d;
      }
      if (maxChildDepth === maxDepth) {
        return maxDepth;
      }
    }
  }

  return maxChildDepth;
}

function chooseComputerMove(token) {
  const moves = legalMoves(token);
  const insideMoves = moves.filter((move) => inside(move, token.type === "plane"));
  const candidates = insideMoves.length ? insideMoves : moves;

  let best = candidates[0];
  let bestScore = -Infinity;

  // Pre-parse obstacles once per turn to optimize lookahead path finding
  const parsedObstacles = [];
  if (state.obstacles && state.obstacles.size) {
    for (const key of state.obstacles) {
      const [cx, cy] = key.split(",").map(Number);
      parsedObstacles.push({ cx, cy });
    }
  }

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

function scoreComputerPlaneMove(token, move, parsedObstacles) {
  const start = { x: token.x, y: token.y };
  if (!inside(move, true)) return -100000;
  if (pathIntersectsObstaclesFast(start, move, parsedObstacles)) return -100000;

  for (const target of state.tokens) {
    if (target.alive && target.id !== token.id) {
      if (pointOnSegment(target, start, move)) return -100000;
    }
  }

  const enemies = state.tokens.filter((target) => target.alive && target.team !== token.team);
  const enemyTurrets = enemies.filter((target) => target.type === "turret");
  let score = 0;

  for (const target of enemies) {
    const d = distance(move, target);
    if (d <= HIT_RADIUS) score += target.type === "turret" ? 12000 : 8000;
    score += 80 / (d + 1);
  }

  for (const turret of enemyTurrets) {
    if (distance(move, turret) <= TURRET_RADIUS && !pathIntersectsObstaclesOpen(move, turret)) score -= 6500;
  }

  const nextVx = token.vx + move.ax;
  const nextVy = token.vy + move.ay;
  score -= 0.08 * (nextVx * nextVx + nextVy * nextVy);

  // Look ahead 3 steps to see if this velocity/position will force a crash.
  // Apply a severe penalty if survival is short-lived.
  const steps = survivalDepth(move.x, move.y, nextVx, nextVy, 1, 3, token.id, parsedObstacles);
  if (steps < 3) {
    score -= (3 - steps) * 25000;
  }

  return score;
}

function scoreComputerTurretMove(token, move, parsedObstacles) {
  const start = { x: token.x, y: token.y };
  if (!inside(move, false)) return -100000;
  if (pathIntersectsObstaclesFast(start, move, parsedObstacles)) return -100000;

  for (const target of state.tokens) {
    if (target.alive && target.id !== token.id) {
      if (pointOnSegment(target, start, move)) return -100000;
    }
  }

  const enemyPlanes = state.tokens.filter((target) => target.alive && target.team !== token.team && target.type === "plane");
  if (!enemyPlanes.length) return 0;

  const nearest = Math.min(...enemyPlanes.map((plane) => distance(move, plane)));
  return -nearest;
}


function startReplay() {
  if (!state.moves.length) return;
  if (state.replaying) {
    stopReplay();
    return;
  }
  clearTimeout(aiTimer);
  clearTimeout(endGameUITimer);
  cancelAnimationFrame(replayAnimationFrame);
  state.aiThinking = false;

  savedReplayState = {
    tokens: snapshotTokens(),
    turn: state.turn,
    activeId: state.activeId,
    gameOver: state.gameOver,
    message: labels.message.textContent,
  };

  const moves = [...state.moves];
  state.replaying = true;
  hideEndGameUI();
  updateReplayButton();
  controls.newGame.forEach((b) => b.disabled = false);
  labels.message.textContent = "Replaying the fight.";
  restoreSnapshot(moves[0].before);
  state.explosions = [];
  state.lasers = [];
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

        restoreSnapshot(savedReplayState.tokens);
        state.turn = savedReplayState.turn;
        state.activeId = savedReplayState.activeId;
        state.gameOver = savedReplayState.gameOver;
        labels.message.textContent = savedReplayState.message;

        updateReplayButton();
        controls.newGame.forEach((b) => b.disabled = false);
        updateStatus();
        draw();

        if (state.gameOver) {
          showPersistentBannerOnly();
        }
        return;
      }

      const speed = parseFloat(controls.replaySpeed.value) || 1.0;
      replayTimer = setTimeout(showNextMove, Math.max(0, (REPLAY_STEP_MS - REPLAY_ANIMATION_MS) / speed));
    });
  };

  showNextMove();
}

function stopReplay() {
  if (!state.replaying) return;
  clearTimeout(replayTimer);
  cancelAnimationFrame(replayAnimationFrame);
  state.replaying = false;

  if (savedReplayState) {
    restoreSnapshot(savedReplayState.tokens);
    state.turn = savedReplayState.turn;
    state.activeId = savedReplayState.activeId;
    state.gameOver = savedReplayState.gameOver;
    labels.message.textContent = savedReplayState.message;
  }

  updateReplayButton();
  controls.newGame.forEach((b) => b.disabled = false);
  updateStatus();
  draw();

  if (state.gameOver) {
    showPersistentBannerOnly();
  }
}

function animateReplayMove(move, done) {
  const started = performance.now();
  const before = move.before;
  const after = move.after;
  const speed = parseFloat(controls.replaySpeed.value) || 1.0;
  const animMs = REPLAY_ANIMATION_MS / speed;

  const tick = (now) => {
    const progress = Math.min(1, (now - started) / animMs);
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
    for (const shot of move.shots || []) {
      addLaserShot(shot.fromX, shot.fromY, shot.toX, shot.toY, shot.color);
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

    if (afterToken.type === "turret") {
      const beforeAngle = beforeToken.angle !== undefined ? beforeToken.angle : (beforeToken.team === "red" ? -Math.PI / 2 : Math.PI / 2);
      const afterAngle = afterToken.angle !== undefined ? afterToken.angle : (afterToken.team === "red" ? -Math.PI / 2 : Math.PI / 2);
      let diff = afterAngle - beforeAngle;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      token.angle = beforeAngle + diff * progress;
    }

    if (progress < 1 && beforeToken.alive) token.alive = true;
    return token;
  });
}

function resetGame() {
  hideMobileSettings();
  clearTimeout(replayTimer);
  clearTimeout(aiTimer);
  clearTimeout(endGameUITimer);
  cancelAnimationFrame(replayFrame);
  cancelAnimationFrame(replayAnimationFrame);
  state = newState();
  state.activeId = state.tokens.find((token) => token.team === "red" && token.alive)?.id || null;
  labels.message.textContent = "Choose one highlighted point.";
  hideEndGameUI();
  resolveForcedCrashes();
  updateReplayButton();

  const suffix = hasKeyboard() ? " (N)" : "";
  controls.newGame.forEach((b) => {
    b.textContent = "New" + suffix;
    b.disabled = false;
  });

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
    labels.message.textContent = `Computer is moving ${TEAM[state.aiTeam].name}.`;
    return;
  }
  moveToken(eventToGrid(event));
});

endGame.overlay.addEventListener("click", () => {
  if (state && state.gameOver) {
    showPersistentBannerOnly();
  }
});

window.addEventListener("keydown", (event) => {
  // Prevent controls interaction conflicts (e.g. typing in width/height input fields)
  if (
    document.activeElement &&
    (document.activeElement.tagName === "INPUT" ||
     document.activeElement.tagName === "SELECT")
  ) {
    return;
  }

  // Hotkeys:
  // N: New fight (resetGame)
  if ((event.key === "n" || event.key === "N") && (!state || !state.replaying)) {
    event.preventDefault();
    resetGame();
    return;
  }

  // R: Replay fight (startReplay)
  if ((event.key === "r" || event.key === "R") && state && !state.replaying && !controls.replay[0].disabled) {
    event.preventDefault();
    startReplay();
    return;
  }

  // Space: Dismiss game over overlay
  if (event.code === "Space" && state && state.gameOver) {
    event.preventDefault();
    showPersistentBannerOnly();
    return;
  }

  if (!state || state.replaying || state.gameOver || state.aiThinking) return;

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

controls.newGame.forEach((b) => b.addEventListener("click", resetGame));
controls.replay.forEach((b) => b.addEventListener("click", startReplay));
controls.blueControl.addEventListener("change", () => {
  if (state) {
    state.aiTeam = controls.blueControl.value === "computer" ? "blue" : null;
    scheduleComputerMove();
  }
});
document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    controls.width.value = btn.dataset.w;
    controls.height.value = btn.dataset.h;
  });
});
window.addEventListener("resize", draw);

// Map Options Synchronizer
function syncMapOptions(sourceName, targetName) {
  const source = document.getElementsByName(sourceName);
  const target = document.getElementsByName(targetName);
  const val = Array.from(source).find((r) => r.checked)?.value;
  if (val) {
    const match = Array.from(target).find((r) => r.value === val);
    if (match) match.checked = true;
  }
};

document.getElementsByName("mapOption").forEach((r) => {
  r.addEventListener("change", () => syncMapOptions("mapOption", "mapOptionMobile"));
});
document.getElementsByName("mapOptionMobile").forEach((r) => {
  r.addEventListener("change", () => syncMapOptions("mapOptionMobile", "mapOption"));
});

// Mobile Drawer Toggles
const toggleSettingsBtn = document.querySelector("#toggleSettings");
const closeSettingsBtn = document.querySelector("#closeSettings");
const settingsBackdrop = document.querySelector("#settingsBackdrop");
const controlPanel = document.querySelector(".control-panel");

function hideMobileSettings() {
  if (controlPanel && settingsBackdrop) {
    controlPanel.classList.remove("open");
    settingsBackdrop.classList.remove("active");
  }
}

if (toggleSettingsBtn && controlPanel && settingsBackdrop) {
  toggleSettingsBtn.addEventListener("click", () => {
    controlPanel.classList.add("open");
    settingsBackdrop.classList.add("active");
  });
}

if (closeSettingsBtn) {
  closeSettingsBtn.addEventListener("click", hideMobileSettings);
}
if (settingsBackdrop) {
  settingsBackdrop.addEventListener("click", hideMobileSettings);
}

// Mobile Touch Swipe Handling
const swipeTarget = document.getElementById("boardContainer") || canvas;

let swipeOverlay = document.getElementById("swipeOverlay");
if (!swipeOverlay) {
  swipeOverlay = document.createElement("div");
  swipeOverlay.id = "swipeOverlay";
  swipeOverlay.className = "swipe-overlay";
  document.body.appendChild(swipeOverlay);
}

swipeTarget.addEventListener("touchstart", (event) => {
  if (!state || state.replaying || state.aiThinking) return;

  if (!state.gameOver) {
    const token = activeToken();
    if (!token || token.team === state.aiTeam) return;
  }

  const touch = event.touches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
  isSwiping = true;
  state.draggedMove = null;
});

swipeTarget.addEventListener("touchmove", (event) => {
  if (!isSwiping) return;

  if (event.cancelable) {
    event.preventDefault();
  }

  const touch = event.touches[0];
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (state.gameOver) {
    if (dist >= 10) {
      if (Math.abs(dy) > Math.abs(dx)) {
        swipeOverlay.classList.add("visible");
        if (dy > 0) {
          swipeOverlay.textContent = "⬇️ Swipe for New Game";
        } else {
          swipeOverlay.textContent = "⬆️ Swipe for Replay";
        }
      }
    }
    return;
  }

  const token = activeToken();
  if (!token) return;

  const moves = legalMoves(token);
  const anchor = token.type === "plane"
    ? { x: token.x + token.vx, y: token.y + token.vy }
    : { x: token.x, y: token.y };

  let moveOffset = { dx: 0, dy: 0 };
  if (dist >= 30) {
    const angle = Math.atan2(-dy, dx);
    const octant = Math.round(angle / (Math.PI / 4));
    if (octant === 0) {
      moveOffset = { dx: 1, dy: 0 };
    } else if (octant === 1) {
      moveOffset = { dx: 1, dy: 1 };
    } else if (octant === 2) {
      moveOffset = { dx: 0, dy: 1 };
    } else if (octant === 3) {
      moveOffset = { dx: -1, dy: 1 };
    } else if (octant === 4 || octant === -4) {
      moveOffset = { dx: -1, dy: 0 };
    } else if (octant === -3) {
      moveOffset = { dx: -1, dy: -1 };
    } else if (octant === -2) {
      moveOffset = { dx: 0, dy: -1 };
    } else if (octant === -1) {
      moveOffset = { dx: 1, dy: -1 };
    }
  }

  const targetX = anchor.x + moveOffset.dx;
  const targetY = anchor.y + moveOffset.dy;

  const matchedMove = moves.find((m) => m.x === targetX && m.y === targetY);
  if (matchedMove) {
    if (!state.draggedMove || state.draggedMove.x !== matchedMove.x || state.draggedMove.y !== matchedMove.y) {
      state.draggedMove = matchedMove;
      draw();
    }
  } else {
    if (state.draggedMove) {
      state.draggedMove = null;
      draw();
    }
  }
});

swipeTarget.addEventListener("touchend", (event) => {
  if (!isSwiping) return;
  isSwiping = false;

  if (swipeOverlay) {
    swipeOverlay.classList.remove("visible");
  }

  const touch = event.changedTouches[0];
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (state.gameOver) {
    if (dist >= 30) {
      if (Math.abs(dy) > Math.abs(dx)) {
        if (dy > 0) {
          resetGame(); // Swipe down -> New game
        } else {
          startReplay(); // Swipe up -> Replay
        }
      }
    }
    return;
  }

  const token = activeToken();
  if (!token) return;

  if (dist < 15) {
    // Treat as direct tap
    const tapEvent = {
      clientX: touch.clientX,
      clientY: touch.clientY,
    };
    const tapGrid = eventToGrid(tapEvent);
    const moves = legalMoves(token);
    const matched = moves.find((m) => m.x === tapGrid.x && m.y === tapGrid.y);
    if (matched) {
      if (event.cancelable) event.preventDefault();
      moveToken(matched);
    }
  } else {
    // Swipe
    if (event.cancelable) event.preventDefault();
    if (state.draggedMove) {
      moveToken(state.draggedMove);
    }
  }
  state.draggedMove = null;
  draw();
});

canvas.addEventListener("touchcancel", () => {
  isSwiping = false;
  if (state) state.draggedMove = null;
  draw();
});

// Apply version string from single source of truth
document.querySelectorAll(".version").forEach((el) => el.textContent = `v${VERSION}`);

resetGame();
