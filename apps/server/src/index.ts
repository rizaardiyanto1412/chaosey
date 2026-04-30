import "dotenv/config";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Room, ServerError, matchMaker } from "@colyseus/core";
import { Server } from "colyseus";
import { uWebSocketsTransport } from "@colyseus/uwebsockets-transport";
import expressify from "uwebsockets-express";
import { z } from "zod";
import {
  DEFAULT_LEVEL,
  DEFAULT_LEVEL_ID,
  type ActivePowerUp,
  circlesIntersectsRect,
  type Collectible,
  directionForRole,
  type LobbyRoomSummary,
  type Obstacle,
  roleBundlesForPlayerCount,
  type FailReason,
  type JoinedRoomPayload,
  type LevelLoadedPayload,
  type LevelTransitionPayload,
  type ObstaclePositionUpdate,
  type PlayerRole,
  type PlayerStatus,
  type PowerUpId,
  type RoomMetadata,
  type RoomState,
  type RoomVisibility,
  type RoundResult,
  type StateSnapshotPayload,
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
const allowedClientOrigins = clientOrigin
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const primaryClientOrigin = allowedClientOrigins[0] ?? "http://localhost:5173";
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
const levelTransitionDurationMs = 3200;
const finalPowerChoiceLevelId = "level-10";
const powerUpDurationsMs: Record<PowerUpId, number> = {
  speed_boost: 30000,
  obstacle_slow: 30000,
  shield: 30000
};
const powerUpLabels: Record<PowerUpId, string> = {
  speed_boost: "Speed +25%",
  obstacle_slow: "Obstacles slowed",
  shield: "Two-hit shield"
};

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
  rank: number;
  completionMs: number;
  playerCount: number;
  playerNames: string[];
  teamName: string;
  at: string; // ISO date
  roomCode: string;
};

const leaderboard: LeaderboardEntry[] = [];
const maxLeaderboardEntries = 10;

type ShareRecord = {
  id: string;
  teamName: string;
  completionMs: number;
  leaderboardRank: number | null;
  createdAt: string;
};

const shareRecords = new Map<string, ShareRecord>();
const shareDir = path.resolve(process.cwd(), ".share-uploads");
const maxShareImageBytes = 2 * 1024 * 1024; // 2 MB
if (!existsSync(shareDir)) mkdirSync(shareDir, { recursive: true });

function addLeaderboardEntry(entry: Omit<LeaderboardEntry, "rank">): LeaderboardEntry {
  const rankedEntry: LeaderboardEntry = { ...entry, rank: 0 };
  const sortedEntries = [...leaderboard, rankedEntry].sort((a, b) => a.completionMs - b.completionMs);
  sortedEntries.forEach((item, index) => {
    item.rank = index + 1;
  });
  leaderboard.splice(0, leaderboard.length, ...sortedEntries.slice(0, maxLeaderboardEntries));
  return rankedEntry;
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
  private debugInvincible = false;
  private debugSpawnNearGoal = false;
  private visibility: RoomVisibility = "public";
  private roomState: RoomState = "lobby";
  private tick = 0;
  private players = new Map<string, RoomPlayer>();
  private sessionToPlayerId = new Map<string, string>();
  private activeMoveRole: PlayerRole | null = null;
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
  private timerElapsedMs = 0;
  private timerStartedAt = 0;
  private timerRunning = false;
  private levelTransition: LevelTransitionPayload | null = null;
  private selectedPowerUp: PowerUpId | null = null;
  private powerUpHolderId: string | null = null;
  private activePowerUp: ActivePowerUp | null = null;

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
      const levelPayload: LevelLoadedPayload = { level: this.level };
      client.send("level_loaded", levelPayload);
      this.emitPlayerStatus();
      this.emitRoomState();
      this.emitSnapshot(true);
    }, 0);
  }

  onCreate(options?: { debugLevelId?: string; debugMoveSpeed?: number; debugSolo?: boolean; debugInvincible?: boolean; debugSpawnNearGoal?: boolean; visibility?: RoomVisibility }) {
    this.maxClients = 4;
    this.debugSolo = Boolean(options?.debugSolo);
    this.debugInvincible = Boolean(options?.debugSolo) && Boolean(options?.debugInvincible);
    this.debugSpawnNearGoal = Boolean(options?.debugSolo) && Boolean(options?.debugSpawnNearGoal);
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
      this.activeMoveRole = payload.role;
      player.lastInputAt = now();
    });

    this.onMessage("input_release", (client, payload: { role: PlayerRole }) => {
      const player = this.playerFromClient(client.sessionId);
      if (!player || this.roomState !== "playing" || !player.connected) return;
      if (!player.roles.includes(payload.role)) return;
      player.lastInputAt = now();
    });

    this.onMessage("select_powerup", (client, payload: { powerUpId: PowerUpId }) => {
      const player = this.playerFromClient(client.sessionId);
      if (!player || !player.connected || this.roomState !== "power_choice") return;
      this.selectPowerUp(payload?.powerUpId);
    });

    this.onMessage("activate_powerup", (client) => {
      const player = this.playerFromClient(client.sessionId);
      if (!player || !player.connected || this.roomState !== "playing") return;
      this.activateSelectedPowerUp(player);
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

    if (this.roomState !== "lobby") {
      throw new ServerError(400, "Game already started.");
    }

    if (this.players.size >= 4) {
      throw new ServerError(400, "Room is full.");
    }

    const playerId = randomUUID();
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
    if (this.activeMoveRole && player.roles.includes(this.activeMoveRole)) {
      this.activeMoveRole = null;
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

  private currentTimerElapsedMs(current = now()): number {
    if (!this.timerRunning || this.timerStartedAt <= 0) {
      return this.timerElapsedMs;
    }
    return this.timerElapsedMs + Math.max(0, current - this.timerStartedAt);
  }

  private startTimerIfNeeded(current = now()) {
    if (this.timerRunning) return;
    this.timerStartedAt = current;
    this.timerRunning = true;
  }

  private pauseTimer(current = now()) {
    if (!this.timerRunning) return;
    this.timerElapsedMs = this.currentTimerElapsedMs(current);
    this.timerStartedAt = 0;
    this.timerRunning = false;
  }

  private resetTimer() {
    this.timerElapsedMs = 0;
    this.timerStartedAt = 0;
    this.timerRunning = false;
  }

  private currentActivePowerUp(current = now()): ActivePowerUp | null {
    if (!this.activePowerUp) return null;
    if (this.activePowerUp.endsAt <= current) {
      this.activePowerUp = null;
      return null;
    }
    return this.activePowerUp;
  }

  private isPowerChoiceTransition(fromLevelId: string, toLevelId: string): boolean {
    return levelIndexForId(toLevelId) === levelIndexForId(finalPowerChoiceLevelId) && levelIndexForId(toLevelId) === levelIndexForId(fromLevelId) + 1;
  }

  private selectPowerUp(powerUpId: PowerUpId) {
    if (powerUpId !== "speed_boost" && powerUpId !== "obstacle_slow" && powerUpId !== "shield") return;
    this.selectedPowerUp = powerUpId;
    this.powerUpHolderId = this.connectedPowerPlayers()[0]?.playerId ?? null;
    this.roomState = "playing";
    this.levelTransition = null;
    this.activeMoveRole = null;
    this.emitRoomState();
    this.emitSnapshot(true);
  }

  private activateSelectedPowerUp(player: RoomPlayer) {
    if (!this.selectedPowerUp || this.activePowerUp || this.powerUpHolderId !== player.playerId) return;
    const powerUpId = this.selectedPowerUp;
    const current = now();
    this.selectedPowerUp = null;
    this.activePowerUp = {
      id: powerUpId,
      label: powerUpLabels[powerUpId],
      startedAt: current,
      endsAt: current + powerUpDurationsMs[powerUpId],
      ...(powerUpId === "shield" ? { shieldHitsRemaining: 2 } : {})
    };
    this.emitSnapshot(true);
  }

  private connectedPowerPlayers(): RoomPlayer[] {
    return [...this.players.values()].filter((player) => player.connected);
  }

  private rotatePowerUpHolderAfterDeath() {
    const powerUpId = this.activePowerUp?.id ?? this.selectedPowerUp;
    if (!powerUpId) return;
    const connectedPlayers = this.connectedPowerPlayers();
    if (connectedPlayers.length === 0) {
      this.selectedPowerUp = powerUpId;
      this.powerUpHolderId = null;
      this.activePowerUp = null;
      return;
    }

    const currentIndex = connectedPlayers.findIndex((player) => player.playerId === this.powerUpHolderId);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % connectedPlayers.length : 0;
    this.selectedPowerUp = powerUpId;
    this.powerUpHolderId = connectedPlayers[nextIndex]?.playerId ?? null;
    this.activePowerUp = null;
  }

  private movementSpeedMultiplier(current = now()): number {
    return this.currentActivePowerUp(current)?.id === "speed_boost" ? 1.25 : 1;
  }

  private obstacleSpeedMultiplier(current = now()): number {
    return this.currentActivePowerUp(current)?.id === "obstacle_slow" ? 0.5 : 1;
  }

  private consumeShieldHit(current = now()): boolean {
    const powerUp = this.currentActivePowerUp(current);
    if (powerUp?.id !== "shield" || !powerUp.shieldHitsRemaining || powerUp.shieldHitsRemaining <= 0) return false;
    powerUp.shieldHitsRemaining -= 1;
    if (powerUp.shieldHitsRemaining <= 0) {
      this.activePowerUp = null;
    }
    return true;
  }

  private removePlayer(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;

    if (this.activeMoveRole && player.roles.includes(this.activeMoveRole)) {
      this.activeMoveRole = null;
    }

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

    const obstaclePositions: ObstaclePositionUpdate[] = [];
    for (const obstacle of this.level.obstacles) {
      if (!obstacle.movement) continue;
      obstaclePositions.push({
        id: obstacle.id,
        x: obstacle.position.x,
        y: obstacle.position.y
      });
    }

    const payload: StateSnapshotPayload = {
      roomCode: this.roomCode,
      hostId: this.hostId,
      roomState: this.roomState,
      tick: this.tick,
      levelId: this.level.id,
      players: this.serializePlayers(),
      teamPosition: this.teamPosition,
      score: this.score,
      collectedCollectibleIds: [...this.collectedCollectibleIds],
      countdownRemainingMs: 0,
      timerElapsedMs: this.currentTimerElapsedMs(current),
      timerRunning: this.timerRunning,
      levelTransition: this.levelTransition,
      selectedPowerUp: this.selectedPowerUp,
      powerUpHolderId: this.powerUpHolderId,
      activePowerUp: this.currentActivePowerUp(current),
      serverTime: current,
      obstaclePositions
    };
    this.broadcast("state_snapshot", payload);
  }

  private markRoundFail(reason: FailReason) {
    this.pauseTimer();
    this.roomState = "round_end";
    this.levelTransition = null;
    this.selectedPowerUp = null;
    this.powerUpHolderId = null;
    this.activePowerUp = null;
    this.activeMoveRole = null;
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
    this.pauseTimer();
    const completionMs = this.currentTimerElapsedMs();
    const connectedPlayers = [...this.players.values()].filter((p) => p.connected);
    const playerCount = connectedPlayers.length;
    const playerNames = connectedPlayers.map((p) => p.name);
    const teamName = playerNames.length > 0 ? playerNames.join(", ") : `Team ${this.roomCode}`;
    const leaderboardEntry = addLeaderboardEntry({
      completionMs,
      playerCount,
      playerNames,
      teamName,
      at: new Date().toISOString(),
      roomCode: this.roomCode
    });
    this.roomState = "round_end";
    this.levelTransition = null;
    this.selectedPowerUp = null;
    this.powerUpHolderId = null;
    this.activePowerUp = null;
    this.activeMoveRole = null;
    this.roundResult = {
      outcome: "win",
      winCondition: "goal_reached",
      atTick: this.tick,
      completionMs,
      leaderboardRank: leaderboardEntry.rank,
      playerNames,
      teamName
    };
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
    this.teamPosition = this.debugInitialSpawn();
    this.activeMoveRole = null;
    this.collectedCollectibleIds.clear();
    this.score = 0;
    this.broadcastLevelLoaded();
    return true;
  }

  private broadcastLevelLoaded() {
    const payload: LevelLoadedPayload = { level: this.level };
    this.broadcast("level_loaded", payload);
  }

  private advanceLevelOrWin() {
    const nextLevelIndex = this.currentLevelIndex + 1;
    const toLevelId = levelIds[nextLevelIndex];
    if (toLevelId) {
      const transitionStartsAt = now();
      this.pauseTimer(transitionStartsAt);
      this.roomState = "level_transition";
      this.activeMoveRole = null;
      this.levelTransition = {
        fromLevelId: this.level.id,
        toLevelId,
        isFinalLevel: nextLevelIndex === levelIds.length - 1,
        startsAt: transitionStartsAt,
        endsAt: transitionStartsAt + levelTransitionDurationMs
      };
      this.emitRoomState();
      this.emitSnapshot(true);

      this.clock.setTimeout(() => {
        if (this.roomState !== "level_transition" || this.levelTransition?.toLevelId !== toLevelId) return;
        const shouldChoosePower = this.isPowerChoiceTransition(this.levelTransition.fromLevelId, toLevelId);
        if (!this.loadLevelAtIndex(nextLevelIndex)) {
          this.markRoundWin();
          return;
        }
        this.roomState = shouldChoosePower ? "power_choice" : "playing";
        this.levelTransition = null;
        this.activeMoveRole = null;
        this.emitRoomState();
        this.emitSnapshot(true);
      }, levelTransitionDurationMs);
      return;
    }
    this.markRoundWin();
  }

  private resetRound() {
    this.roomState = "lobby";
    this.roundResult = undefined;
    this.levelTransition = null;
    this.selectedPowerUp = null;
    this.powerUpHolderId = null;
    this.activePowerUp = null;
    this.resetTimer();
    this.loadLevelAtIndex(this.startLevelIndex);
    this.tick = 0;
    this.activeMoveRole = null;
    this.teamPosition = this.debugInitialSpawn();
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
    this.levelTransition = null;
    this.selectedPowerUp = null;
    this.powerUpHolderId = null;
    this.activePowerUp = null;
    this.resetTimer();
    this.loadLevelAtIndex(this.startLevelIndex);
    this.tick = 0;
    this.activeMoveRole = null;
    this.teamPosition = this.debugInitialSpawn();
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

  private applyMovement(dt: number): boolean {
    const direction = directionForRole(this.activeMoveRole);
    const startedAt = { ...this.teamPosition };
    let moved = false;
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

    const moveSpeed = this.level.moveSpeed * this.movementSpeedMultiplier();
    const nextX = clampX(this.teamPosition.x + direction.x * moveSpeed * dt);
    if (collidesAt(nextX, this.teamPosition.y)) {
      this.respawnAtSpawn();
      return false;
    }
    this.teamPosition.x = nextX;
    moved = moved || Math.abs(this.teamPosition.x - startedAt.x) > 0.001;

    const nextY = clampY(this.teamPosition.y + direction.y * moveSpeed * dt);
    if (collidesAt(this.teamPosition.x, nextY)) {
      this.respawnAtSpawn();
      return moved;
    }
    this.teamPosition.y = nextY;
    moved = moved || Math.abs(this.teamPosition.y - startedAt.y) > 0.001;
    return moved;
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
    const speedMultiplier = this.obstacleSpeedMultiplier();
    for (const obstacle of this.level.obstacles) {
      if ((obstacle.kind !== "hazard" && obstacle.kind !== "tumbleweed" && obstacle.kind !== "snowball" && obstacle.kind !== "fireball") || !obstacle.movement || !obstacle.origin) continue;
      const obstacleSpeed = (obstacle.speed ?? 2.2) * speedMultiplier;
      if (obstacle.movement === "circular") {
        const angle = elapsedSeconds * obstacleSpeed + (obstacle.phase ?? 0);
        const radius = obstacle.amplitude ?? 192;
        obstacle.position = {
          x: obstacle.origin.x + Math.cos(angle) * radius,
          y: obstacle.origin.y + Math.sin(angle) * radius
        };
      } else {
        const progress = (1 - Math.cos(elapsedSeconds * obstacleSpeed + (obstacle.phase ?? 0))) / 2;
        const offset = progress * (obstacle.amplitude ?? 192);
        if (obstacle.movement === "horizontal") {
          obstacle.position = { x: obstacle.origin.x + offset, y: obstacle.origin.y };
        } else {
          obstacle.position = { x: obstacle.origin.x, y: obstacle.origin.y + offset };
        }
      }
    }
  }

  private debugInitialSpawn(): { x: number; y: number } {
    if (!this.debugSpawnNearGoal || this.level.collectibles.length === 0) {
      return { ...this.level.spawn };
    }
    const goal = this.level.obstacles.find((o) => o.kind === "goal");
    if (!goal) return { ...this.level.spawn };
    const goalCenter = {
      x: goal.position.x + goal.size.x / 2,
      y: goal.position.y + goal.size.y / 2
    };
    const nearest = this.level.collectibles.reduce((best, c) => {
      const bestDist = Math.hypot(goalCenter.x - best.position.x, goalCenter.y - best.position.y);
      const cDist = Math.hypot(goalCenter.x - c.position.x, goalCenter.y - c.position.y);
      return cDist < bestDist ? c : best;
    });
    return { ...nearest.position };
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
    this.activeMoveRole = null;
  }

  private resolveHazardCollision(): boolean {
    if (this.debugInvincible) return false;
    const current = now();
    for (const obstacle of this.level.obstacles) {
      if (obstacle.kind !== "hazard" && obstacle.kind !== "tumbleweed" && obstacle.kind !== "snowball" && obstacle.kind !== "fireball") continue;
      // `teamPosition` is treated as the character's "feet" point.
      // Shift the collision center upward so head hits register correctly.
      const collisionCenter = {
        x: this.teamPosition.x,
        y: this.teamPosition.y - this.level.playerRadius * 0.9
      };
      const hit = circlesIntersectsRect(collisionCenter, this.level.playerRadius, obstacle.position, obstacle.size);
      if (!hit) continue;
      if (this.consumeShieldHit(current)) {
        this.respawnAtSpawn();
        this.emitSnapshot(true);
        return false;
      }
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
        if (this.activeMoveRole && player.roles.includes(this.activeMoveRole)) {
          this.activeMoveRole = null;
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
    const moved = this.applyMovement(1 / tickRate);
    if (moved) {
      this.startTimerIfNeeded(nowAt);
    }
    this.collectOverlappingCollectibles();

    if (this.resolveHazardCollision()) {
      this.rotatePowerUpHolderAfterDeath();
      this.respawnAtSpawn();
      this.emitSnapshot(true);
      return;
    }
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

const transport = new uWebSocketsTransport({});
const app = expressify(transport.app);
app.use(cors({ origin: allowedClientOrigins.length > 1 ? allowedClientOrigins : allowedClientOrigins[0] }));

async function currentRoomSummaries(options: { joinableOnly?: boolean } = {}): Promise<LobbyRoomSummary[]> {
  const rooms = await matchMaker.query({ name: "wasd_room" });
  return rooms
    .map((room) => {
      const metadata = room.metadata as Partial<RoomMetadata> | undefined;
      const visibility: RoomVisibility = metadata?.visibility === "private" ? "private" : "public";
      const roomState: LobbyRoomSummary["roomState"] =
        metadata?.roomState === "playing" ||
        metadata?.roomState === "countdown" ||
        metadata?.roomState === "level_transition" ||
        metadata?.roomState === "power_choice" ||
        metadata?.roomState === "round_end"
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
    .filter((room) => {
      if (room.visibility !== "public" || room.roomCode.length === 0) return false;
      if (room.playerCount >= room.maxClients) return false;
      return !options.joinableOnly || room.roomState === "lobby";
    });
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
          <thead><tr><th>Rank</th><th>Time</th><th>Members</th><th>Players</th><th>Room</th></tr></thead>
          <tbody id="leaderboardBody"><tr><td colspan="5" class="muted">No entries</td></tr></tbody>
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
    const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
        ? '<tr><td colspan="5" class="muted">No entries</td></tr>'
        : data.leaderboard.map((entry, index) => '<tr><td>#' + (entry.rank ?? index + 1) + '</td><td>' + fmtTime(entry.completionMs) + '</td><td>' + esc(entry.teamName ?? (entry.playerNames || []).join(", ")) + '</td><td>' + entry.playerCount + '</td><td><span class="pill">' + esc(entry.roomCode) + '</span></td></tr>').join("");
    }
    refresh().catch(() => { document.getElementById("statusText").textContent = "Error"; });
    setInterval(() => refresh().catch(() => { document.getElementById("statusText").textContent = "Error"; }), 5000);
  </script>
</body>
</html>`;
}

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/rooms", async (_req, res) => {
  res.json({ rooms: await currentRoomSummaries({ joinableOnly: true }) });
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
  if (matched.metadata?.roomState !== "lobby") {
    res.status(409).json({ error: "Game already started." });
    return;
  }
  res.json({ roomId: matched.roomId, roomCode });
});

app.post("/share", (req, res) => {
  try {
    const raw = (req as unknown as { _rawbody?: Buffer })._rawbody;
    if (!raw || raw.length === 0) {
      res.status(400).json({ error: "Empty body." });
      return;
    }
    const payload = JSON.parse(raw.toString("utf-8")) as {
      image?: string;
      teamName?: string;
      completionMs?: number;
      leaderboardRank?: number | null;
    };
    if (!payload.image || typeof payload.image !== "string") {
      res.status(400).json({ error: "Missing image." });
      return;
    }
    const match = payload.image.match(/^data:image\/png;base64,(.+)$/);
    if (!match) {
      res.status(400).json({ error: "Invalid image format. Expected PNG data URI." });
      return;
    }
    const imageBuffer = Buffer.from(match[1], "base64");
    if (imageBuffer.length > maxShareImageBytes) {
      res.status(413).json({ error: "Image too large." });
      return;
    }
    const id = randomUUID().replace(/-/g, "").slice(0, 16);
    const imagePath = path.join(shareDir, `${id}.png`);
    writeFileSync(imagePath, imageBuffer);
    const record: ShareRecord = {
      id,
      teamName: typeof payload.teamName === "string" ? payload.teamName.slice(0, 100) : "Unknown Team",
      completionMs: typeof payload.completionMs === "number" ? payload.completionMs : 0,
      leaderboardRank: typeof payload.leaderboardRank === "number" ? payload.leaderboardRank : null,
      createdAt: new Date().toISOString()
    };
    shareRecords.set(id, record);
    res.json({ id, url: `/share/${id}` });
  } catch {
    res.status(400).json({ error: "Invalid request." });
  }
});

app.get("/share/:id/image", (req, res) => {
  const id = String(req.params.id ?? "");
  if (!shareRecords.has(id)) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  const imagePath = path.join(shareDir, `${id}.png`);
  if (!existsSync(imagePath)) {
    res.status(404).json({ error: "Image not found." });
    return;
  }
  const imageData = readFileSync(imagePath);
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(imageData);
});

app.get("/share/:id", (req, res) => {
  const id = String(req.params.id ?? "");
  const record = shareRecords.get(id);
  if (!record) {
    res.status(404).type("html").send("<!doctype html><html><body><p>Share not found.</p></body></html>");
    return;
  }
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
  const fmtTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const centis = Math.floor((ms % 1000) / 10);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
  };
  const teamName = esc(record.teamName);
  const timeText = fmtTime(record.completionMs);
  const rankText = record.leaderboardRank ? `#${record.leaderboardRank}` : "Unranked";
  const title = `${record.teamName} completed Chaosey in ${timeText}!`;
  const description = `Leaderboard rank: ${rankText}. Can you beat them?`;
  const serverOrigin = `http://0.0.0.0:${port}`;
  const httpOrigin = (process.env.SERVER_PUBLIC_URL ?? serverOrigin).replace(/\/$/, "");
  const absoluteImageUrl = `${httpOrigin}/share/${id}/image`;
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:image" content="${esc(absoluteImageUrl)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${esc(absoluteImageUrl)}" />
</head>
<body style="margin:0;background:#090b12;color:#eef2ff;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
  <div style="text-align:center;max-width:600px;padding:24px;">
    <h1 style="font-size:2rem;margin-bottom:8px;">${teamName} completed Chaosey!</h1>
    <p style="font-size:1.2rem;color:#94a3b8;">Time: ${esc(timeText)} &middot; Rank: ${esc(rankText)}</p>
    <img src="/share/${esc(id)}/image" alt="Completion screenshot" style="width:100%;border-radius:12px;margin:24px 0;" />
    <p><a href="${esc(primaryClientOrigin)}" style="color:#818cf8;">Play Chaosey</a></p>
  </div>
</body>
</html>`);
});

const gameServer = new Server({ transport });

gameServer.define("wasd_room", WasdRoom);

gameServer.listen(port, undefined, undefined, () => {
  // eslint-disable-next-line no-console
  console.log(`WASD Colyseus server listening on 0.0.0.0:${port}`);
});
