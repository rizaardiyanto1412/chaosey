import "dotenv/config";
import cors from "cors";
import express from "express";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { Room, ServerError, matchMaker } from "@colyseus/core";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { z } from "zod";
import {
  DEFAULT_LEVEL,
  DEFAULT_LEVEL_ID,
  circlesIntersectsRect,
  type Collectible,
  composeDirection,
  emptyInputState,
  type LobbyRoomSummary,
  type Obstacle,
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
  type RoundResult,
  type Vector2
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

type HazardDirection = "left" | "right" | "up" | "down" | "circle";
type ObstacleKind = "hazard" | "tumbleweed" | "snowball" | "fireball";

interface TileComponent {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
}

const port = Number(process.env.PORT ?? 3001);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const tickRate = Number(process.env.TICK_RATE ?? 20);
const snapshotRate = Number(process.env.SNAPSHOT_RATE ?? 10);
const disconnectGraceMs = Number(process.env.DISCONNECT_GRACE_MS ?? 10000);
const inactivityKickMs = Number(process.env.INACTIVITY_KICK_MS ?? 0);
const allowedDebugMoveSpeeds = new Set([DEFAULT_LEVEL.moveSpeed, 260, 420]);
const defaultLevelId = normalizeLevelId(process.env.LEVEL_ID ?? DEFAULT_LEVEL_ID);

function normalizeLevelId(rawLevelId: string): string {
  const trimmed = rawLevelId.trim().toLowerCase();
  const numeric = trimmed.match(/^(?:level-?)?(\d{1,2})$/)?.[1];
  if (numeric) {
    const levelNumber = Number(numeric);
    if (levelNumber >= 1 && levelNumber <= 20) {
      return `level-${String(levelNumber).padStart(2, "0")}`;
    }
  }
  if (/^level-\d{2}$/.test(trimmed)) return trimmed;
  return DEFAULT_LEVEL_ID;
}

function mapPathCandidates(levelId: string): string[] {
  return [
    path.resolve(process.cwd(), `apps/client/public/maps/levels/${levelId}/map.json`),
    path.resolve(process.cwd(), `../client/public/maps/levels/${levelId}/map.json`),
    path.resolve(process.cwd(), `../../apps/client/public/maps/levels/${levelId}/map.json`)
  ];
}

function resolveMapPath(levelId: string): string {
  const candidates = [
    ...mapPathCandidates(levelId),
    path.resolve(process.cwd(), "apps/client/public/maps/reference-map/map.json"),
    path.resolve(process.cwd(), "../client/public/maps/reference-map/map.json"),
    path.resolve(process.cwd(), "../../apps/client/public/maps/reference-map/map.json")
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  return found ?? candidates[0];
}

function resolveLevelsDirectory(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "apps/client/public/maps/levels"),
    path.resolve(process.cwd(), "../client/public/maps/levels"),
    path.resolve(process.cwd(), "../../apps/client/public/maps/levels")
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function discoverLevelIds(): string[] {
  if (process.env.MAP_JSON_PATH) return [defaultLevelId];
  const levelsDirectory = resolveLevelsDirectory();
  if (!levelsDirectory) return [defaultLevelId];
  const levelIds = readdirSync(levelsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^level-\d{2}$/.test(entry.name) && existsSync(path.join(levelsDirectory, entry.name, "map.json")))
    .map((entry) => entry.name)
    .sort();
  return levelIds.length > 0 ? levelIds : [defaultLevelId];
}

const levelIds = discoverLevelIds();
const initialLevelIndex = Math.max(0, levelIds.indexOf(defaultLevelId));

function levelIndexForId(levelId: string): number {
  const normalized = normalizeLevelId(levelId);
  const index = levelIds.indexOf(normalized);
  return index >= 0 ? index : initialLevelIndex;
}

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

type LeaderboardEntry = {
  completionMs: number;
  playerCount: number;
  at: string; // ISO date
  roomCode: string;
};

const leaderboard: LeaderboardEntry[] = [];
const maxLeaderboardEntries = 10;

function addLeaderboardEntry(entry: LeaderboardEntry) {
  leaderboard.push(entry);
  leaderboard.sort((a, b) => a.completionMs - b.completionMs);
  // Keep only top N
  if (leaderboard.length > maxLeaderboardEntries) {
    leaderboard.splice(maxLeaderboardEntries);
  }
}

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

function resolveDebugMoveSpeed(debugSolo: boolean, requestedSpeed: unknown): number {
  if (!debugSolo || typeof requestedSpeed !== "number" || !Number.isFinite(requestedSpeed)) {
    return DEFAULT_LEVEL.moveSpeed;
  }
  return allowedDebugMoveSpeeds.has(requestedSpeed) ? requestedSpeed : DEFAULT_LEVEL.moveSpeed;
}

function propertyNumber(layer: TiledLayer | undefined, name: string, fallback: number): number {
  const value = layer?.properties?.find((p) => p.name === name)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberFromLayerName(layer: TiledLayer | undefined, name: string): number | undefined {
  const match = layer?.name.toLowerCase().match(new RegExp(`(?:^|_)${name}_(-?\\d+(?:\\.\\d+)?)(?:_|$)`));
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function obstacleDirectionFromLayerName(layer: TiledLayer, kind: ObstacleKind): HazardDirection | null {
  const match = layer.name.toLowerCase().match(new RegExp(`^${kind}_(left|right|up|down|circle)(?:_|$)`));
  return match ? (match[1] as HazardDirection) : null;
}

function hazardDirectionFromLayerName(layer: TiledLayer): HazardDirection | null {
  return obstacleDirectionFromLayerName(layer, "hazard");
}

function filledTileComponents(layer: TiledLayer | undefined, cols: number): TileComponent[] {
  const data = layer?.data;
  if (!data) return [];

  const filled = new Set<number>();
  for (let i = 0; i < data.length; i += 1) {
    if (data[i] > 0) filled.add(i);
  }

  const components: TileComponent[] = [];
  const visited = new Set<number>();
  for (const start of filled) {
    if (visited.has(start)) continue;

    const queue = [start];
    visited.add(start);
    let minCol = start % cols;
    let maxCol = minCol;
    let minRow = Math.floor(start / cols);
    let maxRow = minRow;

    while (queue.length > 0) {
      const index = queue.pop() as number;
      const col = index % cols;
      const row = Math.floor(index / cols);
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);

      for (const next of [index - 1, index + 1, index - cols, index + cols]) {
        if (!filled.has(next) || visited.has(next)) continue;
        const nextCol = next % cols;
        if (Math.abs(nextCol - col) > 1) continue;
        visited.add(next);
        queue.push(next);
      }
    }

    components.push({ minCol, maxCol, minRow, maxRow });
  }

  return components;
}

function obstacleFromComponent(
  component: TileComponent,
  direction: HazardDirection,
  kind: ObstacleKind,
  layer: TiledLayer | undefined,
  tileW: number,
  tileH: number,
  index: number
): Obstacle {
  const markerX = component.minCol * tileW;
  const markerY = component.minRow * tileH;
  const markerWidth = (component.maxCol - component.minCol + 1) * tileW;
  const markerHeight = (component.maxRow - component.minRow + 1) * tileH;
  const size = propertyNumber(layer, "size", Math.min(markerWidth, markerHeight));
  const x = markerX + markerWidth / 2 - size / 2;
  const y = markerY + markerHeight / 2 - size / 2;
  const origin: Vector2 = { x, y };
  const distance = propertyNumber(layer, "distance", numberFromLayerName(layer, "distance") ?? 350);
  const speed = propertyNumber(layer, "speed", numberFromLayerName(layer, "speed") ?? 1);
  const movement: Obstacle["movement"] = direction === "circle" ? "circular" : direction === "left" || direction === "right" ? "horizontal" : "vertical";
  const sign = direction === "left" || direction === "up" ? -1 : 1;

  return {
    id: `${kind}-${direction}-${index}`,
    kind,
    movement,
    origin,
    amplitude: direction === "circle" ? distance : sign * distance,
    speed,
    phase: 0,
    position: { ...origin },
    size: { x: size, y: size }
  };
}

function hazardFromComponent(
  component: TileComponent,
  direction: HazardDirection,
  layer: TiledLayer | undefined,
  tileW: number,
  tileH: number,
  index: number
): Obstacle {
  return obstacleFromComponent(component, direction, "hazard", layer, tileW, tileH, index);
}

function loadLevelFromTiledJson(filePath: string, levelId: string): LoadedMapLevel | null {
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
    const collectibleNames = ["coin", "coins", "acorn", "acorns"];
    const spawnLayer = findLayerByPriority("objectgroup", spawnNames);
    const goalLayer = findLayerByPriority("objectgroup", goalNames);
    const spawnObj = spawnLayer?.objects?.[0];
    const goalObj = goalLayer?.objects?.[0];
    const startTileLayer = findLayerByPriority("tilelayer", spawnNames);
    const goalTileLayer = findLayerByPriority("tilelayer", goalNames);
    const collectibleLayer = findLayerByPriority("tilelayer", collectibleNames);
    const hazardLayers = tiled.layers
      .filter((layer) => layer.type === "tilelayer")
      .map((layer) => ({ direction: hazardDirectionFromLayerName(layer), layer }))
      .filter((entry): entry is { direction: HazardDirection; layer: TiledLayer } => entry.direction !== null);
    const tumbleweedLayers = tiled.layers
      .filter((layer) => layer.type === "tilelayer")
      .map((layer) => ({ direction: obstacleDirectionFromLayerName(layer, "tumbleweed"), layer }))
      .filter((entry): entry is { direction: HazardDirection; layer: TiledLayer } => entry.direction !== null);
    const snowballLayers = tiled.layers
      .filter((layer) => layer.type === "tilelayer")
      .map((layer) => ({ direction: obstacleDirectionFromLayerName(layer, "snowball"), layer }))
      .filter((entry): entry is { direction: HazardDirection; layer: TiledLayer } => entry.direction !== null);
    const fireballLayers = tiled.layers
      .filter((layer) => layer.type === "tilelayer")
      .map((layer) => ({ direction: obstacleDirectionFromLayerName(layer, "fireball"), layer }))
      .filter((entry): entry is { direction: HazardDirection; layer: TiledLayer } => entry.direction !== null);
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
    const collectibles: Collectible[] = [];
    const collectibleData = collectibleLayer?.data;
    if (collectibleData) {
      for (let i = 0; i < collectibleData.length; i += 1) {
        if (collectibleData[i] <= 0) continue;
        const col = i % cols;
        const row = Math.floor(i / cols);
        collectibles.push({
          id: `acorn-${col}-${row}`,
          kind: "acorn",
          position: { x: col * tileW + tileW / 2, y: row * tileH + tileH / 2 },
          radius: 28,
          points: 1
        });
      }
    }

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
    const hazards = hazardLayers.flatMap(({ direction, layer }, layerIndex) =>
      filledTileComponents(layer, cols).map((component, index) =>
        hazardFromComponent(component, direction, layer, tileW, tileH, layerIndex * 1000 + index)
      )
    );
    const tumbleweeds = tumbleweedLayers.flatMap(({ direction, layer }, layerIndex) =>
      filledTileComponents(layer, cols).map((component, index) =>
        obstacleFromComponent(component, direction, "tumbleweed", layer, tileW, tileH, layerIndex * 1000 + index)
      )
    );
    const snowballs = snowballLayers.flatMap(({ direction, layer }, layerIndex) =>
      filledTileComponents(layer, cols).map((component, index) =>
        obstacleFromComponent(component, direction, "snowball", layer, tileW, tileH, layerIndex * 1000 + index)
      )
    );
    const fireballs = fireballLayers.flatMap(({ direction, layer }, layerIndex) =>
      filledTileComponents(layer, cols).map((component, index) =>
        obstacleFromComponent(component, direction, "fireball", layer, tileW, tileH, layerIndex * 1000 + index)
      )
    );

    const level = {
      id: levelId,
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
        },
        ...hazards,
        ...tumbleweeds,
        ...snowballs,
        ...fireballs
      ],
      collectibles
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
  private currentLevelIndex = initialLevelIndex;
  private startLevelIndex = initialLevelIndex;
  private collisionRects: SolidRect[] = [];
  private collectedCollectibleIds = new Set<string>();
  private score = 0;
  private roundResult?: RoundResult;
  private readonly snapshotIntervalMs = Math.max(1000 / Math.max(1, snapshotRate), 33);
  private lastSnapshotAt = 0;
  private roundStartAt = 0;

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

  onCreate(options?: { debugLevelId?: string; debugMoveSpeed?: number; debugSolo?: boolean; visibility?: RoomVisibility }) {
    this.maxClients = 4;
    this.debugSolo = Boolean(options?.debugSolo);
    this.startLevelIndex = this.debugSolo && options?.debugLevelId ? levelIndexForId(options.debugLevelId) : initialLevelIndex;
    this.currentLevelIndex = this.startLevelIndex;
    this.visibility = options?.visibility === "private" ? "private" : "public";
    this.roomCode = nextRoomCode();
    this.updateRoomMetadata();

    this.loadLevelAtIndex(this.currentLevelIndex);
    this.level.moveSpeed = resolveDebugMoveSpeed(this.debugSolo, options?.debugMoveSpeed);

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

    if (this.roomState === "lobby") {
      this.removePlayer(player.playerId);
      this.emitPlayerStatus();
      this.emitSnapshot(true);
      return;
    }

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

  private removePlayer(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;

    this.players.delete(playerId);
    if (player.sessionId) {
      this.sessionToPlayerId.delete(player.sessionId);
    }
    if (this.hostId === playerId) {
      const nextHost = [...this.players.values()][0];
      this.hostId = nextHost?.playerId ?? "";
    }
    this.rebalanceRoles();
    return true;
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
      score: this.score,
      collectedCollectibleIds: [...this.collectedCollectibleIds],
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
    const completionMs = this.roundStartAt > 0 ? Date.now() - this.roundStartAt : 0;
    const playerCount = [...this.players.values()].filter((p) => p.connected).length;
    this.roomState = "round_end";
    this.roundResult = {
      outcome: "win",
      winCondition: "goal_reached",
      atTick: this.tick,
      completionMs
    };
    addLeaderboardEntry({
      completionMs,
      playerCount,
      at: new Date().toISOString(),
      roomCode: this.roomCode
    });
    this.broadcast("round_result", this.roundResult);
    this.emitRoomState();
    this.emitSnapshot(true);
  }

  private loadLevelAtIndex(levelIndex: number): boolean {
    const levelId = levelIds[levelIndex];
    if (!levelId) return false;
    const loaded = loadLevelFromTiledJson(process.env.MAP_JSON_PATH ?? resolveMapPath(levelId), levelId);
    if (!loaded) return false;
    const moveSpeed = this.level.moveSpeed;
    this.currentLevelIndex = levelIndex;
    this.level = loaded.level;
    this.level.moveSpeed = moveSpeed;
    this.collisionRects = loaded.collisionRects;
    this.teamPosition = { ...loaded.level.spawn };
    this.inputState = emptyInputState();
    this.collectedCollectibleIds.clear();
    this.score = 0;
    return true;
  }

  private advanceLevelOrWin() {
    if (this.loadLevelAtIndex(this.currentLevelIndex + 1)) {
      this.emitSnapshot(true);
      return;
    }
    this.markRoundWin();
  }

  private resetRound() {
    this.roomState = "lobby";
    this.roundResult = undefined;
    this.loadLevelAtIndex(this.startLevelIndex);
    this.tick = 0;
    this.inputState = emptyInputState();
    this.teamPosition = { ...this.level.spawn };
    this.collectedCollectibleIds.clear();
    this.score = 0;

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
    this.loadLevelAtIndex(this.startLevelIndex);
    this.tick = 0;
    this.roundStartAt = Date.now();
    this.inputState = emptyInputState();
    this.teamPosition = { ...this.level.spawn };
    this.collectedCollectibleIds.clear();
    this.score = 0;
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

    const nextX = clampX(this.teamPosition.x + direction.x * this.level.moveSpeed * dt);
    if (collidesAt(nextX, this.teamPosition.y)) {
      this.respawnAtSpawn();
      return;
    }
    this.teamPosition.x = nextX;

    const nextY = clampY(this.teamPosition.y + direction.y * this.level.moveSpeed * dt);
    if (collidesAt(this.teamPosition.x, nextY)) {
      this.respawnAtSpawn();
      return;
    }
    this.teamPosition.y = nextY;
  }

  private collectOverlappingCollectibles() {
    for (const collectible of this.level.collectibles) {
      if (this.collectedCollectibleIds.has(collectible.id)) continue;
      const distance = Math.hypot(this.teamPosition.x - collectible.position.x, this.teamPosition.y - collectible.position.y);
      if (distance > this.level.playerRadius + collectible.radius) continue;
      this.collectedCollectibleIds.add(collectible.id);
      this.score += collectible.points;
    }
  }

  private updateMovingObstacles() {
    const elapsedSeconds = this.tick / tickRate;
    for (const obstacle of this.level.obstacles) {
      if ((obstacle.kind !== "hazard" && obstacle.kind !== "tumbleweed" && obstacle.kind !== "snowball" && obstacle.kind !== "fireball") || !obstacle.movement || !obstacle.origin) continue;
      if (obstacle.movement === "circular") {
        const angle = elapsedSeconds * (obstacle.speed ?? 2.2) + (obstacle.phase ?? 0);
        const radius = obstacle.amplitude ?? 192;
        obstacle.position = {
          x: obstacle.origin.x + Math.cos(angle) * radius,
          y: obstacle.origin.y + Math.sin(angle) * radius
        };
      } else {
        const progress = (1 - Math.cos(elapsedSeconds * (obstacle.speed ?? 2.2) + (obstacle.phase ?? 0))) / 2;
        const offset = progress * (obstacle.amplitude ?? 192);
        if (obstacle.movement === "horizontal") {
          obstacle.position = { x: obstacle.origin.x + offset, y: obstacle.origin.y };
        } else {
          obstacle.position = { x: obstacle.origin.x, y: obstacle.origin.y + offset };
        }
      }
    }
  }

  private respawnAtSpawn() {
    if (this.debugSolo && this.level.collectibles.length > 0) {
      const nearestCollectible = this.level.collectibles.reduce((nearest, collectible) => {
        const nearestDistance = Math.hypot(this.teamPosition.x - nearest.position.x, this.teamPosition.y - nearest.position.y);
        const collectibleDistance = Math.hypot(this.teamPosition.x - collectible.position.x, this.teamPosition.y - collectible.position.y);
        return collectibleDistance < nearestDistance ? collectible : nearest;
      });
      this.teamPosition = { ...nearestCollectible.position };
    } else {
      this.teamPosition = { ...this.level.spawn };
    }
    this.inputState = emptyInputState();
  }

  private resolveHazardCollision(): boolean {
    for (const obstacle of this.level.obstacles) {
      if (obstacle.kind !== "hazard" && obstacle.kind !== "tumbleweed" && obstacle.kind !== "snowball" && obstacle.kind !== "fireball") continue;
      const hit = circlesIntersectsRect(this.teamPosition, this.level.playerRadius, obstacle.position, obstacle.size);
      if (!hit) continue;
      this.respawnAtSpawn();
      return true;
    }
    return false;
  }

  private resolveGoalCollision(): boolean {
    for (const obstacle of this.level.obstacles) {
      if (obstacle.kind !== "goal") continue;
      const hit = circlesIntersectsRect(this.teamPosition, this.level.playerRadius, obstacle.position, obstacle.size);
      if (hit) return true;
    }
    return false;
  }

  private serverTick() {
    const nowAt = now();
    let playerStatusChanged = false;
    const playersToRemove: string[] = [];

    for (const player of this.players.values()) {
      if (!player.connected && player.disconnectedAt) {
        if (this.roomState === "lobby") {
          playersToRemove.push(player.playerId);
        } else if (nowAt - player.disconnectedAt > disconnectGraceMs && this.roomState === "playing") {
          this.markRoundFail("disconnect_timeout");
        } else if (nowAt - player.disconnectedAt > disconnectGraceMs) {
          playersToRemove.push(player.playerId);
        }
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

    for (const playerId of playersToRemove) {
      playerStatusChanged = this.removePlayer(playerId) || playerStatusChanged;
    }

    if (playerStatusChanged) {
      this.emitPlayerStatus();
      this.updateRoomMetadata();
    }

    if (this.roomState !== "playing") {
      this.emitSnapshot(playerStatusChanged);
      return;
    }

    this.tick += 1;
    this.updateMovingObstacles();
    this.applyMovement(1 / tickRate);
    this.collectOverlappingCollectibles();

    this.resolveHazardCollision();
    if (this.resolveGoalCollision()) {
      this.advanceLevelOrWin();
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

async function currentRoomSummaries(): Promise<LobbyRoomSummary[]> {
  const rooms = await matchMaker.query({ name: "wasd_room" });
  return rooms
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
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Chaosey Server Dashboard</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #090b12; color: #eef2ff; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top left, #23305f 0, transparent 34rem), #090b12; }
    main { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 24px; }
    h1 { margin: 0; font-size: clamp(30px, 5vw, 56px); letter-spacing: -0.06em; }
    h2 { margin: 0 0 16px; font-size: 18px; color: #c7d2fe; }
    .muted { color: #94a3b8; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
    .card { border: 1px solid rgba(148, 163, 184, 0.22); border-radius: 24px; padding: 20px; background: rgba(15, 23, 42, 0.78); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.24); }
    .metric { font-size: 34px; font-weight: 800; letter-spacing: -0.05em; }
    .status { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; padding: 8px 12px; background: rgba(34, 197, 94, 0.14); color: #86efac; font-weight: 700; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 20px #22c55e; }
    table { width: 100%; border-collapse: collapse; overflow: hidden; }
    th, td { padding: 12px; border-bottom: 1px solid rgba(148, 163, 184, 0.16); text-align: left; }
    th { color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; }
    .stack { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 16px; }
    .pill { display: inline-flex; padding: 4px 10px; border-radius: 999px; background: rgba(99, 102, 241, 0.18); color: #c4b5fd; font-size: 12px; font-weight: 700; }
    @media (max-width: 860px) { .grid, .stack { grid-template-columns: 1fr; } header { display: block; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Chaosey Server</h1>
        <p class="muted">Live status, rooms, players, and leaderboard.</p>
      </div>
      <div class="status"><span class="dot"></span><span id="statusText">Checking</span></div>
    </header>
    <section class="grid">
      <div class="card"><div class="muted">Rooms</div><div class="metric" id="roomCount">0</div></div>
      <div class="card"><div class="muted">Players</div><div class="metric" id="playerCount">0</div></div>
      <div class="card"><div class="muted">Leaderboard</div><div class="metric" id="leaderboardCount">0</div></div>
      <div class="card"><div class="muted">Uptime</div><div class="metric" id="uptime">0s</div></div>
    </section>
    <section class="stack">
      <div class="card">
        <h2>Rooms</h2>
        <table>
          <thead><tr><th>Code</th><th>State</th><th>Players</th><th>Room ID</th></tr></thead>
          <tbody id="roomsBody"><tr><td colspan="4" class="muted">No rooms</td></tr></tbody>
        </table>
      </div>
      <div class="card">
        <h2>Leaderboard</h2>
        <table>
          <thead><tr><th>Time</th><th>Players</th><th>Room</th></tr></thead>
          <tbody id="leaderboardBody"><tr><td colspan="3" class="muted">No entries</td></tr></tbody>
        </table>
      </div>
    </section>
    <p class="muted">Last updated: <span id="updatedAt">never</span>. Refreshes every 5 seconds.</p>
  </main>
  <script>
    const fmtUptime = (seconds) => {
      const s = Math.floor(seconds % 60);
      const m = Math.floor(seconds / 60 % 60);
      const h = Math.floor(seconds / 3600);
      return h > 0 ? h + "h " + m + "m" : m > 0 ? m + "m " + s + "s" : s + "s";
    };
    const fmtTime = (ms) => {
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const centis = Math.floor((ms % 1000) / 10);
      return String(minutes).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0") + "." + String(centis).padStart(2, "0");
    };
    async function refresh() {
      const response = await fetch("/dashboard/status", { cache: "no-store" });
      const data = await response.json();
      document.getElementById("statusText").textContent = data.ok ? "Online" : "Offline";
      document.getElementById("roomCount").textContent = data.roomCount;
      document.getElementById("playerCount").textContent = data.playerCount;
      document.getElementById("leaderboardCount").textContent = data.leaderboard.length;
      document.getElementById("uptime").textContent = fmtUptime(data.uptimeSeconds);
      document.getElementById("updatedAt").textContent = new Date(data.serverTime).toLocaleString();
      document.getElementById("roomsBody").innerHTML = data.rooms.length === 0
        ? '<tr><td colspan="4" class="muted">No rooms</td></tr>'
        : data.rooms.map((room) => '<tr><td><span class="pill">' + room.roomCode + '</span></td><td>' + room.roomState + '</td><td>' + room.playerCount + '/' + room.maxClients + '</td><td class="muted">' + room.roomId + '</td></tr>').join("");
      document.getElementById("leaderboardBody").innerHTML = data.leaderboard.length === 0
        ? '<tr><td colspan="3" class="muted">No entries</td></tr>'
        : data.leaderboard.map((entry) => '<tr><td>' + fmtTime(entry.completionMs) + '</td><td>' + entry.playerCount + '</td><td><span class="pill">' + entry.roomCode + '</span></td></tr>').join("");
    }
    refresh().catch(() => { document.getElementById("statusText").textContent = "Error"; });
    setInterval(() => refresh().catch(() => { document.getElementById("statusText").textContent = "Error"; }), 5000);
  </script>
</body>
</html>`;
}

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/rooms", async (_req, res) => {
  res.json({ rooms: await currentRoomSummaries() });
});
app.get("/leaderboard", (_req, res) => {
  res.json({ entries: leaderboard });
});
app.get("/dashboard", (_req, res) => {
  res.type("html").send(dashboardHtml());
});
app.get("/dashboard/status", async (_req, res) => {
  const rooms = await currentRoomSummaries();
  res.json({
    ok: true,
    serverTime: new Date().toISOString(),
    uptimeSeconds: process.uptime(),
    roomCount: rooms.length,
    playerCount: rooms.reduce((total, room) => total + room.playerCount, 0),
    rooms,
    leaderboard
  });
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
  transport: new WebSocketTransport({ server: httpServer, perMessageDeflate: false })
});

gameServer.define("wasd_room", WasdRoom);

httpServer.listen(port, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`WASD Colyseus server listening on 0.0.0.0:${port}`);
});
