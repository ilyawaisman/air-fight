import { describe, expect, it } from "vitest";
import { applyMove, createGame, legalMoves } from "../shared/game/engine.js";

describe("shared engine", () => {
  it("creates deterministic obstacle maps for a seed", () => {
    const a = createGame("a", "duel", 12345);
    const b = createGame("b", "duel", 12345);
    expect(a.obstacles).toEqual(b.obstacles);
  });

  it("starts red with a legal active plane move set", () => {
    const game = createGame("game", "duel", 1);
    const moves = legalMoves(game);
    expect(game.turn).toBe("red");
    expect(game.activeId).toBe("p1");
    expect(moves).toHaveLength(9);
  });

  it("applies a legal move and advances to blue", () => {
    const game = createGame("game", "duel", 1);
    const move = legalMoves(game).find((candidate) => candidate.ax === 0 && candidate.ay === 1);
    expect(move).toBeDefined();
    const result = applyMove(game, "red", move!);
    expect(result.ok).toBe(true);
    expect(result.state.turn).toBe("blue");
    expect(result.state.activeId).toBe("p2");
    expect(result.state.moveNumber).toBe(1);
  });

  it("rejects moves from the wrong team", () => {
    const game = createGame("game", "duel", 1);
    const move = legalMoves(game)[0]!;
    const result = applyMove(game, "blue", move);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not your turn");
  });
});
