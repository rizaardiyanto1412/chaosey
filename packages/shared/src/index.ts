export type PlayerRole = "W" | "A" | "S" | "D";

export type RoomState = "lobby" | "countdown" | "playing" | "round_end";

export type WinCondition = "goal_reached";

export type FailReason = "trap_hit" | "disconnect_timeout" | "all_players_dead";

export interface Vector2 {
  x: number;
  y: number;
}

export interface Obstacle {
  id: string;
  kind: "hazard" | "tumbleweed" | "goal";
  movement?: "horizontal" | "vertical" | "circular";
  origin?: Vector2;
  amplitude?: number;
  speed?: number;
  phase?: number;
  position: Vector2;
  size: Vector2;
  velocity?: Vector2;
}

export interface Collectible {
  id: string;
  kind: "acorn";
  position: Vector2;
  radius: number;
  points: number;
}

export interface LevelData {
  id: string;
  width: number;
  height: number;
  spawn: Vector2;
  playerRadius: number;
  moveSpeed: number;
  obstacles: Obstacle[];
  collectibles: Collectible[];
}

export const DEFAULT_LEVEL_ID = "level-01";

export interface InputState {
  W: boolean;
  A: boolean;
  S: boolean;
  D: boolean;
}

export interface PlayerStatus {
  id: string;
  name: string;
  roles: PlayerRole[];
  connected: boolean;
  ready: boolean;
  lastInputAt: number;
}

export interface GameState {
  roomCode: string;
  hostId: string;
  roomState: RoomState;
  tick: number;
  level: LevelData;
  players: PlayerStatus[];
  teamPosition: Vector2;
  score: number;
  collectedCollectibleIds: string[];
  countdownRemainingMs: number;
  serverTime: number;
}

export interface RoundResult {
  outcome: "win" | "fail";
  winCondition?: WinCondition;
  failReason?: FailReason;
  atTick: number;
  completionMs?: number;
}

export interface CreateRoomResponse {
  roomCode: string;
  playerId: string;
}

export interface JoinRoomResponse {
  roomCode: string;
  playerId: string;
  roles: PlayerRole[];
}

export interface JoinedRoomPayload {
  roomCode: string;
  playerId: string;
  roles: PlayerRole[];
}

export type RoomVisibility = "public" | "private";

export interface RoomMetadata {
  roomCode: string;
  visibility: RoomVisibility;
  roomState?: RoomState;
  playerCount?: number;
  maxClients?: number;
}

export interface LobbyRoomSummary {
  roomId: string;
  roomCode: string;
  visibility: RoomVisibility;
  roomState: RoomState;
  playerCount: number;
  maxClients: number;
}

export const ROLES: PlayerRole[] = ["W", "A", "S", "D"];

export const DEFAULT_LEVEL: LevelData = {
  id: "level-1",
  width: 1856,
  height: 1024,
  spawn: { x: 180, y: 300 },
  playerRadius: 18,
  moveSpeed: 160,
  obstacles: [
    { id: "goal", kind: "goal", position: { x: 1660, y: 190 }, size: { x: 120, y: 120 } }
  ],
  collectibles: []
};

export function emptyInputState(): InputState {
  return { W: false, A: false, S: false, D: false };
}

export function composeDirection(input: InputState): Vector2 {
  const x = (input.D ? 1 : 0) - (input.A ? 1 : 0);
  const y = (input.S ? 1 : 0) - (input.W ? 1 : 0);
  if (x === 0 && y === 0) {
    return { x: 0, y: 0 };
  }
  const magnitude = Math.hypot(x, y);
  return { x: x / magnitude, y: y / magnitude };
}

export function circlesIntersectsRect(center: Vector2, radius: number, rectPos: Vector2, rectSize: Vector2): boolean {
  const nearestX = Math.max(rectPos.x, Math.min(center.x, rectPos.x + rectSize.x));
  const nearestY = Math.max(rectPos.y, Math.min(center.y, rectPos.y + rectSize.y));
  const dx = center.x - nearestX;
  const dy = center.y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

export function roleBundlesForPlayerCount(playerCount: number): PlayerRole[][] {
  if (playerCount <= 1) return [["W", "A", "S", "D"]];
  if (playerCount === 2) return [["W", "S"], ["A", "D"]];
  if (playerCount === 3) return [["W", "S"], ["A"], ["D"]];
  return [["W"], ["A"], ["S"], ["D"]];
}
