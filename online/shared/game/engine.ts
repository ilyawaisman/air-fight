import { GAME_PRESETS } from "./presets.js";
import { createRng } from "./random.js";
import type { GamePreset, GameState, Move, MoveResult, ObstacleType, Point, PresetId, Team, Token } from "./types.js";

const HIT_RADIUS = 1;
const TURRET_RADIUS = 5;
const OBSTACLE_CONFIGS: Record<ObstacleType, { density: number; minSize: number; maxSize: number }> = {
  none: { density: 0, minSize: 0, maxSize: 0 },
  big: { density: 3, minSize: 20, maxSize: 40 },
  small: { density: 7.5, minSize: 3, maxSize: 10 },
  mixed: { density: 6, minSize: 3, maxSize: 40 },
};

export function createGame(id: string, presetId: PresetId, seed: number): GameState {
  const preset = GAME_PRESETS[presetId];
  return createGameFromPreset(id, preset, seed);
}

export function createGameFromPreset(id: string, preset: GamePreset, seed: number): GameState {
  const tokens = createTokens(preset);
  const obstacles = createObstacles(preset, seed);
  const state: GameState = {
    id,
    presetId: preset.id,
    seed,
    width: preset.width,
    height: preset.height,
    metric: preset.metric,
    tokens,
    obstacles,
    turn: "red",
    activeId: null,
    gameOver: false,
    winner: null,
    moveNumber: 0,
  };
  state.activeId = nextTokenId(state, "red");
  return state;
}

export function cloneState(state: GameState): GameState {
  return {
    ...state,
    tokens: state.tokens.map((token) => ({ ...token, history: token.history.map((point) => ({ ...point })) })),
    obstacles: [...state.obstacles],
  };
}

export function activeToken(state: GameState): Token | null {
  if (state.gameOver) return null;
  if (!state.activeId) state.activeId = nextTokenId(state, state.turn);
  return state.tokens.find((token) => token.id === state.activeId && token.alive) ?? null;
}

export function legalMoves(state: GameState, token: Token | null = activeToken(state)): Move[] {
  if (!token) return [];
  const anchor = token.type === "plane"
    ? { x: token.x + token.vx, y: token.y + token.vy }
    : { x: token.x, y: token.y };
  const moves: Move[] = [];

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const move = {
        x: anchor.x + dx,
        y: anchor.y + dy,
        ax: token.type === "plane" ? dx : 0,
        ay: token.type === "plane" ? dy : 0,
      };
      if (token.type !== "turret" || inside(state, move)) moves.push(move);
    }
  }

  return moves;
}

export function applyMove(currentState: GameState, team: Team, destination: Pick<Point, "x" | "y">): MoveResult {
  const state = cloneState(currentState);
  if (state.gameOver) return { ok: false, error: "Game is over.", state, eliminated: [] };
  if (state.turn !== team) return { ok: false, error: "It is not your turn.", state, eliminated: [] };

  const token = activeToken(state);
  if (!token || token.team !== team) return { ok: false, error: "No active token for your team.", state, eliminated: [] };

  const move = legalMoves(state, token).find((item) => item.x === destination.x && item.y === destination.y);
  if (!move) return { ok: false, error: "Illegal move.", state, eliminated: [] };

  const start = { x: token.x, y: token.y };
  token.x = move.x;
  token.y = move.y;

  let boundaryCrash = false;
  let obstacleCrash = false;
  if (token.type === "plane") {
    token.vx += move.ax;
    token.vy += move.ay;
    if (outside(state, token)) {
      smashPlaneAtBoundary(state, token, start, move);
      boundaryCrash = true;
    } else if (pathIntersectsObstacles(state, start, move)) {
      smashPlaneAtObstacle(state, token, start, move);
      obstacleCrash = true;
    } else {
      token.history.push({ x: token.x, y: token.y });
    }
  } else if (outside(state, token)) {
    boundaryCrash = true;
  } else if (pathIntersectsObstacles(state, start, move)) {
    obstacleCrash = true;
  }
  token.movedThisTurn = true;

  const eliminated = resolveCombat(state, token, start, boundaryCrash, obstacleCrash);
  state.moveNumber += 1;
  checkWin(state);
  if (!state.gameOver) {
    state.activeId = nextTokenId(state, state.turn);
    resolveForcedCrashes(state, eliminated);
  }

  return { ok: true, state, eliminated };
}

function createTokens(preset: GamePreset): Token[] {
  const tokens: Token[] = [];
  let id = 1;

  for (const team of ["red", "blue"] as const) {
    const planeY = team === "red" ? 2 : preset.height - 2;
    const turretY = team === "red" ? 0 : preset.height;
    for (let i = 0; i < preset.planes; i += 1) {
      const x = evenPoint(i, preset.planes, preset.width);
      tokens.push({ id: `p${id++}`, type: "plane", team, x, y: planeY, vx: 0, vy: 0, history: [{ x, y: planeY }], alive: true });
    }
    for (let i = 0; i < preset.turrets; i += 1) {
      tokens.push({ id: `t${id++}`, type: "turret", team, x: turretPoint(i, preset.turrets, preset.width), y: turretY, vx: 0, vy: 0, history: [], alive: true });
    }
  }

  return tokens;
}

function createObstacles(preset: GamePreset, seed: number): string[] {
  const config = OBSTACLE_CONFIGS[preset.obstacles];
  if (config.density <= 0) return [];

  const rng = createRng(seed);
  const obstacles = new Set<string>();
  const startingPoints = startingTokenPoints(preset);
  const isSafeCell = (cx: number, cy: number) => startingPoints.every((pt) => Math.max(Math.abs(pt.x - (cx + 0.5)), Math.abs(pt.y - (cy + 0.5))) >= 2.5);
  const isValidObstacleCell = (cx: number, cy: number) => cx >= 3 && cx < preset.width - 3 && cy >= 3 && cy < preset.height - 3 && isSafeCell(cx, cy);

  const totalCells = preset.width * preset.height;
  const expectedBlobs = (config.density * totalCells) / 1000;
  const numBlobs = Math.max(1, Math.round(expectedBlobs + (rng() - 0.5) * (expectedBlobs * 0.4)));

  for (let b = 0; b < numBlobs; b += 1) {
    let seedCell: Point | null = null;
    for (let attempts = 0; attempts < 150; attempts += 1) {
      const sx = Math.floor(rng() * preset.width);
      const sy = Math.floor(rng() * preset.height);
      if (!obstacles.has(`${sx},${sy}`) && isValidObstacleCell(sx, sy)) {
        seedCell = { x: sx, y: sy };
        break;
      }
    }
    if (!seedCell) continue;

    const blob = new Set<string>([`${seedCell.x},${seedCell.y}`]);
    obstacles.add(`${seedCell.x},${seedCell.y}`);
    const targetSize = Math.floor(rng() * (config.maxSize - config.minSize + 1)) + config.minSize;
    while (blob.size < targetSize) {
      const neighbors: string[] = [];
      for (const key of blob) {
        const [cx, cy] = parseObstacle(key);
        for (const delta of [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }]) {
          const nx = cx + delta.x;
          const ny = cy + delta.y;
          const nkey = `${nx},${ny}`;
          if (nx >= 0 && nx < preset.width && ny >= 0 && ny < preset.height && !obstacles.has(nkey) && isValidObstacleCell(nx, ny)) {
            neighbors.push(nkey);
          }
        }
      }
      if (neighbors.length === 0) break;
      const chosen = neighbors[Math.floor(rng() * neighbors.length)];
      if (!chosen) break;
      blob.add(chosen);
      obstacles.add(chosen);
    }
  }

  return [...obstacles].sort();
}

function startingTokenPoints(preset: GamePreset): Point[] {
  const points: Point[] = [];
  for (const team of ["red", "blue"] as const) {
    const planeY = team === "red" ? 2 : preset.height - 2;
    const turretY = team === "red" ? 0 : preset.height;
    for (let i = 0; i < preset.planes; i += 1) points.push({ x: evenPoint(i, preset.planes, preset.width), y: planeY });
    for (let i = 0; i < preset.turrets; i += 1) points.push({ x: turretPoint(i, preset.turrets, preset.width), y: turretY });
  }
  return points;
}

function nextTokenId(state: GameState, team: Team): string | null {
  const candidate = state.tokens.find((token) => token.team === team && token.alive && !token.movedThisTurn);
  if (candidate) return candidate.id;
  for (const token of state.tokens) if (token.team === team) token.movedThisTurn = false;
  state.turn = team === "red" ? "blue" : "red";
  return state.tokens.find((token) => token.team === state.turn && token.alive)?.id ?? null;
}

function resolveCombat(state: GameState, mover: Token, start: Point, boundaryCrash: boolean, obstacleCrash: boolean): string[] {
  const eliminated: string[] = [];
  for (const target of state.tokens) {
    if (!target.alive || target.id === mover.id) continue;
    if (pointOnSegment(target, start, { x: mover.x, y: mover.y })) {
      eliminate(mover, eliminated);
      eliminate(target, eliminated);
    }
  }

  if (boundaryCrash || outside(state, mover)) eliminate(mover, eliminated);
  if (obstacleCrash || pathIntersectsObstacles(state, start, { x: mover.x, y: mover.y })) eliminate(mover, eliminated);
  resolvePlaneStackCollisions(state, eliminated);

  if (mover.alive && mover.type === "plane") {
    for (const target of state.tokens) {
      if (target.alive && target.team !== mover.team && distanceLInf(mover, target) <= HIT_RADIUS) eliminate(target, eliminated);
    }
  }

  for (const plane of state.tokens) {
    if (!plane.alive || plane.type !== "plane") continue;
    for (const turret of state.tokens) {
      if (turret.alive && turret.type === "turret" && turret.team !== plane.team && distanceManhattan(plane, turret) <= TURRET_RADIUS && !pathIntersectsObstaclesOpen(state, turret, plane)) {
        eliminate(plane, eliminated);
        break;
      }
    }
  }

  return eliminated;
}

function resolveForcedCrashes(state: GameState, eliminated: string[]): void {
  while (!state.gameOver) {
    const token = activeToken(state);
    if (!token || token.type !== "plane") return;
    const start = { x: token.x, y: token.y };
    const hasSafeMove = legalMoves(state, token).some((move) => isSafePlaneMove(state, token, start, move));
    if (hasSafeMove) return;

    const intended = { x: token.x + token.vx, y: token.y + token.vy };
    const boundaryImpact = boundaryImpactPoint(state, start, intended);
    const obstacleImpact = obstacleImpactPoint(state, start, intended);
    if (pathIntersectsObstacles(state, start, intended) && distanceLInf(start, obstacleImpact) < distanceLInf(start, boundaryImpact)) {
      smashPlaneAtObstacle(state, token, start, intended);
    } else {
      smashPlaneAtBoundary(state, token, start, intended);
    }
    token.movedThisTurn = true;
    eliminate(token, eliminated);
    state.moveNumber += 1;
    checkWin(state);
    if (!state.gameOver) state.activeId = nextTokenId(state, state.turn);
  }
}

function isSafePlaneMove(state: GameState, token: Token, start: Point, move: Move): boolean {
  if (!inside(state, move, true)) return false;
  if (pathIntersectsObstacles(state, start, move)) return false;
  return state.tokens.every((target) => !target.alive || target.id === token.id || !pointOnSegment(target, start, move));
}

function checkWin(state: GameState): void {
  const redPlanes = state.tokens.some((token) => token.team === "red" && token.type === "plane" && token.alive);
  const bluePlanes = state.tokens.some((token) => token.team === "blue" && token.type === "plane" && token.alive);
  if (redPlanes && bluePlanes) return;
  state.gameOver = true;
  state.winner = redPlanes ? "red" : bluePlanes ? "blue" : "draw";
}

function eliminate(token: Token, eliminated: string[]): void {
  if (!token.alive) return;
  token.alive = false;
  eliminated.push(token.id);
}

function resolvePlaneStackCollisions(state: GameState, eliminated: string[]): void {
  const groups = new Map<string, Token[]>();
  for (const plane of state.tokens) {
    if (!plane.alive || plane.type !== "plane" || !Number.isInteger(plane.x) || !Number.isInteger(plane.y)) continue;
    const key = `${plane.x},${plane.y}`;
    groups.set(key, [...(groups.get(key) ?? []), plane]);
  }
  for (const planes of groups.values()) {
    if (planes.length > 1) for (const plane of planes) eliminate(plane, eliminated);
  }
}

function smashPlaneAtBoundary(state: GameState, token: Token, start: Point, end: Point): void {
  const impact = boundaryImpactPoint(state, start, end);
  token.x = impact.x;
  token.y = impact.y;
  const last = token.history.at(-1);
  if (!last || last.x !== impact.x || last.y !== impact.y) token.history.push({ ...impact });
}

function smashPlaneAtObstacle(state: GameState, token: Token, start: Point, end: Point): void {
  const impact = obstacleImpactPoint(state, start, end);
  token.x = impact.x;
  token.y = impact.y;
  const last = token.history.at(-1);
  if (!last || last.x !== impact.x || last.y !== impact.y) token.history.push({ ...impact });
}

function boundaryImpactPoint(state: GameState, start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const candidates: number[] = [];
  if (dx !== 0) candidates.push((0 - start.x) / dx, (state.width - start.x) / dx);
  if (dy !== 0) candidates.push((0 - start.y) / dy, (state.height - start.y) / dy);
  for (const t of candidates.filter((value) => value >= 0 && value <= 1).sort((a, b) => a - b)) {
    const point = { x: start.x + dx * t, y: start.y + dy * t };
    if (insideBoundary(state, point)) return point;
  }
  return nearestBoundaryPoint(state, end);
}

function nearestBoundaryPoint(state: GameState, point: Point): Point {
  const x = clamp(point.x, 0, state.width);
  const y = clamp(point.y, 0, state.height);
  return [
    { x: 0, y, d: Math.abs(x) },
    { x: state.width, y, d: Math.abs(x - state.width) },
    { x, y: 0, d: Math.abs(y) },
    { x, y: state.height, d: Math.abs(y - state.height) },
  ].sort((a, b) => a.d - b.d)[0]!;
}

function obstacleImpactPoint(state: GameState, start: Point, end: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let minT = Infinity;
  for (const key of state.obstacles) {
    const [cx, cy] = parseObstacle(key);
    const hit = firstCellIntersection(start, end, cx, cy);
    if (hit !== null && hit < minT) minT = hit;
  }
  return Number.isFinite(minT) ? { x: start.x + dx * minT, y: start.y + dy * minT } : end;
}

function pathIntersectsObstacles(state: GameState, start: Point, end: Point): boolean {
  return state.obstacles.some((key) => {
    const [cx, cy] = parseObstacle(key);
    return segmentIntersectsCell(start, end, cx, cy, true);
  });
}

function pathIntersectsObstaclesOpen(state: GameState, start: Point, end: Point): boolean {
  return state.obstacles.some((key) => {
    const [cx, cy] = parseObstacle(key);
    return segmentIntersectsCell(start, end, cx, cy, false);
  });
}

function firstCellIntersection(start: Point, end: Point, cx: number, cy: number): number | null {
  return segmentIntersectionRange(start, end, cx, cy)?.[0] ?? null;
}

function segmentIntersectsCell(start: Point, end: Point, cx: number, cy: number, closed: boolean): boolean {
  const range = segmentIntersectionRange(start, end, cx, cy);
  if (!range) return false;
  return closed ? range[0] <= range[1] : range[0] < range[1];
}

function segmentIntersectionRange(start: Point, end: Point, cx: number, cy: number): [number, number] | null {
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

function pointOnSegment(p: Point, start: Point, end: Point): boolean {
  if (p.x === start.x && p.y === start.y) return false;
  const crossProduct = (p.y - start.y) * (end.x - start.x) - (p.x - start.x) * (end.y - start.y);
  if (Math.abs(crossProduct) > 0.000001) return false;
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
}

function outside(state: GameState, token: Token): boolean {
  if (token.type === "plane") return token.x <= 0 || token.y <= 0 || token.x >= state.width || token.y >= state.height;
  return token.x < 0 || token.y < 0 || token.x > state.width || token.y > state.height;
}

function inside(state: GameState, point: Point, isPlane = false): boolean {
  if (isPlane) return point.x > 0 && point.y > 0 && point.x < state.width && point.y < state.height;
  return point.x >= 0 && point.y >= 0 && point.x <= state.width && point.y <= state.height;
}

function insideBoundary(state: GameState, point: Point): boolean {
  const epsilon = 0.000001;
  return point.x >= -epsilon && point.y >= -epsilon && point.x <= state.width + epsilon && point.y <= state.height + epsilon;
}

function distanceManhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function distanceLInf(a: Point, b: Point): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy);
}

function evenPoint(index: number, count: number, width: number): number {
  return clamp(Math.round(((index + 1) * width) / (count + 1)), 0, width);
}

function turretPoint(index: number, count: number, width: number): number {
  if (count === 1) return Math.round(width / 2);
  return clamp(Math.round(((index + 1) * width) / (count + 1)), 0, width);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseObstacle(key: string): [number, number] {
  const [x, y] = key.split(",").map(Number);
  return [x ?? 0, y ?? 0];
}
