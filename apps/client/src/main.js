import Phaser from "phaser";
import { Client } from "colyseus.js";
import { mapKeyToRole } from "./lib/input";
const serverUrl = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:3001";
const colyseus = new Client(serverUrl.replace(/^http/, "ws"));
const httpServerUrl = serverUrl.replace(/^ws/, "http");
const roomEl = document.getElementById("room");
const roleEl = document.getElementById("role");
const stateEl = document.getElementById("state");
const playersEl = document.getElementById("players");
const latencyEl = document.getElementById("latency");
const nameEl = document.getElementById("name");
const roomCodeEl = document.getElementById("roomCode");
const touchButtons = document.querySelectorAll("[data-role]");
let currentRoom = null;
let myRoles = [];
let myPlayerName = "";
let roomCode = "";
let latestState = null;
let latestResult = null;
let meReady = false;
let latency = 0;
let targetTeamPosition = { x: 100, y: 100 };
const obstacleTargets = new Map();
function send(type, payload) {
    if (!currentRoom)
        return;
    currentRoom.send(type, payload);
}
function handlePress(key) {
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
class MainScene extends Phaser.Scene {
    marker;
    hazards = {};
    goal;
    statusText;
    constructor() {
        super("main");
    }
    create() {
        this.add.rectangle(600, 400, 1200, 800, 0x0b1220).setStrokeStyle(2, 0x475569);
        this.marker = this.add.ellipse(100, 100, 36, 36, 0xf97316);
        this.statusText = this.add.text(24, 20, "Waiting for room...", {
            fontFamily: "Trebuchet MS",
            fontSize: "20px",
            color: "#f8fafc"
        });
        this.input.keyboard?.on("keydown", (event) => handlePress(event.key));
        this.input.keyboard?.on("keyup", (event) => handleRelease(event.key));
    }
    update(_time, delta) {
        if (!latestState || !this.marker)
            return;
        const smoothFactor = Math.min(1, (delta / 1000) * 14);
        this.marker.setPosition(Phaser.Math.Linear(this.marker.x, targetTeamPosition.x, smoothFactor), Phaser.Math.Linear(this.marker.y, targetTeamPosition.y, smoothFactor));
        this.statusText?.setText(latestResult
            ? latestResult.outcome === "win"
                ? "Round won. Host can restart."
                : `Round failed: ${latestResult.failReason}`
            : latestState.roomState === "countdown"
                ? `Countdown: ${(latestState.countdownRemainingMs / 1000).toFixed(1)}s`
                : `Room ${latestState.roomCode} • ${latestState.roomState}`);
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
            if (!this.hazards[id]) {
                this.hazards[id] = this.add.rectangle(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 0xef4444);
            }
            this.hazards[id].width = obstacle.width;
            this.hazards[id].height = obstacle.height;
            this.hazards[id].setPosition(Phaser.Math.Linear(this.hazards[id].x, obstacle.x, smoothFactor), Phaser.Math.Linear(this.hazards[id].y, obstacle.y, smoothFactor));
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
    }
    else {
        const lines = latestState.players.map((p) => `${p.name} [${p.roles.join("+")}] ${p.connected ? "online" : "offline"} ${p.ready ? "ready" : "not ready"}`);
        playersEl.textContent = lines.join("\n");
    }
}
function hydrateMyRolesFromPlayers(players) {
    if (!myPlayerName)
        return;
    const me = players.find((p) => p.name === myPlayerName && p.connected);
    if (!me)
        return;
    myRoles = me.roles;
}
function attachTouch() {
    for (const button of touchButtons) {
        const role = button.dataset.role;
        button.addEventListener("pointerdown", () => {
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
        roomCodeEl.value = payload.roomCode;
        myRoles = payload.roles;
        updateUi();
    });
    room.onMessage("assign_role", (payload) => {
        myRoles = payload.roles;
        updateUi();
    });
    room.onMessage("room_state", () => {
        updateUi();
    });
    room.onMessage("player_status", ({ players }) => {
        hydrateMyRolesFromPlayers(players);
        if (!latestState)
            return;
        latestState.players = players;
        updateUi();
    });
    room.onMessage("state_snapshot", (state) => {
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
    room.onMessage("round_result", (result) => {
        latestResult = result;
        updateUi();
    });
    room.onMessage("error_event", ({ message }) => {
        alert(message);
    });
    room.onMessage("pong", ({ sentAt }) => {
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
    if (!currentRoom)
        return;
    await currentRoom.leave();
    currentRoom = null;
}
async function createRoom() {
    const playerName = nameEl.value.trim();
    if (!playerName)
        return;
    try {
        await leaveCurrentRoom();
        myPlayerName = playerName;
        const room = await colyseus.create("wasd_room", { playerName });
        currentRoom = room;
        latestResult = null;
        meReady = false;
        bindRoom(room);
    }
    catch (error) {
        alert(error instanceof Error ? error.message : "Failed to create room");
    }
}
async function joinRoom() {
    const playerName = nameEl.value.trim();
    const joinCode = roomCodeEl.value.trim().toUpperCase();
    if (!playerName || !joinCode)
        return;
    try {
        await leaveCurrentRoom();
        myPlayerName = playerName;
        const lookupRes = await fetch(`${httpServerUrl}/rooms/${encodeURIComponent(joinCode)}`);
        if (!lookupRes.ok) {
            alert("Room not found.");
            return;
        }
        const lookup = (await lookupRes.json());
        const room = await colyseus.joinById(lookup.roomId, { playerName });
        currentRoom = room;
        latestResult = null;
        meReady = false;
        bindRoom(room);
    }
    catch (error) {
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
document.getElementById("create").onclick = createRoom;
document.getElementById("join").onclick = joinRoom;
document.getElementById("ready").onclick = toggleReady;
document.getElementById("start").onclick = startGame;
document.getElementById("restart").onclick = restartRound;
setInterval(() => {
    const sentAt = Date.now();
    send("ping", { sentAt });
}, 1500);
window.addEventListener("keydown", (event) => handlePress(event.key));
window.addEventListener("keyup", (event) => handleRelease(event.key));
attachTouch();
updateUi();
void game;
