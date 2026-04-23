import "dotenv/config";
import cors from "cors";
import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { Room, ServerError, matchMaker } from "@colyseus/core";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { z } from "zod";
import {
  DEFAULT_LEVEL,
  circlesIntersectsRect,
  composeDirection,
  emptyInputState,
  type LobbyRoomSummary,
  roleBundlesForPlayerCount,
  type FailReason,
  type GameState,
  type InputState,
  type JoinedRoomPayload,
  type PlayerRole,
  type PlayerStatus,
  type RoomMetadata,
  type RoomState,
  type RoomVisibility,
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

interface SolidRect {
  position: { x: number; y: number };
  size: { x: number; y: number };
}

interface LoadedMapLevel {
  level: typeof DEFAULT_LEVEL;
  collisionRects: SolidRect[];
}

interface TiledObject {
  x: number;
  y: number;
  width?: number;
  height?: number;
  point?: boolean;
}

interface TiledLayer {
  name: string;
  type: string;
  data?: number[];
  properties?: Array<{ name: string; value: unknown }>;
  objects?: TiledObject[];
}

interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
}

const port = Number(process.env.PORT ?? 3001);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const tickRate = Number(process.env.TICK_RATE ?? 20);
const snapshotRate = Number(process.env.SNAPSHOT_RATE ?? 10);
const disconnectGraceMs = Number(process.env.DISCONNECT_GRACE_MS ?? 10000);
const inactivityKickMs = Number(process.env.INACTIVITY_KICK_MS ?? 0);
function resolveDefaultMapPath(): string {
  if (process.env.MAP_JSON_PATH) return process.env.MAP_JSON_PATH;
  const candidates = [
    path.resolve(process.cwd(), "apps/client/public/maps/reference-map/map.json"),
    path.resolve(process.cwd(), "../client/public/maps/reference-map/map.json"),
    path.resolve(process.cwd(), "../../apps/client/public/maps/reference-map/map.json")
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  return found ?? candidates[0];
}

const defaultMapPath = resolveDefaultMapPath();

const roomJoinSchema = z.object({
  playerName: z.string().trim().max(24).optional(),
  reconnectPlayerId: z.string().uuid().optional()
});

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

function layerColliderEnabled(layer: TiledLayer): boolean {
  const coll = layer.properties?.find((p) => p.name === "collider")?.value;
  return Boolean(coll);
}

function loadLevelFromTiledJson(filePath: string): LoadedMapLevel | null {
  try {
    const raw = readFileSync(filePath, "utf8");
    const tiled = JSON.parse(raw) as TiledMap;
    if (!tiled.width || !tiled.height || !tiled.tilewidth || !tiled.tileheight) return null;

    const cols = tiled.width;
    const rows = tiled.height;
    const tileW = tiled.tilewidth;
    const tileH = tiled.tileheight;
    const blocked = new Uint8Array(cols * rows);

    for (const layer of tiled.layers) {
      if (layer.type !== "tilelayer" || !layerColliderEnabled(layer) || !layer.data) continue;
      for (let i = 0; i < Math.min(layer.data.length, blocked.length); i += 1) {
        if (layer.data[i] > 0) blocked[i] = 1;
      }
    }

    const collisionRects: SolidRect[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const idx = row * cols + col;
        if (!blocked[idx]) continue;
        collisionRects.push({
          position: { x: col * tileW, y: row * tileH },
          size: { x: tileW, y: tileH }
        });
      }
    }

    const findLayerByPriority = (type: string, names: string[]) => {
      for (const name of names) {
        const layer = tiled.layers.find((l) => l.type === type && l.name.toLowerCase() === name);
        if (layer) return layer;
      }
      return undefined;
    };
    const spawnNames = ["spawn_point", "spawn", "start"];
    const goalNames = ["goal_point", "goal"];

    const spawnLayer = findLayerByPriority("objectgroup", spawnNames);
    const goalLayer = findLayerByPriority("objectgroup", goalNames);
    const spawnObj = spawnLayer?.objects?.[0];
    const goalObj = goalLayer?.objects?.[0];
    const startTileLayer = findLayerByPriority("tilelayer", spawnNames);
    const goalTileLayer = findLayerByPriority("tilelayer", goalNames);
    const firstFilledTile = (layer?: TiledLayer) => {
      const data = layer?.data;
      if (!data) return null;
      for (let i = 0; i < data.length; i += 1) {
        if (data[i] <= 0) continue;
        const col = i % cols;
        const row = Math.floor(i / cols);
        return { x: col * tileW, y: row * tileH };
      }
      return null;
    };
    const spawnTile = firstFilledTile(startTileLayer);
    const goalTile = firstFilledTile(goalTileLayer);

    const spawnX = spawnObj ? spawnObj.x + (spawnObj.width ?? 0) / 2 : (spawnTile ? spawnTile.x + tileW / 2 : tileW * 2);
    const spawnY = spawnObj
      ? spawnObj.y + (spawnObj.height ?? 0) / 2
      : spawnTile
        ? spawnTile.y + tileH - DEFAULT_LEVEL.playerRadius - 4
        : tileH * 2;
    const goalW = goalObj?.width ?? tileW;
    const goalH = goalObj?.height ?? tileH;
    const goalX = goalObj ? goalObj.x : (goalTile ? goalTile.x : (cols - 3) * tileW);
    const goalY = goalObj ? goalObj.y : (goalTile ? goalTile.y : tileH);

    const level = {
      id: "reference-map",
      width: cols * tileW,
      height: rows * tileH,
      spawn: { x: spawnX, y: spawnY },
      playerRadius: DEFAULT_LEVEL.playerRadius,
      moveSpeed: DEFAULT_LEVEL.moveSpeed,
      obstacles: [
        {
          id: "goal",
          kind: "goal" as const,
          position: { x: goalX, y: goalY },
          size: { x: goalW, y: goalH }
        }
      ]
    };

    return { level, collisionRects };
  } catch {
    return null;
  }
}

class WasdRoom extends Room {
  private roomCode = "";
  private hostId = "";
  private debugSolo = false;
  private visibility: RoomVisibility = "public";
  private roomState: RoomState = "lobby";
  private tick = 0;
  private players = new Map<string, RoomPlayer>();
  private sessionToPlayerId = new Map<string, string>();
  private inputState: InputState = emptyInputState();
  private teamPosition = { ...DEFAULT_LEVEL.spawn };
  private level = structuredClone(DEFAULT_LEVEL);
  private collisionRects: SolidRect[] = [];
  private roundResult?: RoundResult;
  private readonly snapshotIntervalMs = Math.max(1000 / Math.max(1, snapshotRate), 33);
  private lastSnapshotAt = 0;

  private updateRoomMetadata() {
    const metadata: RoomMetadata = {
      roomCode: this.roomCode,
      visibility: this.visibility,
      roomState: this.roomState,
      playerCount: this.players.size,
      maxClients: this.maxClients
    };
    this.setMetadata(metadata);
  }

  private flushJoinState(
    client: { send: (type: string, payload?: unknown) => void },
    joinedPayload: JoinedRoomPayload,
    roles: PlayerRole[]
  ) {
    this.clock.setTimeout(() => {
      client.send("joined_room", joinedPayload);
      client.send("assign_role", { roles });
      this.emitPlayerStatus();
      this.emitRoomState();
      this.emitSnapshot(true);
    }, 0);
  }

  onCreate(options?: { debugSolo?: boolean; visibility?: RoomVisibility }) {
    this.maxClients = 4;
    this.debugSolo = Boolean(options?.debugSolo);
    this.visibility = options?.visibility === "private" ? "private" : "public";
    this.roomCode = nextRoomCode();
    this.updateRoomMetadata();

    const loaded = loadLevelFromTiledJson(defaultMapPath);
    if (loaded) {
      this.level = loaded.level;
      this.collisionRects = loaded.collisionRects;
      this.teamPosition = { ...loaded.level.spawn };
    } else {
      this.collisionRects = [];
    }

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
        client.send("error_event", {
          message: this.debugSolo ? "Need at least 1 player in debug mode." : "Need at least 2 ready players."
        });
        return;
      }

      this.startRound();
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

  onJoin(
    client: { sessionId: string; send: (type: string, payload?: unknown) => void },
    options: { playerName?: string; reconnectPlayerId?: string }
  ) {
    const parsed = roomJoinSchema.safeParse({
      playerName: options?.playerName,
      reconnectPlayerId: options?.reconnectPlayerId
    });
    if (!parsed.success) {
      throw new ServerError(400, "Invalid player name.");
    }

    const requestedName = parsed.data.playerName?.trim();
    const reconnectPlayerId = parsed.data.reconnectPlayerId;
    const name = requestedName && requestedName.length > 0 ? requestedName : `Player ${this.players.size + 1}`;
    const reconnect = reconnectPlayerId
      ? this.players.get(reconnectPlayerId)
      : [...this.players.values()].find((p) => p.name === name && !p.connected);

    if (reconnect && (reconnectPlayerId !== undefined || !reconnect.connected)) {
      if (reconnect.sessionId && reconnect.sessionId !== client.sessionId) {
        this.sessionToPlayerId.delete(reconnect.sessionId);
      }
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
      this.flushJoinState(client, joinedPayload, reconnect.roles);
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
    this.updateRoomMetadata();

    const joinedPayload: JoinedRoomPayload = {
      roomCode: this.roomCode,
      playerId,
      roles: newPlayer.roles
    };
    this.flushJoinState(client, joinedPayload, newPlayer.roles);
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
    this.updateRoomMetadata();
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
    this.updateRoomMetadata();
  }

  private emitRoomState() {
    this.broadcast("room_state", { state: this.roomState, countdownRemainingMs: 0 });
    this.updateRoomMetadata();
  }

  private emitSnapshot(force = false) {
    const current = now();
    if (!force && current - this.lastSnapshotAt < this.snapshotIntervalMs) {
      return;
    }
    this.lastSnapshotAt = current;

    const payload: GameState = {
      roomCode: this.roomCode,
      hostId: this.hostId,
      roomState: this.roomState,
      tick: this.tick,
      level: this.level,
      players: this.serializePlayers(),
      teamPosition: this.teamPosition,
      countdownRemainingMs: 0,
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
    if (this.debugSolo) {
      return this.players.size >= 1;
    }
    return this.players.size >= 2;
  }

  private startRound() {
    this.roomState = "playing";
    this.roundResult = undefined;
    this.tick = 0;
    this.inputState = emptyInputState();
    this.teamPosition = { ...this.level.spawn };
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
    const clampX = (x: number) => Math.max(this.level.playerRadius, Math.min(this.level.width - this.level.playerRadius, x));
    const clampY = (y: number) => Math.max(this.level.playerRadius, Math.min(this.level.height - this.level.playerRadius, y));

    const collidesAt = (x: number, y: number) => {
      for (const rect of this.collisionRects) {
        if (circlesIntersectsRect({ x, y }, this.level.playerRadius, rect.position, rect.size)) {
          return true;
        }
      }
      return false;
    };

    const respawnAtSpawn = () => {
      this.teamPosition = { ...this.level.spawn };
      this.inputState = emptyInputState();
    };

    const nextX = clampX(this.teamPosition.x + direction.x * this.level.moveSpeed * dt);
    if (collidesAt(nextX, this.teamPosition.y)) {
      respawnAtSpawn();
      return;
    }
    this.teamPosition.x = nextX;

    const nextY = clampY(this.teamPosition.y + direction.y * this.level.moveSpeed * dt);
    if (collidesAt(this.teamPosition.x, nextY)) {
      respawnAtSpawn();
      return;
    }
    this.teamPosition.y = nextY;
  }

  private resolveCollisions(): "win" | "fail" | null {
    for (const obstacle of this.level.obstacles) {
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
app.get("/rooms", async (_req, res) => {
  const rooms = await matchMaker.query({ name: "wasd_room" });
  const summaries: LobbyRoomSummary[] = rooms
    .map((room) => {
      const metadata = room.metadata as Partial<RoomMetadata> | undefined;
      const visibility: RoomVisibility = metadata?.visibility === "private" ? "private" : "public";
      const roomState: LobbyRoomSummary["roomState"] =
        metadata?.roomState === "playing" || metadata?.roomState === "countdown" || metadata?.roomState === "round_end"
          ? metadata.roomState
          : "lobby";
      return {
        roomId: room.roomId,
        roomCode: String(metadata?.roomCode ?? ""),
        visibility,
        roomState,
        playerCount: Number(metadata?.playerCount ?? 0),
        maxClients: Number(metadata?.maxClients ?? 4)
      };
    })
    .filter((room) => room.visibility === "public" && room.roomCode.length > 0 && room.playerCount < room.maxClients);
  res.json({ rooms: summaries });
});
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
