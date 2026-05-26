export type Team = "red" | "blue";
export type TokenType = "plane" | "turret";
export type Metric = "linf" | "taxicab";
export type PresetId = "duel" | "classic" | "tactical";
export type ObstacleType = "none" | "big" | "small" | "any";

export interface Point {
  x: number;
  y: number;
}

export interface Move extends Point {
  ax: number;
  ay: number;
}

export interface Token extends Point {
  id: string;
  type: TokenType;
  team: Team;
  vx: number;
  vy: number;
  alive: boolean;
  history: Point[];
  movedThisTurn?: boolean;
}

export interface GamePreset {
  id: PresetId;
  label: string;
  width: number;
  height: number;
  planes: number;
  turrets: number;
  obstacles: ObstacleType;
  metric: Metric;
}

export interface GameState {
  id: string;
  presetId: PresetId;
  seed: number;
  width: number;
  height: number;
  metric: Metric;
  tokens: Token[];
  obstacles: string[];
  turn: Team;
  activeId: string | null;
  gameOver: boolean;
  winner: Team | "draw" | null;
  moveNumber: number;
}

export interface MoveResult {
  ok: boolean;
  error?: string;
  state: GameState;
  eliminated: string[];
}
