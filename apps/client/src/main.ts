import Phaser from "phaser";
import { Client, type Room } from "colyseus.js";
import { mapKeyToRole } from "./lib/input";
import type { GameState, JoinedRoomPayload, PlayerRole, RoundResult } from "@wasd/shared";

const serverUrl = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:3001";
const colyseus = new Client(serverUrl.replace(/^http/, "ws"));
const httpServerUrl = serverUrl.replace(/^ws/, "http");

const roomEl = document.getElementById("room") as HTMLDivElement;
const roleEl = document.getElementById("role") as HTMLDivElement;
const stateEl = document.getElementById("state") as HTMLDivElement;
const playersEl = document.getElementById("players") as HTMLDivElement;
const latencyEl = document.getElementById("latency") as HTMLDivElement;
const nameEl = document.getElementById("name") as HTMLInputElement;
const roomCodeEl = document.getElementById("roomCode") as HTMLInputElement;
const debugSoloEl = document.getElementById("debugSolo") as HTMLInputElement;

const touchButtons = document.querySelectorAll<HTMLButtonElement>("[data-role]");

let currentRoom: Room | null = null;
let myRoles: PlayerRole[] = [];
let myPlayerName = "";
let roomCode = "";
let latestState: GameState | null = null;
let latestResult: RoundResult | null = null;
let meReady = false;
let latency = 0;
let targetTeamPosition = { x: 100, y: 100 };
const obstacleTargets = new Map<
  string,
  { x: number; y: number; width: number; height: number; kind: "hazard" | "goal" }
>();
const referenceMapKey = "reference-map";
const referenceTilesKey = "reference-tiles";
const squirrelSheetKey = "squirrel-walk-4dir-7f-v1";
const squirrelRightSheetKey = "squirrel-walk-right-12f";
const squirrelLeftSheetKey = "squirrel-walk-left-12f";
const squirrelUpSheetKey = "squirrel-walk-up-12f";
const squirrelDownSheetKey = "squirrel-walk-down-12f";

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
    this.load.spritesheet(squirrelSheetKey, "/assets/characters/squirrel-walk-4dir-7f-v1.png", {
      frameWidth: 128,
      frameHeight: 128
    });
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

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 1200,
  height: 800,
  backgroundColor: "#0f172a",
  scene: [MainScene]
});

function updateUi() {
  roleEl.textContent = `Role: ${myRoles.length ? myRoles.join(" + ") : "-"}`;
  roomEl.textContent = `Room: ${roomCode || "-"}`;
  stateEl.textContent = `State: ${latestState?.roomState ?? "-"}`;
  latencyEl.textContent = `RTT: ${Math.round(latency)} ms`;

  if (!latestState) {
    playersEl.textContent = "Players: -";
  } else {
    const lines = latestState.players.map(
      (p) => `${p.name} [${p.roles.join("+")}] ${p.connected ? "online" : "offline"} ${p.ready ? "ready" : "not ready"}`
    );
    playersEl.textContent = lines.join("\n");
  }
}

function hydrateMyRolesFromPlayers(players: GameState["players"]) {
  if (!myPlayerName) return;
  const me = players.find((p) => p.name === myPlayerName && p.connected);
  if (!me) return;
  myRoles = me.roles;
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
    roomCodeEl.value = payload.roomCode;
    myRoles = payload.roles;
    updateUi();
  });

  room.onMessage("assign_role", (payload: { roles: PlayerRole[] }) => {
    myRoles = payload.roles;
    updateUi();
  });

  room.onMessage("room_state", () => {
    updateUi();
  });

  room.onMessage("player_status", ({ players }: { players: GameState["players"] }) => {
    hydrateMyRolesFromPlayers(players);
    if (!latestState) return;
    latestState.players = players;
    updateUi();
  });

  room.onMessage("state_snapshot", (state: GameState) => {
    latestState = state;
    roomCode = state.roomCode;
    roomCodeEl.value = state.roomCode;
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
    updateUi();
  });

  room.onMessage("round_result", (result: RoundResult) => {
    latestResult = result;
    updateUi();
  });

  room.onMessage("error_event", ({ message }: { message: string }) => {
    alert(message);
  });

  room.onMessage("pong", ({ sentAt }: { sentAt: number }) => {
    latency = Date.now() - sentAt;
    updateUi();
  });

  room.onLeave(() => {
    currentRoom = null;
    myRoles = [];
    myPlayerName = "";
    roomCode = "";
    latestState = null;
    obstacleTargets.clear();
    updateUi();
  });
}

async function leaveCurrentRoom() {
  if (!currentRoom) return;
  await currentRoom.leave();
  currentRoom = null;
}

async function createRoom() {
  const playerName = nameEl.value.trim();
  if (!playerName) return;

  try {
    await leaveCurrentRoom();
    myPlayerName = playerName;
    const room = await colyseus.create("wasd_room", { playerName, debugSolo: Boolean(debugSoloEl?.checked) });
    currentRoom = room;
    latestResult = null;
    meReady = false;
    bindRoom(room);
  } catch (error) {
    alert(error instanceof Error ? error.message : "Failed to create room");
  }
}

async function joinRoom() {
  const playerName = nameEl.value.trim();
  const joinCode = roomCodeEl.value.trim().toUpperCase();
  if (!playerName || !joinCode) return;

  try {
    await leaveCurrentRoom();
    myPlayerName = playerName;
    const lookupRes = await fetch(`${httpServerUrl}/rooms/${encodeURIComponent(joinCode)}`);
    if (!lookupRes.ok) {
      alert("Room not found.");
      return;
    }
    const lookup = (await lookupRes.json()) as { roomId: string };
    const room = await colyseus.joinById(lookup.roomId, { playerName });
    currentRoom = room;
    latestResult = null;
    meReady = false;
    bindRoom(room);
  } catch (error) {
    alert(error instanceof Error ? error.message : "Failed to join room");
  }
}

function toggleReady() {
  meReady = !meReady;
  send("ready_state", { ready: meReady });
}

function startGame() {
  send("start_game");
}

function restartRound() {
  latestResult = null;
  send("restart_round");
}

(document.getElementById("create") as HTMLButtonElement).onclick = createRoom;
(document.getElementById("join") as HTMLButtonElement).onclick = joinRoom;
(document.getElementById("ready") as HTMLButtonElement).onclick = toggleReady;
(document.getElementById("start") as HTMLButtonElement).onclick = startGame;
(document.getElementById("restart") as HTMLButtonElement).onclick = restartRound;

setInterval(() => {
  const sentAt = Date.now();
  send("ping", { sentAt });
}, 1500);

window.addEventListener("keydown", (event) => handlePress(event.key));
window.addEventListener("keyup", (event) => handleRelease(event.key));

attachTouch();
updateUi();

void game;
