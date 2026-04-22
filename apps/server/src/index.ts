import "dotenv/config";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Room, ServerError, matchMaker } from "@colyseus/core";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { z } from "zod";
import {
  DEFAULT_LEVEL,
  circlesIntersectsRect,
  composeDirection,
  emptyInputState,
  roleBundlesForPlayerCount,
  type FailReason,
  type GameState,
  type InputState,
  type JoinedRoomPayload,
  type PlayerRole,
  type PlayerStatus,
  type RoomState,
  type RoundResult
} from "@wasd/shared";

interface RoomPlayer {
  playerId: string;
  sessionId: string;
  name: string;
  roles: PlayerRole[];
  ready: boolean;
  connected: boolean;
  lastInputAt: number;
  disconnectedAt?: number;
}

const port = Number(process.env.PORT ?? 3001);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const tickRate = Number(process.env.TICK_RATE ?? 20);
const snapshotRate = Number(process.env.SNAPSHOT_RATE ?? 10);
const disconnectGraceMs = Number(process.env.DISCONNECT_GRACE_MS ?? 10000);
const inactivityKickMs = Number(process.env.INACTIVITY_KICK_MS ?? 0);
const countdownMs = 3000;

const playerSchema = z.object({ playerName: z.string().min(1).max(24) });

function now() {
  return Date.now();
}

function randomCode(): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  for (let i = 0; i < 4; i += 1) {
    value += charset[Math.floor(Math.random() * charset.length)];
  }
  return value;
}

const activeRoomCodes = new Set<string>();

function nextRoomCode(): string {
  let code = randomCode();
  while (activeRoomCodes.has(code)) {
    code = randomCode();
  }
  activeRoomCodes.add(code);
  return code;
}

class WasdRoom extends Room {
  private roomCode = "";
  private hostId = "";
  private roomState: RoomState = "lobby";
  private countdownEndsAt?: number;
  private tick = 0;
  private players = new Map<string, RoomPlayer>();
  private sessionToPlayerId = new Map<string, string>();
  private inputState: InputState = emptyInputState();
  private teamPosition = { ...DEFAULT_LEVEL.spawn };
  private level = structuredClone(DEFAULT_LEVEL);
  private roundResult?: RoundResult;
  private readonly snapshotIntervalMs = Math.max(1000 / Math.max(1, snapshotRate), 33);
  private lastSnapshotAt = 0;

  onCreate() {
    this.maxClients = 4;
    this.roomCode = nextRoomCode();
    this.setMetadata({ roomCode: this.roomCode });

    this.onMessage("ready_state", (client, payload: { ready: boolean }) => {
      const player = this.playerFromClient(client.sessionId);
      if (!player || this.roomState !== "lobby") return;
      player.ready = Boolean(payload?.ready);
      this.emitPlayerStatus();
    });

    this.onMessage("start_game", (client) => {
      const player = this.playerFromClient(client.sessionId);
      if (!player || this.roomState !== "lobby" || this.hostId !== player.playerId) return;

      if (!this.roomCanStart()) {
        client.send("error_event", { message: "Need at least 2 ready players." });
        return;
      }

      this.startCountdown();
    });

    this.onMessage("restart_round", (client) => {
      const player = this.playerFromClient(client.sessionId);
      if (!player || this.hostId !== player.playerId) return;
      this.resetRound();
    });

    this.onMessage("input_press", (client, payload: { role: PlayerRole }) => {
      const player = this.playerFromClient(client.sessionId);
      if (!player || this.roomState !== "playing" || !player.connected) return;
      if (!player.roles.includes(payload.role)) return;
      this.inputState[payload.role] = true;
      player.lastInputAt = now();
    });

    this.onMessage("input_release", (client, payload: { role: PlayerRole }) => {
      const player = this.playerFromClient(client.sessionId);
      if (!player || this.roomState !== "playing") return;
      if (!player.roles.includes(payload.role)) return;
      this.inputState[payload.role] = false;
      player.lastInputAt = now();
    });

    this.onMessage("ping", (client, payload: { sentAt: number }) => {
      client.send("pong", { sentAt: payload.sentAt, serverAt: now() });
    });

    this.clock.setInterval(() => this.serverTick(), 1000 / tickRate);
  }

  onJoin(client: { sessionId: string; send: (type: string, payload?: unknown) => void }, options: { playerName?: string }) {
    const parsed = playerSchema.safeParse({ playerName: options?.playerName ?? "" });
    if (!parsed.success) {
      throw new ServerError(400, "Invalid player name.");
    }

    const name = parsed.data.playerName.trim();
    const reconnect = [...this.players.values()].find((p) => p.name === name && !p.connected);

    if (reconnect) {
      reconnect.connected = true;
      reconnect.sessionId = client.sessionId;
      reconnect.disconnectedAt = undefined;
      reconnect.lastInputAt = now();
      this.sessionToPlayerId.set(client.sessionId, reconnect.playerId);

      const joinedPayload: JoinedRoomPayload = {
        roomCode: this.roomCode,
        playerId: reconnect.playerId,
        roles: reconnect.roles
      };
      client.send("joined_room", joinedPayload);
      client.send("assign_role", { roles: reconnect.roles });
      this.emitPlayerStatus();
      this.emitRoomState();
      this.emitSnapshot(true);
      return;
    }

    if (this.players.size >= 4) {
      throw new ServerError(400, "Room is full.");
    }

    const playerId = crypto.randomUUID();
    const newPlayer: RoomPlayer = {
      playerId,
      sessionId: client.sessionId,
      name,
      roles: [],
      ready: false,
      connected: true,
      lastInputAt: now()
    };

    this.players.set(playerId, newPlayer);
    this.sessionToPlayerId.set(client.sessionId, playerId);

    if (!this.hostId) {
      this.hostId = playerId;
    }

    this.rebalanceRoles();

    const joinedPayload: JoinedRoomPayload = {
      roomCode: this.roomCode,
      playerId,
      roles: newPlayer.roles
    };

    client.send("joined_room", joinedPayload);
    this.emitPlayerStatus();
    this.emitRoomState();
    this.emitSnapshot(true);
  }

  onLeave(client: { sessionId: string }) {
    const player = this.playerFromClient(client.sessionId);
    this.sessionToPlayerId.delete(client.sessionId);
    if (!player) return;

    player.connected = false;
    player.disconnectedAt = now();
    for (const role of player.roles) {
      this.inputState[role] = false;
    }

    this.emitPlayerStatus();
  }

  onDispose() {
    if (this.roomCode) {
      activeRoomCodes.delete(this.roomCode);
    }
  }

  private serializePlayers(): PlayerStatus[] {
    return [...this.players.values()].map((p) => ({
      id: p.playerId,
      name: p.name,
      roles: p.roles,
      connected: p.connected,
      ready: p.ready,
      lastInputAt: p.lastInputAt
    }));
  }

  private rebalanceRoles() {
    const orderedPlayers = [...this.players.values()];
    const bundles = roleBundlesForPlayerCount(orderedPlayers.length);

    orderedPlayers.forEach((player, index) => {
      player.roles = bundles[index] ?? [];
      const client = this.clients.find((c) => c.sessionId === player.sessionId);
      if (client) {
        client.send("assign_role", { roles: player.roles });
      }
    });
  }

  private emitPlayerStatus() {
    this.broadcast("player_status", { players: this.serializePlayers() });
  }

  private emitRoomState() {
    const remaining =
      this.roomState === "countdown" && this.countdownEndsAt ? Math.max(0, this.countdownEndsAt - now()) : 0;
    this.broadcast("room_state", { state: this.roomState, countdownRemainingMs: remaining });
  }

  private emitSnapshot(force = false) {
    const current = now();
    if (!force && current - this.lastSnapshotAt < this.snapshotIntervalMs) {
      return;
    }
    this.lastSnapshotAt = current;

    const payload: GameState = {
      roomCode: this.roomCode,
      roomState: this.roomState,
      tick: this.tick,
      level: this.level,
      players: this.serializePlayers(),
      teamPosition: this.teamPosition,
      countdownRemainingMs:
        this.roomState === "countdown" && this.countdownEndsAt ? Math.max(0, this.countdownEndsAt - now()) : 0,
      serverTime: current
    };
    this.broadcast("state_snapshot", payload);
  }

  private markRoundFail(reason: FailReason) {
    this.roomState = "round_end";
    this.roundResult = {
      outcome: "fail",
      failReason: reason,
      atTick: this.tick
    };
    this.broadcast("round_result", this.roundResult);
    this.emitRoomState();
    this.emitSnapshot(true);
  }

  private markRoundWin() {
    this.roomState = "round_end";
    this.roundResult = {
      outcome: "win",
      winCondition: "goal_reached",
      atTick: this.tick
    };
    this.broadcast("round_result", this.roundResult);
    this.emitRoomState();
    this.emitSnapshot(true);
  }

  private resetRound() {
    this.roomState = "lobby";
    this.countdownEndsAt = undefined;
    this.roundResult = undefined;
    this.tick = 0;
    this.inputState = emptyInputState();
    this.teamPosition = { ...this.level.spawn };

    for (const player of this.players.values()) {
      player.ready = false;
    }

    this.emitPlayerStatus();
    this.emitRoomState();
    this.emitSnapshot(true);
  }

  private roomCanStart(): boolean {
    if (this.players.size < 2) return false;
    for (const player of this.players.values()) {
      if (!player.ready) return false;
    }
    return true;
  }

  private startCountdown() {
    this.roomState = "countdown";
    this.countdownEndsAt = now() + countdownMs;
    this.emitRoomState();
    this.emitSnapshot(true);
  }

  private playerFromClient(sessionId: string): RoomPlayer | undefined {
    const playerId = this.sessionToPlayerId.get(sessionId);
    if (!playerId) return undefined;
    return this.players.get(playerId);
  }

  private applyMovement(dt: number) {
    const direction = composeDirection(this.inputState);
    this.teamPosition.x += direction.x * this.level.moveSpeed * dt;
    this.teamPosition.y += direction.y * this.level.moveSpeed * dt;
    this.teamPosition.x = Math.max(this.level.playerRadius, Math.min(this.level.width - this.level.playerRadius, this.teamPosition.x));
    this.teamPosition.y = Math.max(this.level.playerRadius, Math.min(this.level.height - this.level.playerRadius, this.teamPosition.y));
  }

  private resolveCollisions(): "win" | "fail" | null {
    for (const obstacle of this.level.obstacles) {
      if (obstacle.velocity) {
        obstacle.position.x += obstacle.velocity.x * (1 / tickRate);
        obstacle.position.y += obstacle.velocity.y * (1 / tickRate);

        if (obstacle.position.x < 100 || obstacle.position.x + obstacle.size.x > this.level.width - 100) {
          obstacle.velocity.x *= -1;
        }
        if (obstacle.position.y < 80 || obstacle.position.y + obstacle.size.y > this.level.height - 80) {
          obstacle.velocity.y *= -1;
        }
      }

      const hit = circlesIntersectsRect(this.teamPosition, this.level.playerRadius, obstacle.position, obstacle.size);
      if (!hit) continue;
      if (obstacle.kind === "hazard") return "fail";
      if (obstacle.kind === "goal") return "win";
    }
    return null;
  }

  private serverTick() {
    const nowAt = now();
    let playerStatusChanged = false;

    if (this.roomState === "countdown" && this.countdownEndsAt && this.countdownEndsAt <= nowAt) {
      this.roomState = "playing";
      this.countdownEndsAt = undefined;
      this.emitRoomState();
      this.emitSnapshot(true);
    }

    for (const player of this.players.values()) {
      if (!player.connected && player.disconnectedAt && nowAt - player.disconnectedAt > disconnectGraceMs && this.roomState === "playing") {
        this.markRoundFail("disconnect_timeout");
      }

      if (
        inactivityKickMs > 0 &&
        player.connected &&
        this.roomState === "playing" &&
        nowAt - player.lastInputAt > inactivityKickMs
      ) {
        player.connected = false;
        player.disconnectedAt = nowAt;
        playerStatusChanged = true;
        for (const role of player.roles) {
          this.inputState[role] = false;
        }
      }
    }

    if (playerStatusChanged) {
      this.emitPlayerStatus();
    }

    if (this.roomState !== "playing") {
      this.emitSnapshot();
      return;
    }

    this.tick += 1;
    this.applyMovement(1 / tickRate);

    const result = this.resolveCollisions();
    if (result === "fail") {
      this.markRoundFail("trap_hit");
    } else if (result === "win") {
      this.markRoundWin();
    }

    this.emitSnapshot();

    const anyConnected = [...this.players.values()].some((p) => p.connected);
    if (!anyConnected) {
      this.disconnect();
    }
  }
}

const app = express();
app.use(cors({ origin: clientOrigin }));
app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/rooms/:roomCode", async (req, res) => {
  const roomCode = String(req.params.roomCode ?? "").toUpperCase();
  const rooms = await matchMaker.query({ name: "wasd_room" });
  const matched = rooms.find((room) => String(room.metadata?.roomCode ?? "").toUpperCase() === roomCode);
  if (!matched) {
    res.status(404).json({ error: "Room not found." });
    return;
  }
  res.json({ roomId: matched.roomId, roomCode });
});

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer })
});

gameServer.define("wasd_room", WasdRoom);

httpServer.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`WASD Colyseus server listening on :${port}`);
});
