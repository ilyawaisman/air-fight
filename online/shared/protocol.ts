import type { GameState, Move, PresetId, Team } from "./game/types.js";

export type ClientMessage =
  | { type: "joinQueue"; playerName: string; presetId: PresetId }
  | { type: "submitMove"; gameId: string; move: Pick<Move, "x" | "y"> }
  | { type: "leaveQueue" };

export type ServerMessage =
  | { type: "hello"; playerId: string }
  | { type: "queued"; presetId: PresetId }
  | { type: "matchFound"; gameId: string; team: Team; opponentName: string; state: GameState }
  | { type: "gameState"; state: GameState; eliminated: string[] }
  | { type: "moveRejected"; reason: string; state: GameState }
  | { type: "opponentDisconnected"; state?: GameState };
