import Phaser from "phaser";
import { Client, type Room } from "colyseus.js";
import { mapKeyToRole } from "./lib/input";
import type {
  GameState,
  JoinedRoomPayload,
  LobbyRoomSummary,
  PlayerRole,
  RoomVisibility,
  RoundResult
} from "@wasd/shared";

const serverUrl = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:3001";
const colyseus = new Client(serverUrl.replace(/^http/, "ws"));
const httpServerUrl = serverUrl.replace(/^ws/, "http");

const roomEl = document.getElementById("room") as HTMLDivElement;
const roleEl = document.getElementById("role") as HTMLDivElement;
const stateEl = document.getElementById("state") as HTMLDivElement;
const playersEl = document.getElementById("players") as HTMLDivElement;
const latencyEl = document.getElementById("latency") as HTMLDivElement;
const debugSoloEl = document.getElementById("debugSolo") as HTMLInputElement;
const privateRoomCodeEl = document.getElementById("privateRoomCode") as HTMLInputElement;
const menuScreenEl = document.getElementById("menuScreen") as HTMLElement;
const loadingScreenEl = document.getElementById("loadingScreen") as HTMLElement;
const hudEl = document.getElementById("hud") as HTMLElement;
const lobbyOverlayEl = document.getElementById("lobbyOverlay") as HTMLElement;
const lobbyOverlayTitleEl = document.getElementById("lobbyOverlayTitle") as HTMLHeadingElement;
const lobbyOverlayTextEl = document.getElementById("lobbyOverlayText") as HTMLParagraphElement;
const lobbyOverlayPlayersEl = document.getElementById("lobbyOverlayPlayers") as HTMLDivElement;
const lobbyOverlayRoomEl = document.getElementById("lobbyOverlayRoom") as HTMLDivElement;
const lobbyOverlayFootnoteEl = document.getElementById("lobbyOverlayFootnote") as HTMLDivElement;
const howToModalEl = document.getElementById("howToModal") as HTMLElement;
const createRoomModalEl = document.getElementById("createRoomModal") as HTMLElement;
const joinRoomModalEl = document.getElementById("joinRoomModal") as HTMLElement;
const menuStatusEl = document.getElementById("menuStatus") as HTMLDivElement;
const createRoomStatusEl = document.getElementById("createRoomStatus") as HTMLDivElement;
const joinRoomStatusEl = document.getElementById("joinRoomStatus") as HTMLDivElement;
const loadingLabelEl = document.getElementById("loadingLabel") as HTMLParagraphElement;
const roomListEl = document.getElementById("roomList") as HTMLDivElement;
const createdRoomCodeEl = document.getElementById("createdRoomCode") as HTMLDivElement;
const createdRoomMetaEl = document.getElementById("createdRoomMeta") as HTMLDivElement;
const createdRoomPlayersEl = document.getElementById("createdRoomPlayers") as HTMLDivElement;
const createRoomResultEl = document.getElementById("createRoomResult") as HTMLDivElement;
const confirmCreateRoomEl = document.getElementById("confirmCreateRoom") as HTMLButtonElement;
const visibilityPublicEl = document.getElementById("visibilityPublic") as HTMLButtonElement;
const visibilityPrivateEl = document.getElementById("visibilityPrivate") as HTMLButtonElement;
const quitGameEl = document.getElementById("quitGame") as HTMLButtonElement;

const touchButtons = document.querySelectorAll<HTMLButtonElement>("[data-role]");
const persistedRoomKey = "key-chaos.active-room";

let currentRoom: Room | null = null;
let latestState: GameState | null = null;
let latestResult: RoundResult | null = null;
let myRoles: PlayerRole[] = [];
let myPlayerId = "";
let roomCode = "";
let latency = 0;
let currentVisibility: RoomVisibility = "public";
let currentDebugSolo = false;
let myRoomId = "";
let availableRooms: LobbyRoomSummary[] = [];

let targetTeamPosition = { x: 100, y: 100 };
const obstacleTargets = new Map<
  string,
  { x: number; y: number; width: number; height: number; kind: "hazard" | "goal" }
>();

const referenceMapKey = "reference-map";
const referenceTilesKey = "reference-tiles";
const squirrelRightSheetKey = "squirrel-walk-right-12f";
const squirrelLeftSheetKey = "squirrel-walk-left-12f";
const squirrelUpSheetKey = "squirrel-walk-up-12f";
const squirrelDownSheetKey = "squirrel-walk-down-12f";

let game: Phaser.Game | null = null;
let gameBootPromise: Promise<void> | null = null;
let gameBootResolve: (() => void) | null = null;
let hasEnteredGame = false;
let isTransitioningRoom = false;
let hostStartPending = false;

type PersistedRoomSession = {
  roomId: string;
  roomCode: string;
  playerId: string;
};

function setVisibility(element: HTMLElement, isVisible: boolean) {
  element.hidden = !isVisible;
}

function closeAllModals() {
  setVisibility(howToModalEl, false);
  setVisibility(createRoomModalEl, false);
  setVisibility(joinRoomModalEl, false);
}

function openModal(modal: HTMLElement) {
  closeAllModals();
  setVisibility(modal, true);
}

function showMenu(status = "") {
  closeAllModals();
  setVisibility(menuScreenEl, true);
  setVisibility(loadingScreenEl, false);
  setVisibility(hudEl, false);
  setVisibility(lobbyOverlayEl, false);
  menuStatusEl.textContent = status;
}

function showLoading(label: string) {
  closeAllModals();
  loadingLabelEl.textContent = label;
  setVisibility(loadingScreenEl, true);
  setVisibility(menuScreenEl, false);
  setVisibility(lobbyOverlayEl, false);
}

function showHud() {
  hasEnteredGame = true;
  setVisibility(menuScreenEl, false);
  setVisibility(loadingScreenEl, false);
  setVisibility(hudEl, true);
  menuStatusEl.textContent = "";
  updateLobbyOverlay();
}

function signalGameBooted() {
  gameBootResolve?.();
  gameBootResolve = null;
}

function readPersistedRoom(): PersistedRoomSession | null {
  try {
    const raw = window.localStorage.getItem(persistedRoomKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedRoomSession>;
    if (!parsed.roomId || !parsed.roomCode || !parsed.playerId) return null;
    return {
      roomId: parsed.roomId,
      roomCode: parsed.roomCode,
      playerId: parsed.playerId
    };
  } catch {
    return null;
  }
}

function writePersistedRoom() {
  if (!myRoomId || !roomCode || !myPlayerId) return;
  const payload: PersistedRoomSession = {
    roomId: myRoomId,
    roomCode,
    playerId: myPlayerId
  };
  window.localStorage.setItem(persistedRoomKey, JSON.stringify(payload));
}

function clearPersistedRoom() {
  window.localStorage.removeItem(persistedRoomKey);
}

function setSelectedVisibility(visibility: RoomVisibility) {
  currentVisibility = visibility;
  visibilityPublicEl.classList.toggle("active", visibility === "public");
  visibilityPrivateEl.classList.toggle("active", visibility === "private");
}

function send(type: string, payload?: unknown) {
  if (!currentRoom) return;
  currentRoom.send(type, payload);
}

function handlePress(key: string) {
  const role = mapKeyToRole(key);
  if (!role || !myRoles.includes(role)) return;
  send("input_press", { role });
}

function handleRelease(key: string) {
  const role = mapKeyToRole(key);
  if (!role || !myRoles.includes(role)) return;
  send("input_release", { role });
}

class MainScene extends Phaser.Scene {
  private playerSprite?: Phaser.GameObjects.Sprite;
  private hazards: Record<string, Phaser.GameObjects.Rectangle> = {};
  private goal?: Phaser.GameObjects.Rectangle;
  private statusText?: Phaser.GameObjects.Text;
  private mapWidth = 1200;
  private mapHeight = 800;
  private lastFacing: "down" | "left" | "right" | "up" = "down";

  constructor() {
    super("main");
  }

  private resolveSpawn(tilemap: Phaser.Tilemaps.Tilemap): { x: number; y: number } {
    const spawnNames = ["spawn_point", "spawn", "start"];

    for (const name of spawnNames) {
      const objectLayer = tilemap.getObjectLayer(name);
      const spawnObj = objectLayer?.objects?.[0];
      if (spawnObj) {
        return {
          x: (spawnObj.x ?? 0) + (spawnObj.width ?? 0) / 2,
          y: (spawnObj.y ?? 0) + (spawnObj.height ?? 0) / 2
        };
      }
    }

    for (const name of spawnNames) {
      const tileLayerData = tilemap.getLayer(name)?.tilemapLayer?.layer;
      const data = tileLayerData?.data;
      if (!data) continue;
      for (let row = 0; row < data.length; row += 1) {
        for (let col = 0; col < data[row].length; col += 1) {
          const tile = data[row][col];
          if (!tile || tile.index < 0) continue;
          return {
            x: col * tilemap.tileWidth + tilemap.tileWidth / 2,
            y: row * tilemap.tileHeight + tilemap.tileHeight / 2
          };
        }
      }
    }

    return { x: 100, y: 100 };
  }

  preload() {
    this.load.tilemapTiledJSON(referenceMapKey, "/maps/reference-map/map.json");
    this.load.image(referenceTilesKey, "/maps/reference-map/spritesheet.png");
    this.load.spritesheet(squirrelRightSheetKey, "/assets/characters/squirrel-walk-right-12f.png", {
      frameWidth: 128,
      frameHeight: 128
    });
    this.load.spritesheet(squirrelLeftSheetKey, "/assets/characters/squirrel-walk-left-12f.png", {
      frameWidth: 128,
      frameHeight: 128
    });
    this.load.spritesheet(squirrelUpSheetKey, "/assets/characters/squirrel-walk-up-12f.png", {
      frameWidth: 128,
      frameHeight: 128
    });
    this.load.spritesheet(squirrelDownSheetKey, "/assets/characters/squirrel-walk-down-12f.png", {
      frameWidth: 128,
      frameHeight: 128
    });
  }

  create() {
    const tilemap = this.make.tilemap({ key: referenceMapKey });
    let initialSpawn = { x: 100, y: 100 };
    if (tilemap) {
      const tileset = tilemap.addTilesetImage("spritefusion", referenceTilesKey);
      if (tileset) {
        let depth = 0;
        for (const layer of tilemap.layers) {
          const created = tilemap.createLayer(layer.name, tileset, 0, 0);
          created?.setDepth(depth);
          depth += 1;
        }
      }
      this.mapWidth = tilemap.widthInPixels;
      this.mapHeight = tilemap.heightInPixels;
      initialSpawn = this.resolveSpawn(tilemap);
      targetTeamPosition = { ...initialSpawn };
    } else {
      this.add.rectangle(600, 400, 1200, 800, 0x0b1220).setStrokeStyle(2, 0x475569);
    }

    if (!this.anims.exists("squirrel-walk-down")) {
      this.anims.create({
        key: "squirrel-walk-down",
        frames: this.anims.generateFrameNumbers(squirrelDownSheetKey, { start: 0, end: 11 }),
        frameRate: 10,
        repeat: -1
      });
    }
    if (!this.anims.exists("squirrel-walk-up")) {
      this.anims.create({
        key: "squirrel-walk-up",
        frames: this.anims.generateFrameNumbers(squirrelUpSheetKey, { start: 0, end: 11 }),
        frameRate: 10,
        repeat: -1
      });
    }
    if (!this.anims.exists("squirrel-walk-left")) {
      this.anims.create({
        key: "squirrel-walk-left",
        frames: this.anims.generateFrameNumbers(squirrelLeftSheetKey, { start: 0, end: 11 }),
        frameRate: 10,
        repeat: -1
      });
    }
    if (!this.anims.exists("squirrel-walk-right")) {
      this.anims.create({
        key: "squirrel-walk-right",
        frames: this.anims.generateFrameNumbers(squirrelRightSheetKey, { start: 0, end: 11 }),
        frameRate: 10,
        repeat: -1
      });
    }

    this.playerSprite = this.add.sprite(initialSpawn.x, initialSpawn.y, squirrelDownSheetKey, 0);
    this.playerSprite.setDepth(200);
    this.playerSprite.setDisplaySize(64, 64);
    this.playerSprite.setOrigin(0.5, 0.82);
    this.statusText = this.add.text(24, 20, "Waiting for room...", {
      fontFamily: "Trebuchet MS",
      fontSize: "20px",
      color: "#f8fafc"
    });
    this.statusText.setDepth(1000).setScrollFactor(0);

    this.cameras.main.setBounds(0, 0, this.mapWidth, this.mapHeight);
    this.cameras.main.startFollow(this.playerSprite, true, 0.1, 0.1);
    this.cameras.main.setBackgroundColor("#0f172a");

    this.input.keyboard?.on("keydown", (event: KeyboardEvent) => handlePress(event.key));
    this.input.keyboard?.on("keyup", (event: KeyboardEvent) => handleRelease(event.key));

    signalGameBooted();
  }

  update(_time: number, delta: number) {
    if (!latestState || !this.playerSprite) return;

    const smoothFactor = Math.min(1, (delta / 1000) * 14);
    const nextX = Phaser.Math.Linear(this.playerSprite.x, targetTeamPosition.x, smoothFactor);
    const nextY = Phaser.Math.Linear(this.playerSprite.y, targetTeamPosition.y, smoothFactor);
    const dx = nextX - this.playerSprite.x;
    const dy = nextY - this.playerSprite.y;
    this.playerSprite.setPosition(nextX, nextY);

    const moving = Math.hypot(dx, dy) > 0.35;
    if (moving) {
      let facing: "down" | "left" | "right" | "up";
      if (Math.abs(dx) > Math.abs(dy)) {
        facing = dx > 0 ? "right" : "left";
      } else {
        facing = dy > 0 ? "down" : "up";
      }
      this.lastFacing = facing;
      this.playerSprite.setTexture(
        facing === "right"
          ? squirrelRightSheetKey
          : facing === "left"
            ? squirrelLeftSheetKey
            : facing === "up"
              ? squirrelUpSheetKey
              : squirrelDownSheetKey
      );
      this.playerSprite.anims.play(`squirrel-walk-${facing}`, true);
    } else if (this.playerSprite.anims.isPlaying) {
      this.playerSprite.anims.stop();
      if (this.lastFacing === "right") {
        this.playerSprite.setTexture(squirrelRightSheetKey, 0);
      } else if (this.lastFacing === "left") {
        this.playerSprite.setTexture(squirrelLeftSheetKey, 0);
      } else if (this.lastFacing === "up") {
        this.playerSprite.setTexture(squirrelUpSheetKey, 0);
      } else {
        this.playerSprite.setTexture(squirrelDownSheetKey, 0);
      }
    }

    this.statusText?.setText(
      latestResult
        ? latestResult.outcome === "win"
          ? "Round won. Host can restart."
          : `Round failed: ${latestResult.failReason}`
        : latestState.roomState === "countdown"
          ? `Countdown: ${(latestState.countdownRemainingMs / 1000).toFixed(1)}s`
          : `Room ${latestState.roomCode} • ${latestState.roomState}`
    );

    for (const [id, obstacle] of obstacleTargets.entries()) {
      if (obstacle.kind === "goal") {
        if (!this.goal) {
          this.goal = this.add.rectangle(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 0x22c55e);
        }
        this.goal.width = obstacle.width;
        this.goal.height = obstacle.height;
        this.goal.setPosition(
          Phaser.Math.Linear(this.goal.x, obstacle.x, smoothFactor),
          Phaser.Math.Linear(this.goal.y, obstacle.y, smoothFactor)
        );
        continue;
      }

      if (!this.hazards[id]) {
        this.hazards[id] = this.add.rectangle(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 0xef4444);
      }
      this.hazards[id].width = obstacle.width;
      this.hazards[id].height = obstacle.height;
      this.hazards[id].setPosition(
        Phaser.Math.Linear(this.hazards[id].x, obstacle.x, smoothFactor),
        Phaser.Math.Linear(this.hazards[id].y, obstacle.y, smoothFactor)
      );
    }
  }
}

function ensureGameStarted() {
  if (game) return gameBootPromise ?? Promise.resolve();

  gameBootPromise = new Promise<void>((resolve) => {
    gameBootResolve = resolve;
  });

  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#0f172a",
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: [MainScene]
  });

  return gameBootPromise;
}

function resizeGame() {
  game?.scale.resize(window.innerWidth, window.innerHeight);
}

function updateCreateRoomSummary() {
  setVisibility(createRoomResultEl, Boolean(roomCode));
  createdRoomCodeEl.textContent = roomCode || "----";
  createdRoomMetaEl.textContent = `Visibility: ${currentVisibility === "public" ? "Public" : "Private"}`;
  const playerCount = latestState?.players.length ?? (currentRoom ? 1 : 0);
  createdRoomPlayersEl.textContent = `Players in room: ${playerCount}/4`;

  if (!roomCode) {
    confirmCreateRoomEl.textContent = "Create Room";
    confirmCreateRoomEl.disabled = false;
    confirmCreateRoomEl.style.opacity = "1";
    confirmCreateRoomEl.title = "Create room";
    return;
  }

  const canStartFromModal = currentDebugSolo ? playerCount >= 1 : playerCount >= 2;
  confirmCreateRoomEl.textContent = "Start the game";
  confirmCreateRoomEl.disabled = !canStartFromModal;
  confirmCreateRoomEl.style.opacity = canStartFromModal ? "1" : "0.55";
  confirmCreateRoomEl.title = canStartFromModal ? "Start the run" : "Need at least 2 players to start.";
}

function updateStartAvailability() {
  const playerCount = latestState?.players.length ?? 0;
  const canStart = currentDebugSolo ? playerCount >= 1 : playerCount >= 2;
  confirmCreateRoomEl.title = roomCode ? (canStart ? "Start the run" : "Need at least 2 players to start.") : "Create room";
}

function updateLobbyOverlay() {
  if (!latestState || !myPlayerId) {
    setVisibility(lobbyOverlayEl, false);
    return;
  }

  const isHost = latestState.hostId === myPlayerId;
  const shouldShow = latestState.roomState === "lobby" && !isHost;
  setVisibility(lobbyOverlayEl, shouldShow);
  if (!shouldShow) return;

  const playerCount = latestState.players.length;
  lobbyOverlayTitleEl.textContent = "Waiting For Host";
  lobbyOverlayTextEl.textContent =
    playerCount > 1
      ? "Everyone is in position. The host can start the run whenever they are ready."
      : "You joined successfully. Waiting for the host and more players before the run begins.";
  lobbyOverlayPlayersEl.textContent = `Players: ${playerCount}/4`;
  lobbyOverlayRoomEl.textContent = `Room: ${latestState.roomCode}`;
  lobbyOverlayFootnoteEl.textContent =
    playerCount > 1
      ? "You do not need to do anything here. The game will begin for you as soon as the host presses start."
      : "The host needs at least one more player before the game can start.";
}

function syncLobbyControls() {
  if (!latestState || !roomCode) return;
  const isHost = latestState.hostId === myPlayerId;
  const shouldOpenHostRoomPanel = isHost && latestState.roomState === "lobby" && !hostStartPending;
  if (shouldOpenHostRoomPanel && createRoomModalEl.hidden) {
    openModal(createRoomModalEl);
  }
}

function updateUi() {
  roleEl.textContent = `Role: ${myRoles.length ? myRoles.join(" + ") : "-"}`;
  roomEl.textContent = `Room: ${roomCode || "-"}`;
  stateEl.textContent = `State: ${latestState?.roomState ?? "-"}`;
  latencyEl.textContent = `RTT: ${Math.round(latency)} ms`;

  if (!latestState) {
    playersEl.textContent = "Players: -";
  } else {
    const lines = latestState.players.map(
      (p) => `${p.name} [${p.roles.join("+")}] ${p.connected ? "online" : "offline"}`
    );
    playersEl.textContent = lines.join("\n");
  }

  updateStartAvailability();
  updateCreateRoomSummary();
  updateLobbyOverlay();
  syncLobbyControls();
}

function hydrateMyRolesFromPlayers(players: GameState["players"]) {
  if (!myPlayerId) return;
  const me = players.find((p) => p.id === myPlayerId);
  if (!me) return;
  myRoles = me.roles;
}

function renderRoomList() {
  if (availableRooms.length === 0) {
    roomListEl.innerHTML = '<div class="server-empty">No public rooms are open right now.</div>';
    return;
  }

  roomListEl.innerHTML = availableRooms
    .map(
      (room) => `
        <div class="server-card">
          <div class="server-card-copy">
            <strong>Room ${room.roomCode}</strong>
            <span>${room.playerCount}/${room.maxClients} players • ${room.roomState}</span>
          </div>
          <button class="menu-button secondary" type="button" data-room-id="${room.roomId}">Join</button>
        </div>
      `
    )
    .join("");

  for (const button of roomListEl.querySelectorAll<HTMLButtonElement>("[data-room-id]")) {
    button.addEventListener("click", () => void enterRoom({ roomId: String(button.dataset.roomId) }));
  }
}

async function fetchRoomList() {
  joinRoomStatusEl.textContent = "Loading rooms...";
  try {
    const response = await fetch(`${httpServerUrl}/rooms`);
    if (!response.ok) {
      throw new Error("Unable to load room list.");
    }
    const payload = (await response.json()) as { rooms: LobbyRoomSummary[] };
    availableRooms = payload.rooms;
    renderRoomList();
    joinRoomStatusEl.textContent = "";
  } catch (error) {
    availableRooms = [];
    renderRoomList();
    joinRoomStatusEl.textContent = error instanceof Error ? error.message : "Unable to load room list.";
  }
}

function attachTouch() {
  for (const button of touchButtons) {
    const role = button.dataset.role as PlayerRole;
    button.addEventListener("pointerdown", () => {
      if (!myRoles.includes(role)) return;
      handlePress(role);
    });
    button.addEventListener("pointerup", () => {
      if (!myRoles.includes(role)) return;
      handleRelease(role);
    });
    button.addEventListener("pointercancel", () => {
      if (!myRoles.includes(role)) return;
      handleRelease(role);
    });
    button.addEventListener("pointerleave", () => {
      if (!myRoles.includes(role)) return;
      handleRelease(role);
    });
  }
}

function bindRoom(room: Room) {
  room.onMessage("joined_room", (payload: JoinedRoomPayload) => {
    roomCode = payload.roomCode;
    myPlayerId = payload.playerId;
    myRoles = payload.roles;
    writePersistedRoom();
    updateUi();
  });

  room.onMessage("assign_role", (payload: { roles: PlayerRole[] }) => {
    myRoles = payload.roles;
    updateUi();
  });

  room.onMessage("room_state", () => {
    if (latestState?.roomState !== "lobby") {
      hostStartPending = false;
    }
    updateUi();
  });

  room.onMessage("player_status", ({ players }: { players: GameState["players"] }) => {
    if (latestState) {
      latestState.players = players;
    }
    hydrateMyRolesFromPlayers(players);
    updateUi();
    updateCreateRoomSummary();
  });

  room.onMessage("state_snapshot", (state: GameState) => {
    latestState = state;
    if (state.roomState !== "lobby") {
      hostStartPending = false;
    }
    roomCode = state.roomCode;
    hydrateMyRolesFromPlayers(state.players);
    targetTeamPosition = { ...state.teamPosition };
    obstacleTargets.clear();
    for (const obstacle of state.level.obstacles) {
      obstacleTargets.set(obstacle.id, {
        x: obstacle.position.x + obstacle.size.x / 2,
        y: obstacle.position.y + obstacle.size.y / 2,
        width: obstacle.size.x,
        height: obstacle.size.y,
        kind: obstacle.kind
      });
    }
    writePersistedRoom();
    updateUi();
  });

  room.onMessage("round_result", (result: RoundResult) => {
    latestResult = result;
    updateUi();
  });

  room.onMessage("error_event", ({ message }: { message: string }) => {
    showMenu(message);
    alert(message);
  });

  room.onMessage("pong", ({ sentAt }: { sentAt: number }) => {
    latency = Date.now() - sentAt;
    updateUi();
  });

  room.onLeave(() => {
    currentRoom = null;
    latestState = null;
    latestResult = null;
    myRoles = [];
    myPlayerId = "";
    roomCode = "";
    myRoomId = "";
    hostStartPending = false;
    obstacleTargets.clear();
    clearPersistedRoom();
    updateUi();
    if (!isTransitioningRoom) {
      showMenu(hasEnteredGame ? "Disconnected from the room." : "");
    }
  });
}

async function leaveCurrentRoom() {
  if (!currentRoom) return;
  await currentRoom.leave();
  currentRoom = null;
}

async function quitToMenu() {
  isTransitioningRoom = true;
  clearPersistedRoom();
  await leaveCurrentRoom();
  latestState = null;
  latestResult = null;
  myRoles = [];
  myPlayerId = "";
  roomCode = "";
  myRoomId = "";
  obstacleTargets.clear();
  updateUi();
  showMenu();
  isTransitioningRoom = false;
}

async function enterRoom(options: { visibility?: RoomVisibility; roomId?: string; roomCode?: string; reconnectPlayerId?: string }) {
  try {
    isTransitioningRoom = true;
    showLoading(options.roomId || options.roomCode ? "Joining room..." : "Creating your room...");
    await leaveCurrentRoom();
    const reconnectPlayerId = options.reconnectPlayerId;
    latestResult = null;
    latestState = null;
    myRoles = [];
    myPlayerId = "";
    roomCode = "";
    latency = 0;
    currentDebugSolo = Boolean(debugSoloEl.checked) && !options.roomId && !options.roomCode;

    if (options.roomId) {
      currentRoom = await colyseus.joinById(options.roomId, { reconnectPlayerId });
      currentVisibility = "public";
      myRoomId = options.roomId;
    } else if (options.roomCode) {
      const lookupRes = await fetch(`${httpServerUrl}/rooms/${encodeURIComponent(options.roomCode)}`);
      if (!lookupRes.ok) {
        throw new Error("Room not found.");
      }
      const lookup = (await lookupRes.json()) as { roomId: string };
      currentRoom = await colyseus.joinById(lookup.roomId, { reconnectPlayerId });
      currentVisibility = "private";
      myRoomId = lookup.roomId;
    } else {
      currentVisibility = options.visibility ?? "public";
      currentRoom = await colyseus.create("wasd_room", {
        debugSolo: Boolean(debugSoloEl.checked),
        visibility: currentVisibility
      });
      myRoomId = currentRoom.roomId;
    }

    bindRoom(currentRoom);
    showLoading("Loading the forest map...");
    await ensureGameStarted();
    resizeGame();
    showHud();
    updateUi();

    if (!options.roomId && !options.roomCode) {
      updateCreateRoomSummary();
      createRoomStatusEl.textContent = "";
      openModal(createRoomModalEl);
    }
  } catch (error) {
    clearPersistedRoom();
    showMenu(error instanceof Error ? error.message : "Unable to enter the room.");
  } finally {
    isTransitioningRoom = false;
  }
}

function openCreateRoomModal() {
  createRoomStatusEl.textContent = "";
  setSelectedVisibility("public");
  confirmCreateRoomEl.textContent = "Create Room";
  confirmCreateRoomEl.disabled = false;
  setVisibility(createRoomResultEl, Boolean(roomCode));
  openModal(createRoomModalEl);
}

function openJoinRoomModal() {
  joinRoomStatusEl.textContent = "";
  privateRoomCodeEl.value = "";
  renderRoomList();
  openModal(joinRoomModalEl);
  void fetchRoomList();
}

async function createRoomFromModal() {
  if (roomCode && currentRoom) {
    startGame();
    return;
  }
  createRoomStatusEl.textContent = currentVisibility === "public" ? "Creating public room..." : "Creating private room...";
  await enterRoom({ visibility: currentVisibility });
}

async function joinPrivateRoomFromModal() {
  const inviteCode = privateRoomCodeEl.value.trim().toUpperCase();
  if (!inviteCode) {
    joinRoomStatusEl.textContent = "Enter a room code to join a private room.";
    return;
  }
  await enterRoom({ roomCode: inviteCode });
}

function startGame() {
  hostStartPending = true;
  closeAllModals();
  send("start_game");
}

async function resumePersistedRoom() {
  const persistedRoom = readPersistedRoom();
  if (!persistedRoom) {
    showMenu();
    return;
  }

  myRoomId = persistedRoom.roomId;
  myPlayerId = persistedRoom.playerId;
  roomCode = persistedRoom.roomCode;
  await enterRoom({ roomId: persistedRoom.roomId, reconnectPlayerId: persistedRoom.playerId });
}

(document.getElementById("create") as HTMLButtonElement).onclick = openCreateRoomModal;
(document.getElementById("join") as HTMLButtonElement).onclick = openJoinRoomModal;
(document.getElementById("howToPlay") as HTMLButtonElement).onclick = () => openModal(howToModalEl);
(document.getElementById("closeHowTo") as HTMLButtonElement).onclick = closeAllModals;
(document.getElementById("closeCreateRoom") as HTMLButtonElement).onclick = closeAllModals;
(document.getElementById("closeJoinRoom") as HTMLButtonElement).onclick = closeAllModals;
(document.getElementById("confirmCreateRoom") as HTMLButtonElement).onclick = () => void createRoomFromModal();
(document.getElementById("refreshRooms") as HTMLButtonElement).onclick = () => void fetchRoomList();
(document.getElementById("joinByCode") as HTMLButtonElement).onclick = () => void joinPrivateRoomFromModal();
quitGameEl.onclick = () => void quitToMenu();

visibilityPublicEl.onclick = () => setSelectedVisibility("public");
visibilityPrivateEl.onclick = () => setSelectedVisibility("private");

setInterval(() => {
  const sentAt = Date.now();
  send("ping", { sentAt });
}, 1500);

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && (!howToModalEl.hidden || !createRoomModalEl.hidden || !joinRoomModalEl.hidden)) {
    closeAllModals();
    return;
  }
  if (event.key === "Escape" && currentRoom) {
    void quitToMenu();
    return;
  }
  handlePress(event.key);
});
window.addEventListener("keyup", (event) => handleRelease(event.key));
window.addEventListener("resize", resizeGame);

attachTouch();
setSelectedVisibility("public");
renderRoomList();
updateUi();
void resumePersistedRoom();
