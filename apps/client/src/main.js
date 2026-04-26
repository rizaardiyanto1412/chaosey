import Phaser from "phaser";
import { Client } from "colyseus.js";
import { mapKeyToRole } from "./lib/input";
import { DEFAULT_LEVEL_ID } from "@wasd/shared";
const serverUrl = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:3001";
const colyseus = new Client(serverUrl.replace(/^http/, "ws"));
const httpServerUrl = serverUrl.replace(/^ws/, "http");
const roomEl = document.getElementById("room");
const roleEl = document.getElementById("role");
const stateEl = document.getElementById("state");
const playersEl = document.getElementById("players");
const latencyEl = document.getElementById("latency");
const debugSoloEl = document.getElementById("debugSolo");
const debugMoveSpeedEl = document.getElementById("debugMoveSpeed");
const debugLevelIdEl = document.getElementById("debugLevelId");
const privateRoomCodeEl = document.getElementById("privateRoomCode");
const menuScreenEl = document.getElementById("menuScreen");
const loadingScreenEl = document.getElementById("loadingScreen");
const hudEl = document.getElementById("hud");
const lobbyOverlayEl = document.getElementById("lobbyOverlay");
const lobbyOverlayTitleEl = document.getElementById("lobbyOverlayTitle");
const lobbyOverlayTextEl = document.getElementById("lobbyOverlayText");
const lobbyOverlayPlayersEl = document.getElementById("lobbyOverlayPlayers");
const lobbyOverlayRoomEl = document.getElementById("lobbyOverlayRoom");
const lobbyOverlayFootnoteEl = document.getElementById("lobbyOverlayFootnote");
const howToModalEl = document.getElementById("howToModal");
const createRoomModalEl = document.getElementById("createRoomModal");
const joinRoomModalEl = document.getElementById("joinRoomModal");
const menuStatusEl = document.getElementById("menuStatus");
const createRoomStatusEl = document.getElementById("createRoomStatus");
const joinRoomStatusEl = document.getElementById("joinRoomStatus");
const loadingLabelEl = document.getElementById("loadingLabel");
const roomListEl = document.getElementById("roomList");
const createdRoomCodeEl = document.getElementById("createdRoomCode");
const createdRoomMetaEl = document.getElementById("createdRoomMeta");
const createdRoomPlayersEl = document.getElementById("createdRoomPlayers");
const createRoomResultEl = document.getElementById("createRoomResult");
const createRoomSetupEl = document.getElementById("createRoomSetup");
const confirmCreateRoomEl = document.getElementById("confirmCreateRoom");
const visibilityPublicEl = document.getElementById("visibilityPublic");
const visibilityPrivateEl = document.getElementById("visibilityPrivate");
const quitGameEl = document.getElementById("quitGame");
const roleRevealOverlayEl = document.getElementById("roleRevealOverlay");
const roleRevealKeysEl = document.getElementById("roleRevealKeys");
const roleRevealCaptionEl = document.getElementById("roleRevealCaption");
const timerEl = document.getElementById("timer");
const scoreEl = document.getElementById("score");
const leaderboardModalEl = document.getElementById("leaderboardModal");
const leaderboardListEl = document.getElementById("leaderboardList");
const touchButtons = document.querySelectorAll("[data-role]");
const persistedRoomKey = "key-chaos.active-room";
const defaultMoveSpeed = 160;
const selectedLevelId = import.meta.env.VITE_LEVEL_ID ?? DEFAULT_LEVEL_ID;
let currentRoom = null;
let latestState = null;
let latestResult = null;
let myRoles = [];
let myPlayerId = "";
let roomCode = "";
let latency = 0;
let currentVisibility = "public";
let currentDebugSolo = false;
let myRoomId = "";
let availableRooms = [];
let targetTeamPosition = { x: 100, y: 100 };
const obstacleTargets = new Map();
const referenceMapKey = (levelId) => `reference-map-${levelId}`;
const referenceTilesKey = (levelId) => `reference-tiles-${levelId}`;
const squirrelRightSheetKey = "squirrel-walk-right-12f";
const squirrelLeftSheetKey = "squirrel-walk-left-12f";
const squirrelUpSheetKey = "squirrel-walk-up-12f";
const squirrelDownSheetKey = "squirrel-walk-down-12f";
const explosionSheetKey = "explosion-spritesheet";
const explosionDieAnimKey = "explosion-die";
const acornSheetKey = "bouncing-acorn-spritesheet";
const blueSpiritEnemyKey = "blue-spirit-enemy";
const tumbleweedKey = "tumbleweed";
const coinLayerName = "coin";
const hazardMarkerLayerPattern = /^hazard_(left|right|up|down|circle)(?:_|$)/;
const tumbleweedMarkerLayerPattern = /^tumbleweed_(left|right|up|down|circle)(?:_|$)/;
let game = null;
let gameBootPromise = null;
let gameBootResolve = null;
let hasEnteredGame = false;
let isTransitioningRoom = false;
let hostStartPending = false;
let previousRoomState = null;
let roleRevealTimeout = null;
let clientRoundStartAt = 0;
let finalCompletionMs = null;
let pendingDieAnimation = null;
let audioContext = null;
function setVisibility(element, isVisible) {
    element.hidden = !isVisible;
}
function closeAllModals() {
    setVisibility(howToModalEl, false);
    setVisibility(createRoomModalEl, false);
    setVisibility(joinRoomModalEl, false);
    setVisibility(leaderboardModalEl, false);
}
function openModal(modal) {
    closeAllModals();
    setVisibility(modal, true);
}
function showMenu(status = "") {
    closeAllModals();
    setVisibility(menuScreenEl, true);
    setVisibility(loadingScreenEl, false);
    setVisibility(hudEl, false);
    setVisibility(lobbyOverlayEl, false);
    setVisibility(roleRevealOverlayEl, false);
    if (roleRevealTimeout) {
        clearTimeout(roleRevealTimeout);
        roleRevealTimeout = null;
    }
    previousRoomState = null;
    clientRoundStartAt = 0;
    finalCompletionMs = null;
    pendingDieAnimation = null;
    menuStatusEl.textContent = status;
}
function showLoading(label) {
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
function readPersistedRoom() {
    try {
        const raw = window.localStorage.getItem(persistedRoomKey);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        if (!parsed.roomId || !parsed.roomCode || !parsed.playerId)
            return null;
        return {
            roomId: parsed.roomId,
            roomCode: parsed.roomCode,
            playerId: parsed.playerId
        };
    }
    catch {
        return null;
    }
}
function writePersistedRoom() {
    if (!myRoomId || !roomCode || !myPlayerId)
        return;
    const payload = {
        roomId: myRoomId,
        roomCode,
        playerId: myPlayerId
    };
    window.localStorage.setItem(persistedRoomKey, JSON.stringify(payload));
}
function clearPersistedRoom() {
    window.localStorage.removeItem(persistedRoomKey);
}
function setSelectedVisibility(visibility) {
    currentVisibility = visibility;
    visibilityPublicEl.classList.toggle("active", visibility === "public");
    visibilityPrivateEl.classList.toggle("active", visibility === "private");
}
function updateDebugSpeedControl() {
    const debugEnabled = debugSoloEl.checked;
    debugMoveSpeedEl.disabled = !debugEnabled;
    debugLevelIdEl.disabled = !debugEnabled;
    if (!debugSoloEl.checked) {
        debugMoveSpeedEl.value = String(defaultMoveSpeed);
        debugLevelIdEl.value = DEFAULT_LEVEL_ID;
    }
}
function selectedDebugMoveSpeed() {
    if (!debugSoloEl.checked)
        return undefined;
    const speed = Number(debugMoveSpeedEl.value);
    return Number.isFinite(speed) ? speed : defaultMoveSpeed;
}
function selectedDebugLevelId() {
    return debugSoloEl.checked ? debugLevelIdEl.value : undefined;
}
function send(type, payload) {
    if (!currentRoom)
        return;
    currentRoom.send(type, payload);
}
function getAudioContext() {
    if (audioContext)
        return audioContext;
    const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextCtor)
        return null;
    audioContext = new AudioContextCtor();
    return audioContext;
}
function unlockAudio() {
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== "suspended")
        return;
    void ctx.resume();
}
function playBoomSound() {
    const ctx = getAudioContext();
    if (!ctx)
        return;
    if (ctx.state === "suspended") {
        void ctx.resume();
    }
    const startedAt = ctx.currentTime;
    const duration = 0.48;
    const impactGain = ctx.createGain();
    impactGain.gain.setValueAtTime(0.0001, startedAt);
    impactGain.gain.exponentialRampToValueAtTime(0.9, startedAt + 0.015);
    impactGain.gain.exponentialRampToValueAtTime(0.0001, startedAt + duration);
    impactGain.connect(ctx.destination);
    const thump = ctx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(92, startedAt);
    thump.frequency.exponentialRampToValueAtTime(34, startedAt + duration);
    thump.connect(impactGain);
    thump.start(startedAt);
    thump.stop(startedAt + duration);
    const sampleCount = Math.floor(ctx.sampleRate * duration);
    const noiseBuffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i += 1) {
        const fade = 1 - i / sampleCount;
        noiseData[i] = (Math.random() * 2 - 1) * fade * fade;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.setValueAtTime(1700, startedAt);
    noiseFilter.frequency.exponentialRampToValueAtTime(160, startedAt + duration);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, startedAt);
    noiseGain.gain.exponentialRampToValueAtTime(0.35, startedAt + 0.02);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, startedAt + duration);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(startedAt);
    noise.stop(startedAt + duration);
}
function handlePress(key) {
    unlockAudio();
    const role = mapKeyToRole(key);
    if (!role || !myRoles.includes(role))
        return;
    send("input_press", { role });
}
function handleRelease(key) {
    const role = mapKeyToRole(key);
    if (!role || !myRoles.includes(role))
        return;
    send("input_release", { role });
}
function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const centis = Math.floor((ms % 1000) / 10);
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    const cc = String(centis).padStart(2, "0");
    return `${mm}:${ss}.${cc}`;
}
function updateTimerDisplay() {
    if (!timerEl)
        return;
    if (finalCompletionMs !== null) {
        timerEl.textContent = formatTime(finalCompletionMs);
        return;
    }
    if (latestState?.roomState === "playing" && clientRoundStartAt > 0) {
        const elapsed = Date.now() - clientRoundStartAt;
        timerEl.textContent = formatTime(elapsed);
    }
    else if (latestState?.roomState === "lobby") {
        timerEl.textContent = "00:00.00";
    }
}
function updateScoreDisplay() {
    if (!scoreEl)
        return;
    const collected = latestState?.score ?? 0;
    const total = latestState?.level.collectibles.length ?? 0;
    scoreEl.textContent = `${collected} / ${total}`;
}
class MainScene extends Phaser.Scene {
    playerSprite;
    dieSprite;
    hazards = {};
    tumbleweeds = {};
    acorns = new Map();
    collectedAcornIds = new Set();
    goal;
    statusText;
    renderedLevelId = selectedLevelId;
    mapWidth = 1200;
    mapHeight = 800;
    lastFacing = "down";
    keepPlayerHiddenAfterDie = false;
    constructor() {
        super("main");
    }
    resolveSpawn(tilemap) {
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
            if (!data)
                continue;
            for (let row = 0; row < data.length; row += 1) {
                for (let col = 0; col < data[row].length; col += 1) {
                    const tile = data[row][col];
                    if (!tile || tile.index < 0)
                        continue;
                    return {
                        x: col * tilemap.tileWidth + tilemap.tileWidth / 2,
                        y: row * tilemap.tileHeight + tilemap.tileHeight / 2
                    };
                }
            }
        }
        return { x: 100, y: 100 };
    }
    tileCentersForLayer(tilemap, layerName) {
        const tileLayerData = tilemap.getLayer(layerName);
        const data = tileLayerData?.data ?? tileLayerData?.tilemapLayer?.layer.data;
        if (!data)
            return [];
        const centers = [];
        for (let row = 0; row < data.length; row += 1) {
            for (let col = 0; col < data[row].length; col += 1) {
                const tile = data[row][col];
                if (!tile || tile.index < 0)
                    continue;
                centers.push({
                    x: col * tilemap.tileWidth + tilemap.tileWidth / 2,
                    y: row * tilemap.tileHeight + tilemap.tileHeight / 2
                });
            }
        }
        return centers;
    }
    preload() {
        const levelId = latestState?.level.id ?? selectedLevelId;
        this.renderedLevelId = levelId;
        this.load.tilemapTiledJSON(referenceMapKey(levelId), `/maps/levels/${levelId}/map.json`);
        this.load.image(referenceTilesKey(levelId), `/maps/levels/${levelId}/spritesheet.png`);
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
        this.load.spritesheet(explosionSheetKey, "/assets/sprites/explosion-spritesheet.png", {
            frameWidth: 415,
            frameHeight: 417
        });
        this.load.spritesheet(acornSheetKey, "/assets/items/bouncing-acorn-spritesheet.png", {
            frameWidth: 231,
            frameHeight: 295
        });
        this.load.image(blueSpiritEnemyKey, "/assets/enemies/blue-spirit-hd-transparent.png");
        this.load.image(tumbleweedKey, "/assets/enemies/tumbleweed-hd-transparent.png");
    }
    create() {
        const tilemap = this.make.tilemap({ key: referenceMapKey(this.renderedLevelId) });
        let initialSpawn = { x: 100, y: 100 };
        if (tilemap) {
            const tileset = tilemap.addTilesetImage("spritefusion", referenceTilesKey(this.renderedLevelId));
            if (tileset) {
                let depth = 0;
                for (const layer of tilemap.layers) {
                    if (layer.name === coinLayerName || hazardMarkerLayerPattern.test(layer.name.toLowerCase()) || tumbleweedMarkerLayerPattern.test(layer.name.toLowerCase())) {
                        depth += 1;
                        continue;
                    }
                    const created = tilemap.createLayer(layer.name, tileset, 0, 0);
                    created?.setDepth(depth);
                    depth += 1;
                }
                for (const [index, position] of this.tileCentersForLayer(tilemap, coinLayerName).entries()) {
                    const id = `acorn-${Math.floor(position.x / tilemap.tileWidth)}-${Math.floor(position.y / tilemap.tileHeight)}`;
                    const acorn = this.add.sprite(position.x, position.y, acornSheetKey, 0);
                    acorn.setDepth(150);
                    acorn.setDisplaySize(56, 72);
                    acorn.setOrigin(0.5, 0.72);
                    this.acorns.set(id || `acorn-${index}`, acorn);
                }
            }
            this.mapWidth = tilemap.widthInPixels;
            this.mapHeight = tilemap.heightInPixels;
            initialSpawn = this.resolveSpawn(tilemap);
            targetTeamPosition = { ...initialSpawn };
        }
        else {
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
        if (!this.anims.exists(explosionDieAnimKey)) {
            this.anims.create({
                key: explosionDieAnimKey,
                frames: this.anims.generateFrameNumbers(explosionSheetKey, { start: 1, end: 7 }),
                frameRate: 14,
                repeat: 0
            });
        }
        this.playerSprite = this.add.sprite(initialSpawn.x, initialSpawn.y, squirrelDownSheetKey, 0);
        this.playerSprite.setDepth(200);
        this.playerSprite.setDisplaySize(128, 128);
        this.playerSprite.setOrigin(0.5, 0.82);
        this.dieSprite = this.add.sprite(initialSpawn.x, initialSpawn.y, explosionSheetKey, 1);
        this.dieSprite.setDepth(320);
        this.dieSprite.setDisplaySize(220, 220);
        this.dieSprite.setOrigin(0.5, 0.5);
        this.dieSprite.setVisible(false);
        this.dieSprite.on(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
            this.dieSprite?.setVisible(false);
            this.playerSprite?.setVisible(!this.keepPlayerHiddenAfterDie);
        });
        this.statusText = this.add.text(24, 20, "Waiting for room...", {
            fontFamily: "Trebuchet MS",
            fontSize: "20px",
            color: "#f8fafc"
        });
        this.statusText.setDepth(1000).setScrollFactor(0);
        this.cameras.main.setBounds(0, 0, this.mapWidth, this.mapHeight);
        this.cameras.main.startFollow(this.playerSprite, true, 0.1, 0.1);
        this.cameras.main.setBackgroundColor("#0f172a");
        this.input.keyboard?.on("keydown", (event) => handlePress(event.key));
        this.input.keyboard?.on("keyup", (event) => handleRelease(event.key));
        signalGameBooted();
    }
    playDieAnimation(position, keepPlayerHidden) {
        if (!this.dieSprite || !this.playerSprite)
            return;
        this.keepPlayerHiddenAfterDie = keepPlayerHidden;
        this.dieSprite.setPosition(position.x, position.y);
        this.dieSprite.setVisible(true);
        this.dieSprite.anims.play(explosionDieAnimKey, true);
        this.playerSprite.setVisible(false);
        this.cameras.main.shake(220, 0.012);
        this.cameras.main.flash(90, 255, 244, 214);
        playBoomSound();
    }
    isRenderingLevel(levelId) {
        return this.renderedLevelId === levelId;
    }
    update(_time, delta) {
        if (!latestState || !this.playerSprite)
            return;
        if (latestState.roomState === "playing" && !this.dieSprite?.visible) {
            this.keepPlayerHiddenAfterDie = false;
            this.playerSprite.setVisible(true);
        }
        if (pendingDieAnimation) {
            this.playDieAnimation(pendingDieAnimation.position, pendingDieAnimation.keepPlayerHidden);
            pendingDieAnimation = null;
        }
        const smoothFactor = Math.min(1, (delta / 1000) * 14);
        const nextX = Phaser.Math.Linear(this.playerSprite.x, targetTeamPosition.x, smoothFactor);
        const nextY = Phaser.Math.Linear(this.playerSprite.y, targetTeamPosition.y, smoothFactor);
        const dx = nextX - this.playerSprite.x;
        const dy = nextY - this.playerSprite.y;
        this.playerSprite.setPosition(nextX, nextY);
        const moving = Math.hypot(dx, dy) > 0.15;
        if (moving) {
            let facing;
            if (Math.abs(dx) > Math.abs(dy)) {
                facing = dx > 0 ? "right" : "left";
            }
            else {
                facing = dy > 0 ? "down" : "up";
            }
            const animKey = `squirrel-walk-${facing}`;
            const current = this.playerSprite.anims.currentAnim;
            if (!this.playerSprite.anims.isPlaying || !current || current.key !== animKey) {
                this.playerSprite.anims.play(animKey, true);
            }
            this.lastFacing = facing;
        }
        else if (this.playerSprite.anims.isPlaying) {
            this.playerSprite.anims.stop();
            if (this.lastFacing === "right") {
                this.playerSprite.setTexture(squirrelRightSheetKey, 0);
            }
            else if (this.lastFacing === "left") {
                this.playerSprite.setTexture(squirrelLeftSheetKey, 0);
            }
            else if (this.lastFacing === "up") {
                this.playerSprite.setTexture(squirrelUpSheetKey, 0);
            }
            else {
                this.playerSprite.setTexture(squirrelDownSheetKey, 0);
            }
        }
        this.statusText?.setText(latestResult
            ? latestResult.outcome === "win"
                ? `Round won! Time: ${formatTime(latestResult.completionMs ?? 0)}. Host can restart.`
                : `Round failed: ${latestResult.failReason}`
            : latestState.roomState === "countdown"
                ? `Countdown: ${(latestState.countdownRemainingMs / 1000).toFixed(1)}s`
                : `Room ${latestState.roomCode} • ${latestState.roomState}`);
        updateTimerDisplay();
        this.syncCollectedAcorns();
        for (const id of Object.keys(this.hazards)) {
            if (obstacleTargets.has(id))
                continue;
            this.hazards[id].destroy();
            delete this.hazards[id];
        }
        for (const id of Object.keys(this.tumbleweeds)) {
            if (obstacleTargets.has(id))
                continue;
            this.tumbleweeds[id].destroy();
            delete this.tumbleweeds[id];
        }
        if (this.goal && ![...obstacleTargets.values()].some((obstacle) => obstacle.kind === "goal")) {
            this.goal.destroy();
            this.goal = undefined;
        }
        for (const [id, obstacle] of obstacleTargets.entries()) {
            if (obstacle.kind === "goal") {
                if (!this.goal) {
                    this.goal = this.add.rectangle(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 0x22c55e);
                }
                this.goal.width = obstacle.width;
                this.goal.height = obstacle.height;
                this.goal.setPosition(Phaser.Math.Linear(this.goal.x, obstacle.x, smoothFactor), Phaser.Math.Linear(this.goal.y, obstacle.y, smoothFactor));
                continue;
            }
            if (obstacle.kind === "hazard") {
                if (!this.hazards[id]) {
                    this.hazards[id] = this.add.sprite(obstacle.x, obstacle.y, blueSpiritEnemyKey);
                    this.hazards[id].setDepth(175);
                    this.hazards[id].setOrigin(0.5);
                }
                const visualSize = Math.max(obstacle.width, obstacle.height) * 1.25;
                this.hazards[id].setDisplaySize(visualSize, visualSize);
                this.hazards[id].setPosition(Phaser.Math.Linear(this.hazards[id].x, obstacle.x, smoothFactor), Phaser.Math.Linear(this.hazards[id].y, obstacle.y, smoothFactor));
                this.hazards[id].setAlpha(0.92 + Math.sin(_time * 0.008 + id.length) * 0.08);
            }
            else if (obstacle.kind === "tumbleweed") {
                if (!this.tumbleweeds[id]) {
                    this.tumbleweeds[id] = this.add.sprite(obstacle.x, obstacle.y, tumbleweedKey);
                    this.tumbleweeds[id].setDepth(175);
                    this.tumbleweeds[id].setOrigin(0.5);
                }
                const visualSize = Math.max(obstacle.width, obstacle.height) * 1.25;
                this.tumbleweeds[id].setDisplaySize(visualSize, visualSize);
                this.tumbleweeds[id].setPosition(Phaser.Math.Linear(this.tumbleweeds[id].x, obstacle.x, smoothFactor), Phaser.Math.Linear(this.tumbleweeds[id].y, obstacle.y, smoothFactor));
                this.tumbleweeds[id].setAlpha(0.92 + Math.sin(_time * 0.008 + id.length) * 0.08);
            }
        }
    }
    syncCollectedAcorns() {
        const collectedIds = new Set(latestState?.collectedCollectibleIds ?? []);
        for (const id of collectedIds) {
            const acorn = this.acorns.get(id);
            if (!acorn || this.collectedAcornIds.has(id))
                continue;
            this.collectedAcornIds.add(id);
            const popup = this.add.text(acorn.x, acorn.y - 46, "+1", {
                fontFamily: "Trebuchet MS",
                fontSize: "26px",
                color: "#fff4b8",
                stroke: "#5a2f12",
                strokeThickness: 5
            });
            popup.setDepth(260);
            popup.setOrigin(0.5);
            this.tweens.add({
                targets: popup,
                y: popup.y - 34,
                alpha: 0,
                duration: 650,
                ease: "Cubic.easeOut",
                onComplete: () => popup.destroy()
            });
            this.tweens.add({
                targets: acorn,
                scaleX: 0,
                scaleY: 0,
                alpha: 0,
                duration: 180,
                ease: "Back.easeIn",
                onComplete: () => acorn.setVisible(false)
            });
        }
        for (const [id, acorn] of this.acorns.entries()) {
            if (collectedIds.has(id))
                continue;
            acorn.setVisible(true);
            acorn.setAlpha(1);
            acorn.setDisplaySize(56, 72);
            this.collectedAcornIds.delete(id);
        }
    }
}
function ensureGameStarted() {
    if (game)
        return gameBootPromise ?? Promise.resolve();
    gameBootPromise = new Promise((resolve) => {
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
    const hasRoom = Boolean(roomCode);
    setVisibility(createRoomResultEl, hasRoom);
    setVisibility(createRoomSetupEl, !hasRoom);
    createdRoomCodeEl.textContent = roomCode || "----";
    createdRoomMetaEl.textContent = `Visibility: ${currentVisibility === "public" ? "Public" : "Private"}`;
    const playerCount = latestState?.players.length ?? (currentRoom ? 1 : 0);
    createdRoomPlayersEl.textContent = `${playerCount}/4`;
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
function showRoleReveal(roles) {
    if (!roleRevealOverlayEl || !roleRevealKeysEl)
        return;
    roleRevealKeysEl.innerHTML = "";
    if (roles.length === 0) {
        const badge = document.createElement("div");
        badge.className = "role-reveal-key";
        badge.textContent = "?";
        roleRevealKeysEl.appendChild(badge);
        roleRevealCaptionEl.textContent = "No key assigned yet. Hang tight!";
    }
    else {
        for (const role of roles) {
            const badge = document.createElement("div");
            badge.className = "role-reveal-key";
            badge.textContent = role;
            roleRevealKeysEl.appendChild(badge);
        }
        roleRevealCaptionEl.textContent =
            roles.length > 1
                ? "You control these keys. Hold them to move the squirrel."
                : "Hold this key to move the squirrel.";
    }
    setVisibility(roleRevealOverlayEl, true);
    // Restart CSS animations by forcing reflow.
    roleRevealOverlayEl.style.animation = "none";
    void roleRevealOverlayEl.offsetWidth;
    roleRevealOverlayEl.style.animation = "";
    if (roleRevealTimeout) {
        clearTimeout(roleRevealTimeout);
    }
    roleRevealTimeout = setTimeout(() => {
        setVisibility(roleRevealOverlayEl, false);
        roleRevealTimeout = null;
        // Start the timer only after the role reveal animation finishes
        clientRoundStartAt = Date.now();
    }, 2600);
}
function showWinReveal(result) {
    if (!roleRevealOverlayEl || !roleRevealKeysEl)
        return;
    roleRevealKeysEl.innerHTML = "";
    const badge = document.createElement("div");
    badge.className = "role-reveal-key";
    badge.textContent = "GOAL!";
    roleRevealKeysEl.appendChild(badge);
    const collected = latestState?.score ?? 0;
    const total = latestState?.level.collectibles.length ?? 0;
    roleRevealCaptionEl.textContent = `Finished in ${formatTime(result.completionMs ?? 0)} • Acorns ${collected}/${total}`;
    setVisibility(roleRevealOverlayEl, true);
    roleRevealOverlayEl.style.animation = "none";
    void roleRevealOverlayEl.offsetWidth;
    roleRevealOverlayEl.style.animation = "";
    if (roleRevealTimeout) {
        clearTimeout(roleRevealTimeout);
    }
    roleRevealTimeout = setTimeout(() => {
        setVisibility(roleRevealOverlayEl, false);
        roleRevealTimeout = null;
    }, 3200);
}
function maybeTriggerRoleReveal(nextRoomState) {
    if (previousRoomState === "lobby" && nextRoomState === "playing") {
        showRoleReveal(myRoles);
        finalCompletionMs = null;
    }
    previousRoomState = nextRoomState;
}
function updateLobbyOverlay() {
    if (!latestState || !myPlayerId) {
        setVisibility(lobbyOverlayEl, false);
        return;
    }
    const isHost = latestState.hostId === myPlayerId;
    const shouldShow = latestState.roomState === "lobby" && !isHost;
    setVisibility(lobbyOverlayEl, shouldShow);
    if (!shouldShow)
        return;
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
    if (!latestState || !roomCode)
        return;
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
    }
    else {
        const lines = latestState.players.map((p) => `${p.name} [${p.roles.join("+")}] ${p.connected ? "online" : "offline"}`);
        playersEl.textContent = lines.join("\n");
    }
    updateStartAvailability();
    updateCreateRoomSummary();
    updateLobbyOverlay();
    syncLobbyControls();
    updateScoreDisplay();
}
function hydrateMyRolesFromPlayers(players) {
    if (!myPlayerId)
        return;
    const me = players.find((p) => p.id === myPlayerId);
    if (!me)
        return;
    myRoles = me.roles;
}
function renderRoomList() {
    if (availableRooms.length === 0) {
        roomListEl.innerHTML = '<div class="server-empty">No public rooms are open right now.</div>';
        return;
    }
    roomListEl.innerHTML = availableRooms
        .map((room) => `
        <div class="server-card">
          <div class="server-card-copy">
            <strong>Room ${room.roomCode}</strong>
            <span>${room.playerCount}/${room.maxClients} players • ${room.roomState}</span>
          </div>
          <button class="menu-button secondary" type="button" data-room-id="${room.roomId}">Join</button>
        </div>
      `)
        .join("");
    for (const button of roomListEl.querySelectorAll("[data-room-id]")) {
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
        const payload = (await response.json());
        availableRooms = payload.rooms;
        renderRoomList();
        joinRoomStatusEl.textContent = "";
    }
    catch (error) {
        availableRooms = [];
        renderRoomList();
        joinRoomStatusEl.textContent = error instanceof Error ? error.message : "Unable to load room list.";
    }
}
async function fetchLeaderboard() {
    if (!leaderboardListEl)
        return;
    leaderboardListEl.innerHTML = '<div class="leaderboard-empty">Loading...</div>';
    try {
        const response = await fetch(`${httpServerUrl}/leaderboard`);
        if (!response.ok) {
            throw new Error("Unable to load leaderboard.");
        }
        const payload = (await response.json());
        renderLeaderboard(payload.entries);
    }
    catch {
        leaderboardListEl.innerHTML = '<div class="leaderboard-empty">Unable to load leaderboard.</div>';
    }
}
function renderLeaderboard(entries) {
    if (!leaderboardListEl)
        return;
    if (entries.length === 0) {
        leaderboardListEl.innerHTML = '<div class="leaderboard-empty">No records yet. Be the first to win!</div>';
        return;
    }
    leaderboardListEl.innerHTML = entries
        .map((entry, index) => {
        const rankClass = index === 0 ? "top-1" : index === 1 ? "top-2" : index === 2 ? "top-3" : "";
        const timeStr = formatTime(entry.completionMs);
        const dateStr = new Date(entry.at).toLocaleDateString();
        return `
        <div class="leaderboard-entry">
          <div class="leaderboard-rank ${rankClass}">${index + 1}</div>
          <div class="leaderboard-info">
            <div class="leaderboard-time">${timeStr}</div>
            <div class="leaderboard-meta">${dateStr} • Room ${entry.roomCode}</div>
          </div>
          <div class="leaderboard-players">${entry.playerCount}P</div>
        </div>
      `;
    })
        .join("");
}
function openLeaderboardModal() {
    void fetchLeaderboard();
    openModal(leaderboardModalEl);
}
function attachTouch() {
    for (const button of touchButtons) {
        const role = button.dataset.role;
        button.addEventListener("pointerdown", () => {
            unlockAudio();
            if (!myRoles.includes(role))
                return;
            handlePress(role);
        });
        button.addEventListener("pointerup", () => {
            if (!myRoles.includes(role))
                return;
            handleRelease(role);
        });
        button.addEventListener("pointercancel", () => {
            if (!myRoles.includes(role))
                return;
            handleRelease(role);
        });
        button.addEventListener("pointerleave", () => {
            if (!myRoles.includes(role))
                return;
            handleRelease(role);
        });
    }
}
function bindRoom(room) {
    room.onMessage("joined_room", (payload) => {
        roomCode = payload.roomCode;
        myPlayerId = payload.playerId;
        myRoles = payload.roles;
        writePersistedRoom();
        updateUi();
    });
    room.onMessage("assign_role", (payload) => {
        myRoles = payload.roles;
        updateUi();
    });
    room.onMessage("room_state", () => {
        if (latestState?.roomState !== "lobby") {
            hostStartPending = false;
        }
        updateUi();
    });
    room.onMessage("player_status", ({ players }) => {
        if (latestState) {
            latestState.players = players;
        }
        hydrateMyRolesFromPlayers(players);
        updateUi();
        updateCreateRoomSummary();
    });
    room.onMessage("state_snapshot", (state) => {
        const previousState = latestState;
        latestState = state;
        const mainScene = game?.scene.getScene("main");
        if ((previousState && previousState.level.id !== state.level.id) || (mainScene && !mainScene.isRenderingLevel(state.level.id))) {
            latestResult = null;
            pendingDieAnimation = null;
            obstacleTargets.clear();
            targetTeamPosition = { ...state.teamPosition };
            game?.scene.stop("main");
            game?.scene.start("main");
        }
        if (state.roomState !== "lobby") {
            hostStartPending = false;
        }
        roomCode = state.roomCode;
        hydrateMyRolesFromPlayers(state.players);
        maybeTriggerRoleReveal(state.roomState);
        if (previousState?.roomState === "playing" && state.roomState === "playing") {
            const spawn = state.level.spawn;
            const distanceFromSpawn = Math.hypot(state.teamPosition.x - spawn.x, state.teamPosition.y - spawn.y);
            const previousDistanceFromSpawn = Math.hypot(previousState.teamPosition.x - previousState.level.spawn.x, previousState.teamPosition.y - previousState.level.spawn.y);
            if (distanceFromSpawn <= state.level.playerRadius && previousDistanceFromSpawn > state.level.playerRadius * 2) {
                pendingDieAnimation = {
                    position: { ...previousState.teamPosition },
                    keepPlayerHidden: false
                };
            }
        }
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
    room.onMessage("round_result", (result) => {
        latestResult = result;
        if (result.outcome === "fail" && result.failReason === "trap_hit" && latestState) {
            pendingDieAnimation = {
                position: { ...latestState.teamPosition },
                keepPlayerHidden: true
            };
        }
        if (result.outcome === "win" && result.completionMs !== undefined) {
            finalCompletionMs = result.completionMs;
            showWinReveal(result);
        }
        updateUi();
    });
    room.onMessage("error_event", ({ message }) => {
        showMenu(message);
        alert(message);
    });
    room.onMessage("pong", ({ sentAt }) => {
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
        pendingDieAnimation = null;
        clearPersistedRoom();
        updateUi();
        if (!isTransitioningRoom) {
            showMenu(hasEnteredGame ? "Disconnected from the room." : "");
        }
    });
}
async function leaveCurrentRoom() {
    if (!currentRoom)
        return;
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
    pendingDieAnimation = null;
    updateUi();
    showMenu();
    isTransitioningRoom = false;
}
async function enterRoom(options) {
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
        }
        else if (options.roomCode) {
            const lookupRes = await fetch(`${httpServerUrl}/rooms/${encodeURIComponent(options.roomCode)}`);
            if (!lookupRes.ok) {
                throw new Error("Room not found.");
            }
            const lookup = (await lookupRes.json());
            currentRoom = await colyseus.joinById(lookup.roomId, { reconnectPlayerId });
            currentVisibility = "private";
            myRoomId = lookup.roomId;
        }
        else {
            currentVisibility = options.visibility ?? "public";
            currentRoom = await colyseus.create("wasd_room", {
                debugSolo: Boolean(debugSoloEl.checked),
                debugMoveSpeed: selectedDebugMoveSpeed(),
                debugLevelId: selectedDebugLevelId(),
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
    }
    catch (error) {
        clearPersistedRoom();
        showMenu(error instanceof Error ? error.message : "Unable to enter the room.");
    }
    finally {
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
document.getElementById("create").onclick = openCreateRoomModal;
document.getElementById("join").onclick = openJoinRoomModal;
document.getElementById("howToPlay").onclick = () => openModal(howToModalEl);
document.getElementById("closeHowTo").onclick = closeAllModals;
document.getElementById("leaderboard").onclick = openLeaderboardModal;
document.getElementById("closeLeaderboard").onclick = closeAllModals;
document.getElementById("closeCreateRoom").onclick = () => void quitToMenu();
document.getElementById("closeJoinRoom").onclick = closeAllModals;
document.getElementById("confirmCreateRoom").onclick = () => void createRoomFromModal();
document.getElementById("refreshRooms").onclick = () => void fetchRoomList();
document.getElementById("joinByCode").onclick = () => void joinPrivateRoomFromModal();
quitGameEl.onclick = () => void quitToMenu();
visibilityPublicEl.onclick = () => setSelectedVisibility("public");
visibilityPrivateEl.onclick = () => setSelectedVisibility("private");
debugSoloEl.onchange = updateDebugSpeedControl;
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
updateDebugSpeedControl();
renderRoomList();
updateUi();
void resumePersistedRoom();
