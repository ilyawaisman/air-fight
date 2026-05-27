import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createAirFightServer, type AirFightServer } from "../server/src/index.js";
import { legalMoves } from "../shared/game/engine.js";
import type { ClientMessage, ServerMessage } from "../shared/protocol.js";

class TestClient {
  readonly socket: WebSocket;
  private readonly messages: ServerMessage[] = [];
  private readonly waiters: Array<() => void> = [];

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on("message", (raw) => {
      this.messages.push(JSON.parse(raw.toString()) as ServerMessage);
      this.waiters.splice(0).forEach((resolve) => resolve());
    });
  }

  async open(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await once(this.socket, "open");
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  async next(type?: ServerMessage["type"]): Promise<ServerMessage> {
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) {
      const index = type ? this.messages.findIndex((message) => message.type === type) : 0;
      if (index >= 0) return this.messages.splice(index, 1)[0]!;
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, Math.max(1, deadline - Date.now()));
        this.waiters.push(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    throw new Error(`Timed out waiting for ${type ?? "message"}`);
  }

  close(): void {
    this.socket.close();
  }
}

describe("websocket protocol", () => {
  let app: AirFightServer | null = null;
  const clients: TestClient[] = [];

  afterEach(async () => {
    clients.splice(0).forEach((client) => client.close());
    if (app) {
      await app.close();
      app = null;
    }
  });

  async function connectClients(): Promise<[TestClient, TestClient]> {
    app = createAirFightServer();
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    const address = app.server.address() as AddressInfo;
    const url = `ws://127.0.0.1:${address.port}/ws`;
    const red = new TestClient(url);
    const blue = new TestClient(url);
    clients.push(red, blue);
    await Promise.all([red.open(), blue.open()]);
    await Promise.all([red.next("hello"), blue.next("hello")]);
    await Promise.all([red.next("queueStatus"), blue.next("queueStatus")]);
    return [red, blue];
  }

  it("reports queue counts excluding the current player", async () => {
    const [red, blue] = await connectClients();

    red.send({ type: "joinQueue", playerName: "Ada", presetId: "duel" });
    await red.next("queued");

    const redStatus = await red.next("queueStatus");
    const blueStatus = await blue.next("queueStatus");

    expect(redStatus).toMatchObject({ type: "queueStatus", counts: { duel: 0 } });
    expect(blueStatus).toMatchObject({ type: "queueStatus", counts: { duel: 1 } });
  });

  it("matches two players in the same preset queue", async () => {
    const [red, blue] = await connectClients();

    red.send({ type: "joinQueue", playerName: "Ada", presetId: "duel" });
    expect(await red.next("queued")).toMatchObject({ type: "queued", presetId: "duel" });

    blue.send({ type: "joinQueue", playerName: "Grace", presetId: "duel" });
    const redMatch = await red.next("matchFound");
    const blueMatch = await blue.next("matchFound");

    expect(redMatch).toMatchObject({ type: "matchFound", team: "red", opponentName: "Grace" });
    expect(blueMatch).toMatchObject({ type: "matchFound", team: "blue", opponentName: "Ada" });
    if (redMatch.type !== "matchFound" || blueMatch.type !== "matchFound") throw new Error("Expected match messages");
    expect(blueMatch.gameId).toBe(redMatch.gameId);
    expect(blueMatch.state).toEqual(redMatch.state);
  });

  it("rejects out-of-turn moves without advancing game state", async () => {
    const [red, blue] = await connectClients();

    red.send({ type: "joinQueue", playerName: "Red", presetId: "duel" });
    await red.next("queued");
    blue.send({ type: "joinQueue", playerName: "Blue", presetId: "duel" });
    const redMatch = await red.next("matchFound");
    const blueMatch = await blue.next("matchFound");
    if (redMatch.type !== "matchFound" || blueMatch.type !== "matchFound") throw new Error("Expected match messages");

    const firstMove = legalMoves(redMatch.state)[0]!;
    blue.send({ type: "submitMove", gameId: blueMatch.gameId, move: firstMove });
    const rejection = await blue.next("moveRejected");

    expect(rejection).toMatchObject({ type: "moveRejected", reason: "It is not your turn." });
    if (rejection.type !== "moveRejected") throw new Error("Expected move rejection");
    expect(rejection.state.moveNumber).toBe(0);
    expect(rejection.state.turn).toBe("red");

    red.send({ type: "submitMove", gameId: redMatch.gameId, move: firstMove });
    const redState = await red.next("gameState");
    const blueState = await blue.next("gameState");

    expect(redState).toMatchObject({ type: "gameState" });
    expect(blueState).toMatchObject({ type: "gameState" });
    if (redState.type !== "gameState" || blueState.type !== "gameState") throw new Error("Expected game state messages");
    expect(redState.state.moveNumber).toBe(1);
    expect(blueState.state).toEqual(redState.state);
  });

  it("broadcasts chat messages to both players in a match", async () => {
    const [red, blue] = await connectClients();

    red.send({ type: "joinQueue", playerName: "Red", presetId: "duel" });
    await red.next("queued");
    blue.send({ type: "joinQueue", playerName: "Blue", presetId: "duel" });
    const redMatch = await red.next("matchFound");
    const blueMatch = await blue.next("matchFound");
    if (redMatch.type !== "matchFound" || blueMatch.type !== "matchFound") throw new Error("Expected match messages");

    red.send({ type: "chatMessage", gameId: redMatch.gameId, text: "  hello   pilot  " });
    expect(await red.next("chatMessage")).toMatchObject({
      type: "chatMessage",
      gameId: redMatch.gameId,
      fromTeam: "red",
      fromName: "Red",
      text: "hello pilot",
    });
    expect(await blue.next("chatMessage")).toMatchObject({
      type: "chatMessage",
      gameId: blueMatch.gameId,
      fromTeam: "red",
      fromName: "Red",
      text: "hello pilot",
    });
  });

  it("lets a player leave an active match", async () => {
    const [red, blue] = await connectClients();

    red.send({ type: "joinQueue", playerName: "Red", presetId: "duel" });
    await red.next("queued");
    blue.send({ type: "joinQueue", playerName: "Blue", presetId: "duel" });
    await red.next("matchFound");
    await blue.next("matchFound");

    red.send({ type: "leaveQueue" });
    expect(await blue.next("opponentDisconnected")).toMatchObject({ type: "opponentDisconnected" });
  });
});
