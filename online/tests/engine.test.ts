import { describe, expect, it } from "vitest";
import { applyMove, createGame, createGameFromPreset, legalMoves } from "../shared/game/engine.js";
import type { GamePreset } from "../shared/game/types.js";

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

  it("uses L-infinity distance for plane hits regardless of field metric", () => {
    const preset: GamePreset = { id: "duel", label: "Test", width: 12, height: 12, planes: 1, turrets: 0, obstacles: "none", metric: "taxicab" };
    const game = createGameFromPreset("game", preset, 1);
    const redPlane = game.tokens.find((token) => token.id === "p1")!;
    const bluePlane = game.tokens.find((token) => token.id === "p2")!;
    Object.assign(redPlane, { x: 5, y: 4, vx: 0, vy: 0, history: [{ x: 5, y: 4 }] });
    Object.assign(bluePlane, { x: 6, y: 6, vx: 0, vy: 0, history: [{ x: 6, y: 6 }] });

    const result = applyMove(game, "red", { x: 5, y: 5 });

    expect(result.ok).toBe(true);
    expect(result.state.tokens.find((token) => token.id === "p2")?.alive).toBe(false);
  });

  it("uses Manhattan distance for turret attack range", () => {
    const preset: GamePreset = { id: "classic", label: "Test", width: 12, height: 12, planes: 1, turrets: 1, obstacles: "none", metric: "linf" };
    const game = createGameFromPreset("game", preset, 1);
    const redPlane = game.tokens.find((token) => token.id === "p1")!;
    const redTurret = game.tokens.find((token) => token.id === "t2")!;
    const bluePlane = game.tokens.find((token) => token.id === "p3")!;
    Object.assign(redPlane, { x: 9, y: 9, vx: 0, vy: 0, history: [{ x: 9, y: 9 }] });
    Object.assign(redTurret, { x: 0, y: 0 });
    Object.assign(bluePlane, { x: 4, y: 4, vx: 0, vy: 0, history: [{ x: 4, y: 4 }] });

    const result = applyMove(game, "red", { x: 9, y: 10 });

    expect(result.ok).toBe(true);
    expect(result.state.tokens.find((token) => token.id === "p3")?.alive).toBe(true);
  });
});
