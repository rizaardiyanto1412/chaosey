import Phaser from "phaser";
import { Client, type Room } from "colyseus.js";
import html2canvas from "html2canvas";
import { mapKeyToRole } from "./lib/input";
import type {
  GameState,
  JoinedRoomPayload,
  LevelData,
  LevelLoadedPayload,
  LobbyRoomSummary,
  PowerUpId,
  PlayerRole,
  RoomVisibility,
  RoundResult,
  StateSnapshotPayload
} from "@wasd/shared";
import { DEFAULT_LEVEL_ID } from "@wasd/shared";

const serverUrl = import.meta.env.VITE_SERVER_URL ?? "ws://localhost:3001";
const colyseus = new Client(serverUrl.replace(/^http/, "ws"));
const httpServerUrl = serverUrl.replace(/^ws/, "http");

const roomEl = document.getElementById("room") as HTMLDivElement;
const roleEl = document.getElementById("role") as HTMLDivElement;
const stateEl = document.getElementById("state") as HTMLDivElement;
const playersEl = document.getElementById("players") as HTMLDivElement;
const latencyEl = document.getElementById("latency") as HTMLDivElement;
const debugSoloEl = document.getElementById("debugSolo") as HTMLInputElement;
const debugInvincibleEl = document.getElementById("debugInvincible") as HTMLInputElement;
const debugSpawnNearGoalEl = document.getElementById("debugSpawnNearGoal") as HTMLInputElement;
const debugMoveSpeedEl = document.getElementById("debugMoveSpeed") as HTMLSelectElement;
const debugLevelIdEl = document.getElementById("debugLevelId") as HTMLSelectElement;
const playerNameEl = document.getElementById("playerName") as HTMLInputElement;
const privateRoomCodeEl = document.getElementById("privateRoomCode") as HTMLInputElement;
const menuScreenEl = document.getElementById("menuScreen") as HTMLElement;
const loadingScreenEl = document.getElementById("loadingScreen") as HTMLElement;
const hudEl = document.getElementById("hud") as HTMLElement;
const lobbyOverlayEl = document.getElementById("lobbyOverlay") as HTMLElement;
const lobbyOverlayTitleEl = document.getElementById("lobbyOverlayTitle") as HTMLHeadingElement;
const lobbyOverlayTextEl = document.getElementById("lobbyOverlayText") as HTMLParagraphElement;
const lobbyOverlayPlayersEl = document.getElementById("lobbyOverlayPlayers") as HTMLDivElement;
const lobbyOverlayRoomEl = document.getElementById("lobbyOverlayRoom") as HTMLDivElement;
const lobbyOverlayActionsEl = document.getElementById("lobbyOverlayActions") as HTMLDivElement;
const lobbyStartGameEl = document.getElementById("lobbyStartGame") as HTMLButtonElement;
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
const createRoomSetupEl = document.getElementById("createRoomSetup") as HTMLDivElement;
const confirmCreateRoomEl = document.getElementById("confirmCreateRoom") as HTMLButtonElement;
const visibilityPublicEl = document.getElementById("visibilityPublic") as HTMLButtonElement;
const visibilityPrivateEl = document.getElementById("visibilityPrivate") as HTMLButtonElement;
const quitGameEl = document.getElementById("quitGame") as HTMLButtonElement;
const roleRevealOverlayEl = document.getElementById("roleRevealOverlay") as HTMLElement;
const roleRevealKeysEl = document.getElementById("roleRevealKeys") as HTMLDivElement;
const roleRevealCaptionEl = document.getElementById("roleRevealCaption") as HTMLDivElement;
const levelTransitionOverlayEl = document.getElementById("levelTransitionOverlay") as HTMLElement;
const levelTransitionTitleEl = document.getElementById("levelTransitionTitle") as HTMLDivElement;
const levelTransitionSubtitleEl = document.getElementById("levelTransitionSubtitle") as HTMLDivElement;
const levelTransitionBodyEl = document.getElementById("levelTransitionBody") as HTMLDivElement;
const powerChoiceOverlayEl = document.getElementById("powerChoiceOverlay") as HTMLElement;
const powerChoiceCardsEl = document.getElementById("powerChoiceCards") as HTMLDivElement;
const activePowerUpEl = document.getElementById("activePowerUp") as HTMLDivElement;
const activatePowerUpEl = document.getElementById("activatePowerUp") as HTMLDivElement;
const timerEl = document.getElementById("timer") as HTMLDivElement;
const scoreEl = document.getElementById("scoreText") as HTMLSpanElement;
const rosterEl = document.getElementById("hudRoster") as HTMLDivElement;
const hudSoundToggleEl = document.getElementById("hudSoundToggle") as HTMLButtonElement;
const menuSoundToggleEl = document.getElementById("menuSoundToggle") as HTMLButtonElement;
const leaderboardModalEl = document.getElementById("leaderboardModal") as HTMLElement;
const leaderboardListEl = document.getElementById("leaderboardList") as HTMLDivElement;
const congratsOverlayEl = document.getElementById("congratsOverlay") as HTMLElement;
const congratsTeamEl = document.getElementById("congratsTeam") as HTMLSpanElement;
const congratsTimeEl = document.getElementById("congratsTime") as HTMLElement;
const congratsRankEl = document.getElementById("congratsRank") as HTMLElement;
const shareResultXEl = document.getElementById("shareResultX") as HTMLButtonElement;
const congratsCloseEl = document.getElementById("congratsClose") as HTMLButtonElement;

const touchButtons = document.querySelectorAll<HTMLButtonElement>("[data-role]");
const persistedRoomKey = "key-chaos.active-room";
const defaultMoveSpeed = 160;
const selectedLevelId = import.meta.env.VITE_LEVEL_ID ?? DEFAULT_LEVEL_ID;
const isDebugCreatePath = window.location.pathname === "/debugxthing";

let currentRoom: Room | null = null;
let latestState: GameState | null = null;
let currentLevel: LevelData | null = null;
let latestResult: RoundResult | null = null;
let myRoles: PlayerRole[] = [];
let myPlayerId = "";
let roomCode = "";
let latency = 0;
let lastPingSentAt = 0;
let lastPongAt = 0;
let currentVisibility: RoomVisibility = "public";
let currentDebugSolo = false;
let currentDebugInvincible = false;
let myRoomId = "";
let availableRooms: LobbyRoomSummary[] = [];
let previousPlayerCount = 0;

let targetTeamPosition = { x: 100, y: 100 };
const obstacleTargets = new Map<
  string,
  { x: number; y: number; width: number; height: number; kind: "hazard" | "tumbleweed" | "snowball" | "fireball" | "goal" }
>();

const referenceMapKey = (levelId: string) => `reference-map-${levelId}`;
const referenceTilesKey = (levelId: string) => `reference-tiles-${levelId}`;
const squirrelRightSheetKey = "squirrel-walk-right-12f";
const squirrelLeftSheetKey = "squirrel-walk-left-12f";
const squirrelUpSheetKey = "squirrel-walk-up-12f";
const squirrelDownSheetKey = "squirrel-walk-down-12f";
const explosionSheetKey = "explosion-spritesheet";
const explosionDieAnimKey = "explosion-die";
const acornSheetKey = "bouncing-acorn-spritesheet";
const blueSpiritEnemyKey = "blue-spirit-enemy";
const tumbleweedKey = "tumbleweed";
const snowballKey = "snowball";
const fireballKey = "fireball";
const coinLayerName = "coin";
const hazardMarkerLayerPattern = /^hazard_(left|right|up|down|circle)(?:_|$)/;
const tumbleweedMarkerLayerPattern = /^tumbleweed_(left|right|up|down|circle)(?:_|$)/;
const snowballMarkerLayerPattern = /^snowball_(left|right|up|down|circle)(?:_|$)/;
const fireballMarkerLayerPattern = /^fireball_(left|right|up|down|circle)(?:_|$)/;

const powerUpOptions: Array<{
  id: PowerUpId;
  eyebrow: string;
  title: string;
  description: string;
  stat: string;
}> = [
  {
    id: "speed_boost",
    eyebrow: "Rush",
    title: "Speed +25%",
    description: "Move faster through the opening stretch of the final level.",
    stat: "30 sec"
  },
  {
    id: "obstacle_slow",
    eyebrow: "Control",
    title: "Slow Obstacles",
    description: "All moving hazards run at half speed while your team finds the route.",
    stat: "30 sec"
  },
  {
    id: "shield",
    eyebrow: "Survive",
    title: "Two-Hit Shield",
    description: "Block the next two obstacle hits before the final push gets dangerous.",
    stat: "30 sec"
  }
];

let game: Phaser.Game | null = null;
let gameBootPromise: Promise<void> | null = null;
let gameBootResolve: (() => void) | null = null;
let hasEnteredGame = false;
let isTransitioningRoom = false;
let hostStartPending = false;
let previousRoomState: GameState["roomState"] | null = null;
let roleRevealTimeout: ReturnType<typeof setTimeout> | null = null;
let finalCompletionMs: number | null = null;
let latestCongratsResult: RoundResult | null = null;
let latestCongratsTeam = "";
let capturedCongratsImage: string | null = null;
let pendingDieAnimation:
  | {
      position: { x: number; y: number };
      keepPlayerHidden: boolean;
    }
  | null = null;
let audioContext: AudioContext | null = null;
let soundtrackAudio: HTMLAudioElement | null = null;
let lobbyAudio: HTMLAudioElement | null = null;
let currentSoundtrackLevel: string | null = null;
let soundtrackFadeInterval: ReturnType<typeof setInterval> | null = null;
let soundtrackPlaybackToken = 0;
const mutePrefKey = "key-chaos.muted";
let isMuted = (() => {
  try {
    return window.localStorage.getItem(mutePrefKey) === "1";
  } catch {
    return false;
  }
})();
const soundtrackBaseVolume = 0.4;
const lobbyBaseVolume = 0.3;

type WebKitAudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

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
  setVisibility(leaderboardModalEl, false);
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
  setVisibility(roleRevealOverlayEl, false);
  setVisibility(levelTransitionOverlayEl, false);
  setVisibility(powerChoiceOverlayEl, false);
  hideCongratsScreen();
  if (roleRevealTimeout) {
    clearTimeout(roleRevealTimeout);
    roleRevealTimeout = null;
  }
  previousRoomState = null;
  finalCompletionMs = null;
  pendingDieAnimation = null;
  menuStatusEl.textContent = status;
  void playLobbySound();
}

function showLoading(label: string) {
  closeAllModals();
  loadingLabelEl.textContent = label;
  setVisibility(loadingScreenEl, true);
  setVisibility(menuScreenEl, false);
  setVisibility(lobbyOverlayEl, false);
  hideCongratsScreen();
}

function showHud() {
  hasEnteredGame = true;
  setVisibility(menuScreenEl, false);
  setVisibility(loadingScreenEl, false);
  setVisibility(hudEl, true);
  setVisibility(powerChoiceOverlayEl, false);
  hideCongratsScreen();
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

function updateDebugSpeedControl() {
  const debugEnabled = debugSoloEl.checked;
  debugMoveSpeedEl.disabled = !debugEnabled;
  debugLevelIdEl.disabled = !debugEnabled;
  debugInvincibleEl.disabled = !debugEnabled;
  debugSpawnNearGoalEl.disabled = !debugEnabled;
  if (!debugSoloEl.checked) {
    debugMoveSpeedEl.value = String(defaultMoveSpeed);
    debugLevelIdEl.value = DEFAULT_LEVEL_ID;
    debugInvincibleEl.checked = false;
    debugSpawnNearGoalEl.checked = false;
  }
}

function selectedDebugMoveSpeed(): number | undefined {
  if (!debugSoloEl.checked) return undefined;
  const speed = Number(debugMoveSpeedEl.value);
  return Number.isFinite(speed) ? speed : defaultMoveSpeed;
}

function selectedDebugLevelId(): string | undefined {
  return debugSoloEl.checked ? debugLevelIdEl.value : undefined;
}

function selectedPlayerName(): string | undefined {
  const playerName = playerNameEl.value.trim();
  return playerName.length > 0 ? playerName : undefined;
}

function send(type: string, payload?: unknown) {
  if (!currentRoom) return;
  currentRoom.send(type, payload);
}

function resetConnectionStats() {
  latency = 0;
  lastPingSentAt = 0;
  lastPongAt = 0;
}

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  const AudioContextCtor = window.AudioContext ?? (window as WebKitAudioWindow).webkitAudioContext;
  if (!AudioContextCtor) return null;
  audioContext = new AudioContextCtor();
  return audioContext;
}

function unlockAudio() {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== "suspended") return;
  void ctx.resume();
}

function playBoomSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
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

function playNotificationSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume();
  }

  const startedAt = ctx.currentTime;
  const duration = 0.15;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, startedAt);
  gain.gain.linearRampToValueAtTime(1.0, startedAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + duration);
  gain.connect(ctx.destination);

  const oscillator = ctx.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, startedAt);
  oscillator.frequency.setValueAtTime(1100, startedAt + 0.05);
  oscillator.frequency.setValueAtTime(880, startedAt + 0.1);
  oscillator.connect(gain);
  oscillator.start(startedAt);
  oscillator.stop(startedAt + duration);
}

function playRoomCreatedSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume();
  }

  const startedAt = ctx.currentTime;
  const duration = 0.4;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, startedAt);
  gain.gain.linearRampToValueAtTime(1.0, startedAt + 0.03);
  gain.gain.setValueAtTime(1.0, startedAt + 0.2);
  gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + duration);
  gain.connect(ctx.destination);

  const oscillator = ctx.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(523.25, startedAt);
  oscillator.frequency.setValueAtTime(659.25, startedAt + 0.1);
  oscillator.frequency.setValueAtTime(783.99, startedAt + 0.2);
  oscillator.frequency.setValueAtTime(1046.5, startedAt + 0.3);
  oscillator.connect(gain);
  oscillator.start(startedAt);
  oscillator.stop(startedAt + duration);
}

function playCoinSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume();
  }

  const startedAt = ctx.currentTime;
  const duration = 0.25;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, startedAt);
  gain.gain.linearRampToValueAtTime(0.6, startedAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + duration);
  gain.connect(ctx.destination);

  const oscillator = ctx.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, startedAt);
  oscillator.frequency.setValueAtTime(1108.73, startedAt + 0.05);
  oscillator.frequency.setValueAtTime(1318.51, startedAt + 0.1);
  oscillator.frequency.setValueAtTime(1760, startedAt + 0.15);
  oscillator.connect(gain);
  oscillator.start(startedAt);
  oscillator.stop(startedAt + duration);
}

function getSoundtrackLevelNumber(levelId: string): number | null {
  const match = levelId.match(/\d+/);
  if (!match) return null;
  const levelNum = Number.parseInt(match[0], 10);
  return Number.isFinite(levelNum) ? levelNum : null;
}

function getSoundtrackForLevel(levelId: string): string | null {
  const levelNum = getSoundtrackLevelNumber(levelId);
  if (levelNum === null) return null;
  if (levelNum >= 1 && levelNum <= 3) return "/assets/sounds/1-3.mp3";
  if (levelNum >= 4 && levelNum <= 6) return "/assets/sounds/4-6.mp3";
  if (levelNum >= 7 && levelNum <= 9) return "/assets/sounds/7-9.mp3";
  if (levelNum === 10) return "/assets/sounds/10.mp3";
  return null;
}

function getSoundtrackGroup(levelId: string): string | null {
  const levelNum = getSoundtrackLevelNumber(levelId);
  if (levelNum === null) return null;
  if (levelNum >= 1 && levelNum <= 3) return "1-3";
  if (levelNum >= 4 && levelNum <= 6) return "4-6";
  if (levelNum >= 7 && levelNum <= 9) return "7-9";
  if (levelNum === 10) return "10";
  return null;
}

function clearSoundtrackFadeInterval() {
  if (!soundtrackFadeInterval) return;
  clearInterval(soundtrackFadeInterval);
  soundtrackFadeInterval = null;
}

async function playSoundtrack(levelId: string) {
  const soundtrackFile = getSoundtrackForLevel(levelId);
  const newGroup = getSoundtrackGroup(levelId);

  if (!soundtrackFile || !newGroup) {
    console.warn("[Soundtrack] No soundtrack for level", levelId);
    stopSoundtrack();
    return;
  }

  console.log("[Soundtrack] Playing", soundtrackFile, "for level", levelId, "group", newGroup);

  if (soundtrackAudio && currentSoundtrackLevel && getSoundtrackGroup(currentSoundtrackLevel) === newGroup) {
    console.log("[Soundtrack] Same group, skipping");
    return;
  }

  if (soundtrackAudio) {
    stopSoundtrack();
  }

  const audio = new Audio(soundtrackFile);
  const playbackToken = soundtrackPlaybackToken + 1;
  soundtrackPlaybackToken = playbackToken;
  soundtrackAudio = audio;
  currentSoundtrackLevel = levelId;
  audio.loop = true;
  audio.volume = 0;

  audio.addEventListener("canplaythrough", () => {
    console.log("[Soundtrack] Audio can play through");
  });

  audio.addEventListener("error", (e) => {
    console.error("[Soundtrack] Audio error:", e);
  });

  audio.addEventListener("loadeddata", () => {
    console.log("[Soundtrack] Audio loaded data, duration:", audio.duration);
  });

  try {
    await audio.play();
    if (soundtrackPlaybackToken !== playbackToken || soundtrackAudio !== audio) {
      audio.pause();
      return;
    }
    console.log("[Soundtrack] Play started successfully");
  } catch (err) {
    if (soundtrackAudio === audio) {
      soundtrackAudio = null;
      currentSoundtrackLevel = null;
    }
    console.error("[Soundtrack] Play error:", err);
    return;
  }

  clearSoundtrackFadeInterval();
  const fadeInDuration = 3000;
  const startTime = Date.now();
  const fadeInterval = setInterval(() => {
    if (soundtrackPlaybackToken !== playbackToken || soundtrackAudio !== audio) {
      clearInterval(fadeInterval);
      if (soundtrackFadeInterval === fadeInterval) {
        soundtrackFadeInterval = null;
      }
      return;
    }

    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / fadeInDuration, 1);
    audio.volume = isMuted ? 0 : progress * soundtrackBaseVolume;

    if (progress >= 1) {
      clearInterval(fadeInterval);
      if (soundtrackFadeInterval === fadeInterval) {
        soundtrackFadeInterval = null;
      }
    }
  }, 50);
  soundtrackFadeInterval = fadeInterval;
}

function stopSoundtrack() {
  soundtrackPlaybackToken += 1;
  clearSoundtrackFadeInterval();

  if (!soundtrackAudio) {
    currentSoundtrackLevel = null;
    return;
  }

  const audio = soundtrackAudio;
  soundtrackAudio = null;
  currentSoundtrackLevel = null;
  audio.pause();
}

async function playLobbySound() {
  if (lobbyAudio) {
    await stopLobbySound();
  }

  lobbyAudio = new Audio("/assets/sounds/lobby.mp3");
  lobbyAudio.loop = true;
  lobbyAudio.volume = 0;

  const attemptPlay = async () => {
    try {
      if (!lobbyAudio) return;
      await lobbyAudio.play();
      const fadeInDuration = 3000;
      const startTime = Date.now();
      const fadeInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / fadeInDuration, 1);
        if (lobbyAudio) {
          lobbyAudio.volume = isMuted ? 0 : progress * lobbyBaseVolume;
        }

        if (progress >= 1) {
          clearInterval(fadeInterval);
        }
      }, 50);
    } catch (err) {
      if ((err as Error).name === "NotAllowedError") {
        const handleInteraction = () => {
          document.removeEventListener("click", handleInteraction);
          document.removeEventListener("keydown", handleInteraction);
          document.removeEventListener("touchstart", handleInteraction);
          void attemptPlay();
        };
        document.addEventListener("click", handleInteraction, { once: true });
        document.addEventListener("keydown", handleInteraction, { once: true });
        document.addEventListener("touchstart", handleInteraction, { once: true });
      } else {
        console.error("[Lobby] Play error:", err);
      }
    }
  };

  void attemptPlay();
}

async function stopLobbySound() {
  if (!lobbyAudio) return;

  const startVolume = lobbyAudio.volume;
  const fadeOutDuration = 3000;
  const startTime = Date.now();

  const fadeInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / fadeOutDuration, 1);
    if (lobbyAudio) {
      lobbyAudio.volume = startVolume * (1 - progress);
    }

    if (progress >= 1) {
      clearInterval(fadeInterval);
      if (lobbyAudio) {
        lobbyAudio.pause();
        lobbyAudio = null;
      }
    }
  }, 50);
}

function handlePress(key: string) {
  unlockAudio();
  const role = mapKeyToRole(key);
  if (!role || !myRoles.includes(role)) return;
  send("input_press", { role });
}

function handleRelease(key: string) {
  const role = mapKeyToRole(key);
  if (!role || !myRoles.includes(role)) return;
  send("input_release", { role });
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centis = Math.floor((ms % 1000) / 10);
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const cc = String(centis).padStart(2, "0");
  return `${mm}:${ss}.${cc}`;
}

function levelNumberFromId(levelId: string): number | null {
  const match = levelId.match(/(\d+)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function updateTimerDisplay() {
  if (!timerEl) return;
  if (finalCompletionMs !== null) {
    timerEl.textContent = formatTime(finalCompletionMs);
    return;
  }
  if (!latestState || latestState.roomState === "lobby") {
    timerEl.textContent = "00:00.00";
    return;
  }

  const smoothElapsed = latestState.timerRunning
    ? latestState.timerElapsedMs + Math.max(0, Date.now() - latestState.serverTime)
    : latestState.timerElapsedMs;
  timerEl.textContent = formatTime(smoothElapsed);
}

function updateLevelTransitionOverlay() {
  if (!levelTransitionOverlayEl || !levelTransitionTitleEl || !levelTransitionSubtitleEl || !levelTransitionBodyEl) return;
  const transition = latestState?.levelTransition;
  const shouldShow = latestState?.roomState === "level_transition" && Boolean(transition);
  setVisibility(levelTransitionOverlayEl, shouldShow);
  if (!shouldShow || !transition) return;

  const levelNumber = levelNumberFromId(transition.toLevelId);
  const isFinalLevel = transition.isFinalLevel || levelNumber === 10;
  levelTransitionOverlayEl.classList.toggle("is-final", isFinalLevel);
  levelTransitionTitleEl.textContent = isFinalLevel ? "FINAL LEVEL" : `Level ${levelNumber ?? transition.toLevelId}`;
  levelTransitionSubtitleEl.textContent = isFinalLevel ? "This is the last one." : "Get ready";
  levelTransitionBodyEl.textContent = isFinalLevel
    ? "It will be brutal. Good luck."
    : "The path ahead shifts...";

  const remainingMs = Math.max(0, transition.endsAt - Date.now());
  levelTransitionOverlayEl.style.setProperty("--transition-progress", String(1 - remainingMs / Math.max(1, transition.endsAt - transition.startsAt)));
}

function renderPowerChoiceCards() {
  if (!powerChoiceCardsEl || powerChoiceCardsEl.childElementCount > 0) return;
  for (const option of powerUpOptions) {
    const button = document.createElement("button");
    button.className = "power-choice-card";
    button.type = "button";
    button.dataset.powerUpId = option.id;
    button.innerHTML = `
      <span class="power-choice-card-eyebrow">${escapeHtml(option.eyebrow)}</span>
      <strong>${escapeHtml(option.title)}</strong>
      <span>${escapeHtml(option.description)}</span>
      <em>${escapeHtml(option.stat)}</em>
    `;
    button.addEventListener("click", () => {
      for (const card of powerChoiceCardsEl.querySelectorAll<HTMLButtonElement>(".power-choice-card")) {
        card.disabled = true;
        card.classList.toggle("is-selected", card === button);
      }
      send("select_powerup", { powerUpId: option.id });
    });
    powerChoiceCardsEl.appendChild(button);
  }
}

function updatePowerChoiceOverlay() {
  if (!powerChoiceOverlayEl || !powerChoiceCardsEl) return;
  renderPowerChoiceCards();
  const shouldShow = latestState?.roomState === "power_choice";
  setVisibility(powerChoiceOverlayEl, shouldShow);
  if (!shouldShow) {
    for (const card of powerChoiceCardsEl.querySelectorAll<HTMLButtonElement>(".power-choice-card")) {
      card.disabled = false;
      card.classList.remove("is-selected");
    }
    return;
  }
  setVisibility(levelTransitionOverlayEl, false);
}

function updateActivePowerUpDisplay() {
  if (!activePowerUpEl) return;
  const powerUp = latestState?.activePowerUp;
  if (!powerUp || powerUp.endsAt <= Date.now()) {
    activePowerUpEl.hidden = true;
    activePowerUpEl.textContent = "";
    return;
  }

  const remainingSeconds = Math.ceil((powerUp.endsAt - Date.now()) / 1000);
  const shieldText =
    powerUp.id === "shield" && typeof powerUp.shieldHitsRemaining === "number"
      ? ` • ${powerUp.shieldHitsRemaining} hit${powerUp.shieldHitsRemaining === 1 ? "" : "s"}`
      : "";
  activePowerUpEl.hidden = false;
  activePowerUpEl.textContent = `${powerUp.label} ${remainingSeconds}s${shieldText}`;
}

function selectedPowerUpTitle(powerUpId: PowerUpId): string {
  return powerUpOptions.find((option) => option.id === powerUpId)?.title ?? "Power";
}

function updateActivatePowerUpButton() {
  if (!activatePowerUpEl) return;
  const selectedPowerUp = latestState?.selectedPowerUp;
  const holderId = latestState?.powerUpHolderId;
  const shouldShow = latestState?.roomState === "playing" && Boolean(selectedPowerUp) && !latestState?.activePowerUp;
  activatePowerUpEl.hidden = !shouldShow;
  if (!shouldShow || !selectedPowerUp) return;
  const holder = latestState?.players.find((player) => player.id === holderId);
  const holderName = holder?.id === myPlayerId ? "You" : holder?.name || "Next player";
  activatePowerUpEl.classList.toggle("is-mine", holderId === myPlayerId);
  activatePowerUpEl.textContent =
    holderId === myPlayerId
      ? `Press Space: ${selectedPowerUpTitle(selectedPowerUp)}`
      : `${holderName} has Space: ${selectedPowerUpTitle(selectedPowerUp)}`;
}

function resetLevelTransitionOverlayAnimation() {
  if (!levelTransitionOverlayEl) return;
  levelTransitionOverlayEl.style.animation = "none";
  void levelTransitionOverlayEl.offsetWidth;
  levelTransitionOverlayEl.style.animation = "";
}

function updateScoreDisplay() {
  if (!scoreEl) return;
  const collected = latestState?.score ?? 0;
  const total = latestState?.level.collectibles.length ?? 0;
  scoreEl.textContent = `${collected}/${total}`;
}

function connectedPlayers() {
  return latestState?.players.filter((player) => player.connected) ?? [];
}

function fallbackTeamName() {
  return roomCode ? `Team ${roomCode}` : "Team Chaosey";
}

function resultPlayerNames(result?: RoundResult | null) {
  const names = result?.playerNames?.map((name) => name.trim()).filter(Boolean);
  if (names && names.length > 0) return names;
  const connectedNames = connectedPlayers().map((player) => player.name.trim()).filter(Boolean);
  return connectedNames.length > 0 ? connectedNames : [fallbackTeamName()];
}

function resultTeamDisplay(result?: RoundResult | null) {
  const teamName = result?.teamName?.trim();
  if (teamName) return teamName;
  return resultPlayerNames(result).join(", ");
}

function shareUrlForResult(result: RoundResult, teamDisplay: string) {
  const timeText = formatTime(result.completionMs ?? 0);
  const rankText = result.leaderboardRank ? `#${result.leaderboardRank}` : "Unranked";
  const text = `${teamDisplay} completed Chaosey in ${timeText} with leaderboard rank ${rankText}. Can you beat us?`;
  const params = new URLSearchParams({ text });
  const origin = window.location.origin;
  if (!origin.includes("localhost") && !origin.includes("127.0.0.1")) {
    params.set("url", origin);
  }
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

function hideCongratsScreen() {
  setVisibility(congratsOverlayEl, false);
  latestCongratsResult = null;
  latestCongratsTeam = "";
  capturedCongratsImage = null;
}

function showCongratsScreen(result: RoundResult) {
  latestCongratsResult = result;
  latestCongratsTeam = resultTeamDisplay(result);
  capturedCongratsImage = null;
  congratsTeamEl.textContent = latestCongratsTeam;
  congratsTimeEl.textContent = formatTime(result.completionMs ?? 0);
  congratsRankEl.textContent = result.leaderboardRank ? `#${result.leaderboardRank}` : "Unranked";
  shareResultXEl.dataset.shareUrl = shareUrlForResult(result, latestCongratsTeam);
  setVisibility(roleRevealOverlayEl, false);
  if (roleRevealTimeout) {
    clearTimeout(roleRevealTimeout);
    roleRevealTimeout = null;
  }
  setVisibility(congratsOverlayEl, true);
  congratsOverlayEl.style.animation = "none";
  void congratsOverlayEl.offsetWidth;
  congratsOverlayEl.style.animation = "";

  setTimeout(() => {
    html2canvas(congratsOverlayEl, { backgroundColor: null, scale: 1 })
      .then((canvas) => {
        capturedCongratsImage = canvas.toDataURL("image/png");
      })
      .catch(() => {
        capturedCongratsImage = null;
      });
  }, 600);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

function renderRoster() {
  if (!rosterEl) return;
  const players = connectedPlayers();
  if (players.length === 0) {
    rosterEl.hidden = true;
    rosterEl.innerHTML = "";
    return;
  }
  rosterEl.hidden = false;
  const rows = players
    .map((player) => {
      const keys = (player.roles ?? [])
        .map((role) => `<span class="roster-key">${role}</span>`)
        .join("");
      const classes = [
        "roster-row",
        player.id === myPlayerId ? "is-me" : "",
        player.connected ? "" : "is-offline"
      ]
        .filter(Boolean)
        .join(" ");
      const name = (player.name ?? "Player").replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c)
      );
      return `<div class="${classes}"><div class="roster-keys">${keys || '<span class="roster-key">?</span>'}</div><div class="roster-name">${name}</div></div>`;
    })
    .join("");
  rosterEl.innerHTML = rows;
}

function applyMuteState() {
  if (soundtrackAudio) soundtrackAudio.volume = isMuted ? 0 : soundtrackBaseVolume;
  if (lobbyAudio) lobbyAudio.volume = isMuted ? 0 : lobbyBaseVolume;
  const label = isMuted ? "Unmute music" : "Mute music";
  for (const btn of [hudSoundToggleEl, menuSoundToggleEl]) {
    if (!btn) continue;
    btn.classList.toggle("is-muted", isMuted);
    btn.setAttribute("aria-pressed", isMuted ? "true" : "false");
    btn.setAttribute("aria-label", label);
    btn.title = label;
  }
}

function toggleMute() {
  isMuted = !isMuted;
  try {
    window.localStorage.setItem(mutePrefKey, isMuted ? "1" : "0");
  } catch {
    /* ignore */
  }
  applyMuteState();
}

class MainScene extends Phaser.Scene {
  private playerSprite?: Phaser.GameObjects.Sprite;
  private dieSprite?: Phaser.GameObjects.Sprite;
  private hazards: Record<string, Phaser.GameObjects.Sprite> = {};
  private tumbleweeds: Record<string, Phaser.GameObjects.Sprite> = {};
  private snowballs: Record<string, Phaser.GameObjects.Sprite> = {};
  private fireballs: Record<string, Phaser.GameObjects.Sprite> = {};
  private acorns = new Map<string, Phaser.GameObjects.Sprite>();
  private collectedAcornIds = new Set<string>();
  private goal?: Phaser.GameObjects.Rectangle;
  private statusText?: Phaser.GameObjects.Text;
  private renderedLevelId = selectedLevelId;
  private mapWidth = 1200;
  private mapHeight = 800;
  private lastFacing: "down" | "left" | "right" | "up" = "down";
  private keepPlayerHiddenAfterDie = false;

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

  private tileCentersForLayer(tilemap: Phaser.Tilemaps.Tilemap, layerName: string): Array<{ x: number; y: number }> {
    const tileLayerData = tilemap.getLayer(layerName);
    const data = tileLayerData?.data ?? tileLayerData?.tilemapLayer?.layer.data;
    if (!data) return [];

    const centers: Array<{ x: number; y: number }> = [];
    for (let row = 0; row < data.length; row += 1) {
      for (let col = 0; col < data[row].length; col += 1) {
        const tile = data[row][col];
        if (!tile || tile.index < 0) continue;
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
    this.load.image(snowballKey, "/assets/enemies/snowball-hd-transparent.png");
    this.load.image(fireballKey, "/assets/enemies/fireball-hd-transparent.png");
  }

  create() {
    const tilemap = this.make.tilemap({ key: referenceMapKey(this.renderedLevelId) });
    let initialSpawn = { x: 100, y: 100 };
    if (tilemap) {
      const tileset = tilemap.addTilesetImage("spritefusion", referenceTilesKey(this.renderedLevelId));
      if (tileset) {
        let depth = 0;
        for (const layer of tilemap.layers) {
          if (layer.name === coinLayerName || hazardMarkerLayerPattern.test(layer.name.toLowerCase()) || tumbleweedMarkerLayerPattern.test(layer.name.toLowerCase()) || snowballMarkerLayerPattern.test(layer.name.toLowerCase()) || fireballMarkerLayerPattern.test(layer.name.toLowerCase())) {
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
    this.playerSprite.setVisible(true);
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

    this.input.keyboard?.on("keydown", (event: KeyboardEvent) => {
      if (event.repeat) return;
      handlePress(event.key);
    });
    this.input.keyboard?.on("keyup", (event: KeyboardEvent) => handleRelease(event.key));

    void playSoundtrack(this.renderedLevelId);

    signalGameBooted();
  }

  private playDieAnimation(position: { x: number; y: number }, keepPlayerHidden: boolean) {
    if (!this.dieSprite || !this.playerSprite) return;
    this.keepPlayerHiddenAfterDie = keepPlayerHidden;
    this.dieSprite.setPosition(position.x, position.y);
    this.dieSprite.setVisible(true);
    this.dieSprite.anims.play(explosionDieAnimKey, true);
    this.playerSprite.setVisible(false);
    this.cameras.main.shake(220, 0.012);
    this.cameras.main.flash(90, 255, 244, 214);
    playBoomSound();
  }

  isRenderingLevel(levelId: string) {
    return this.renderedLevelId === levelId;
  }

  update(_time: number, delta: number) {
    if (!latestState || !this.playerSprite) return;

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
      let facing: "down" | "left" | "right" | "up";
      if (Math.abs(dx) > Math.abs(dy)) {
        facing = dx > 0 ? "right" : "left";
      } else {
        facing = dy > 0 ? "down" : "up";
      }
      const animKey = `squirrel-walk-${facing}`;
      const current = this.playerSprite.anims.currentAnim;
      if (!this.playerSprite.anims.isPlaying || !current || current.key !== animKey) {
        this.playerSprite.anims.play(animKey, true);
      }
      this.lastFacing = facing;
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
          ? `Round won! Time: ${formatTime(latestResult.completionMs ?? 0)}. Host can restart.`
          : `Round failed: ${latestResult.failReason}`
        : latestState.roomState === "countdown"
          ? `Countdown: ${(latestState.countdownRemainingMs / 1000).toFixed(1)}s`
          : `Room ${latestState.roomCode} • ${latestState.roomState}`
    );

    updateTimerDisplay();
    this.syncCollectedAcorns();

    for (const id of Object.keys(this.hazards)) {
      if (obstacleTargets.has(id)) continue;
      this.hazards[id].destroy();
      delete this.hazards[id];
    }
    for (const id of Object.keys(this.tumbleweeds)) {
      if (obstacleTargets.has(id)) continue;
      this.tumbleweeds[id].destroy();
      delete this.tumbleweeds[id];
    }
    for (const id of Object.keys(this.snowballs)) {
      if (obstacleTargets.has(id)) continue;
      this.snowballs[id].destroy();
      delete this.snowballs[id];
    }
    for (const id of Object.keys(this.fireballs)) {
      if (obstacleTargets.has(id)) continue;
      this.fireballs[id].destroy();
      delete this.fireballs[id];
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
        this.goal.setPosition(
          Phaser.Math.Linear(this.goal.x, obstacle.x, smoothFactor),
          Phaser.Math.Linear(this.goal.y, obstacle.y, smoothFactor)
        );
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
        this.hazards[id].setPosition(
          Phaser.Math.Linear(this.hazards[id].x, obstacle.x, smoothFactor),
          Phaser.Math.Linear(this.hazards[id].y, obstacle.y, smoothFactor)
        );
        this.hazards[id].setAlpha(0.92 + Math.sin(_time * 0.008 + id.length) * 0.08);
      } else if (obstacle.kind === "tumbleweed") {
        if (!this.tumbleweeds[id]) {
          this.tumbleweeds[id] = this.add.sprite(obstacle.x, obstacle.y, tumbleweedKey);
          this.tumbleweeds[id].setDepth(175);
          this.tumbleweeds[id].setOrigin(0.5);
        }
        const visualSize = Math.max(obstacle.width, obstacle.height) * 1.25;
        this.tumbleweeds[id].setDisplaySize(visualSize, visualSize);
        this.tumbleweeds[id].setPosition(
          Phaser.Math.Linear(this.tumbleweeds[id].x, obstacle.x, smoothFactor),
          Phaser.Math.Linear(this.tumbleweeds[id].y, obstacle.y, smoothFactor)
        );
        this.tumbleweeds[id].setAlpha(0.92 + Math.sin(_time * 0.008 + id.length) * 0.08);
      } else if (obstacle.kind === "snowball") {
        if (!this.snowballs[id]) {
          this.snowballs[id] = this.add.sprite(obstacle.x, obstacle.y, snowballKey);
          this.snowballs[id].setDepth(175);
          this.snowballs[id].setOrigin(0.5);
        }
        const visualSize = Math.max(obstacle.width, obstacle.height) * 1.25;
        this.snowballs[id].setDisplaySize(visualSize, visualSize);
        this.snowballs[id].setPosition(
          Phaser.Math.Linear(this.snowballs[id].x, obstacle.x, smoothFactor),
          Phaser.Math.Linear(this.snowballs[id].y, obstacle.y, smoothFactor)
        );
        this.snowballs[id].setAlpha(0.92 + Math.sin(_time * 0.008 + id.length) * 0.08);
      } else if (obstacle.kind === "fireball") {
        if (!this.fireballs[id]) {
          this.fireballs[id] = this.add.sprite(obstacle.x, obstacle.y, fireballKey);
          this.fireballs[id].setDepth(175);
          this.fireballs[id].setOrigin(0.5);
        }
        const visualSize = Math.max(obstacle.width, obstacle.height) * 1.25;
        this.fireballs[id].setDisplaySize(visualSize, visualSize);
        this.fireballs[id].setPosition(
          Phaser.Math.Linear(this.fireballs[id].x, obstacle.x, smoothFactor),
          Phaser.Math.Linear(this.fireballs[id].y, obstacle.y, smoothFactor)
        );
        this.fireballs[id].setAlpha(0.92 + Math.sin(_time * 0.008 + id.length) * 0.08);
      }
    }
  }

  private syncCollectedAcorns() {
    const collectedIds = new Set(latestState?.collectedCollectibleIds ?? []);
    for (const id of collectedIds) {
      const acorn = this.acorns.get(id);
      if (!acorn || this.collectedAcornIds.has(id)) continue;
      this.collectedAcornIds.add(id);
      playCoinSound();
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
      if (collectedIds.has(id)) continue;
      acorn.setVisible(true);
      acorn.setAlpha(1);
      acorn.setDisplaySize(56, 72);
      this.collectedAcornIds.delete(id);
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
  const hasRoom = Boolean(roomCode);
  setVisibility(createRoomResultEl, hasRoom);
  setVisibility(createRoomSetupEl, !hasRoom);
  createdRoomCodeEl.textContent = roomCode || "----";
  createdRoomMetaEl.textContent = `Visibility: ${currentVisibility === "public" ? "Public" : "Private"}`;
  const playerCount = latestState ? connectedPlayers().length : currentRoom ? 1 : 0;
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
  const playerCount = connectedPlayers().length;
  const canStart = currentDebugSolo ? playerCount >= 1 : playerCount >= 2;
  confirmCreateRoomEl.title = roomCode ? (canStart ? "Start the run" : "Need at least 2 players to start.") : "Create room";
}

function showRoleReveal(roles: PlayerRole[]) {
  if (!roleRevealOverlayEl || !roleRevealKeysEl) return;

  roleRevealKeysEl.innerHTML = "";
  if (roles.length === 0) {
    const badge = document.createElement("div");
    badge.className = "role-reveal-key";
    badge.textContent = "?";
    roleRevealKeysEl.appendChild(badge);
    roleRevealCaptionEl.textContent = "No key assigned yet. Hang tight!";
  } else {
    for (const role of roles) {
      const badge = document.createElement("div");
      badge.className = "role-reveal-key";
      badge.textContent = role;
      roleRevealKeysEl.appendChild(badge);
    }
    roleRevealCaptionEl.textContent =
      roles.length > 1
        ? "You control these keys. Press one to steer the squirrel."
        : "Press this key to steer the squirrel.";
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
  }, 2600);
}

function showWinReveal(result: RoundResult) {
  if (!roleRevealOverlayEl || !roleRevealKeysEl) return;
  hideCongratsScreen();

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

function maybeTriggerRoleReveal(nextRoomState: GameState["roomState"]) {
  if (previousRoomState === "lobby" && nextRoomState === "playing") {
    hideCongratsScreen();
    showRoleReveal(myRoles);
    finalCompletionMs = null;
  }
  if (previousRoomState !== "level_transition" && nextRoomState === "level_transition") {
    resetLevelTransitionOverlayAnimation();
  }
  previousRoomState = nextRoomState;
}

function updateLobbyOverlay() {
  if (!latestState || !myPlayerId) {
    setVisibility(lobbyOverlayEl, false);
    return;
  }

  const isHost = latestState.hostId === myPlayerId;
  const shouldShow = latestState.roomState === "lobby";
  setVisibility(lobbyOverlayEl, shouldShow);
  if (!shouldShow) return;

  const playerCount = connectedPlayers().length;
  const canStart = currentDebugSolo ? playerCount >= 1 : playerCount >= 2;
  const neededPlayers = currentDebugSolo ? 1 : 2;
  lobbyOverlayTitleEl.textContent = isHost ? "Waiting For Players" : "Waiting For Host";
  lobbyOverlayTextEl.textContent = isHost
    ? playerCount > 1
      ? "Everyone is in position. Start the run whenever you are ready."
      : "Room created. Share the room code and wait for at least one more player."
    : playerCount > 1
      ? "Everyone is in position. The host can start the run whenever they are ready."
      : "You joined successfully. Waiting for the host and more players before the run begins.";
  lobbyOverlayPlayersEl.innerHTML = `
    <span class="lobby-badge-label">Players</span>
    <strong class="lobby-badge-value">${playerCount}/4</strong>
    <span class="lobby-badge-note">${canStart ? "Ready to start" : `Need ${neededPlayers} to start`}</span>
  `;
  lobbyOverlayRoomEl.innerHTML = `
    <span class="lobby-badge-label">Room Code</span>
    <strong class="lobby-badge-value">${latestState.roomCode}</strong>
    <span class="lobby-badge-note">Share this code</span>
  `;
  console.log("[Lobby] isHost:", isHost, "myPlayerId:", myPlayerId, "hostId:", latestState.hostId);
  setVisibility(lobbyOverlayActionsEl, isHost);
  if (isHost) {
    lobbyStartGameEl.disabled = !canStart;
    lobbyStartGameEl.style.opacity = canStart ? "1" : "0.55";
    lobbyStartGameEl.title = canStart ? "Start the run" : "Need at least 2 players to start.";
  } else {
    lobbyStartGameEl.disabled = true;
    lobbyStartGameEl.style.opacity = "0.55";
    lobbyStartGameEl.title = "Only the host can start the run.";
  }
  lobbyOverlayFootnoteEl.textContent = isHost
    ? canStart
      ? "Press start when everyone is ready."
      : "You need at least one more player before the game can start."
    : playerCount > 1
      ? "You do not need to do anything here. The game will begin for you as soon as the host presses start."
      : "The host needs at least one more player before the game can start.";
}

function syncLobbyControls() {
  if (!latestState || !roomCode) return;
  const isHost = latestState.hostId === myPlayerId;
  const shouldOpenHostRoomPanel = isHost && latestState.roomState === "lobby" && !hostStartPending;
  if (isDebugCreatePath && shouldOpenHostRoomPanel && createRoomModalEl.hidden) {
    openModal(createRoomModalEl);
  }
}

function updateUi() {
  roleEl.textContent = `Role: ${myRoles.length ? myRoles.join(" + ") : "-"}`;
  roomEl.textContent = `Room: ${roomCode || "-"}`;
  stateEl.textContent = `State: ${latestState?.roomState ?? "-"}`;
  updateConnectionIndicator();

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
  updateLevelTransitionOverlay();
  updatePowerChoiceOverlay();
  updateActivePowerUpDisplay();
  updateActivatePowerUpButton();
  updateScoreDisplay();
  renderRoster();
}

function updateConnectionIndicator() {
  let status = "checking";
  let label = "RTT: checking";

  if (!currentRoom) {
    status = "lost";
    label = "RTT: offline";
  } else if (lastPongAt > 0) {
    const pongAge = Date.now() - lastPongAt;
    if (pongAge > 5000) {
      status = "lost";
      label = "RTT: lost";
    } else if (latency < 120) {
      status = "good";
      label = `RTT: ${Math.round(latency)} ms`;
    } else if (latency < 250) {
      status = "fair";
      label = `RTT: ${Math.round(latency)} ms`;
    } else {
      status = "slow";
      label = `RTT: ${Math.round(latency)} ms`;
    }
  }

  latencyEl.textContent = label;
  latencyEl.className = `connection-indicator is-${status}`;
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

type LeaderboardEntryClient = {
  rank?: number;
  completionMs: number;
  playerCount: number;
  playerNames?: string[];
  teamName?: string;
  at: string;
  roomCode: string;
};

async function fetchLeaderboard() {
  if (!leaderboardListEl) return;
  leaderboardListEl.innerHTML = '<div class="leaderboard-empty">Loading...</div>';
  try {
    const response = await fetch(`${httpServerUrl}/leaderboard`);
    if (!response.ok) {
      throw new Error("Unable to load leaderboard.");
    }
    const payload = (await response.json()) as { entries: LeaderboardEntryClient[] };
    renderLeaderboard(payload.entries);
  } catch {
    leaderboardListEl.innerHTML = '<div class="leaderboard-empty">Unable to load leaderboard.</div>';
  }
}

function renderLeaderboard(entries: LeaderboardEntryClient[]) {
  if (!leaderboardListEl) return;
  if (entries.length === 0) {
    leaderboardListEl.innerHTML = '<div class="leaderboard-empty">No records yet. Be the first to win!</div>';
    return;
  }
  leaderboardListEl.innerHTML = entries
    .map((entry, index) => {
      const rank = entry.rank ?? index + 1;
      const rankClass = rank === 1 ? "top-1" : rank === 2 ? "top-2" : rank === 3 ? "top-3" : "";
      const timeStr = formatTime(entry.completionMs);
      const dateStr = new Date(entry.at).toLocaleDateString();
      const members = entry.teamName?.trim() || entry.playerNames?.filter(Boolean).join(", ") || "Unknown team";
      return `
        <div class="leaderboard-entry">
          <div class="leaderboard-rank ${rankClass}">${rank}</div>
          <div class="leaderboard-info">
            <div class="leaderboard-time">${timeStr}</div>
            <div class="leaderboard-meta">${dateStr} • Room ${escapeHtml(entry.roomCode)} • ${escapeHtml(members)}</div>
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
    const role = button.dataset.role as PlayerRole;
    button.addEventListener("contextmenu", (event) => event.preventDefault());
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      unlockAudio();
      if (!myRoles.includes(role)) return;
      handlePress(role);
    });
    button.addEventListener("pointerup", (event) => {
      event.preventDefault();
      if (button.hasPointerCapture(event.pointerId)) {
        button.releasePointerCapture(event.pointerId);
      }
      if (!myRoles.includes(role)) return;
      handleRelease(role);
    });
    button.addEventListener("pointercancel", (event) => {
      if (button.hasPointerCapture(event.pointerId)) {
        button.releasePointerCapture(event.pointerId);
      }
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

  room.onMessage("level_loaded", ({ level }: LevelLoadedPayload) => {
    currentLevel = level;
    if (latestState) {
      latestState.level = level;
    }
  });

  room.onMessage("state_snapshot", (snapshot: StateSnapshotPayload) => {
    if (!currentLevel || currentLevel.id !== snapshot.levelId) {
      // Snapshot arrived before its matching level_loaded; ignore until in sync.
      return;
    }
    // Apply moving-obstacle position updates onto the cached level.
    if (snapshot.obstaclePositions.length > 0) {
      const byId = new Map(snapshot.obstaclePositions.map((u) => [u.id, u] as const));
      for (const obstacle of currentLevel.obstacles) {
        const update = byId.get(obstacle.id);
        if (update) {
          obstacle.position = { x: update.x, y: update.y };
        }
      }
    }

    const state: GameState = {
      roomCode: snapshot.roomCode,
      hostId: snapshot.hostId,
      roomState: snapshot.roomState,
      tick: snapshot.tick,
      level: currentLevel,
      players: snapshot.players,
      teamPosition: snapshot.teamPosition,
      score: snapshot.score,
      collectedCollectibleIds: snapshot.collectedCollectibleIds,
      countdownRemainingMs: snapshot.countdownRemainingMs,
      timerElapsedMs: snapshot.timerElapsedMs,
      timerRunning: snapshot.timerRunning,
      levelTransition: snapshot.levelTransition,
      selectedPowerUp: snapshot.selectedPowerUp,
      powerUpHolderId: snapshot.powerUpHolderId,
      activePowerUp: snapshot.activePowerUp,
      serverTime: snapshot.serverTime
    };

    const previousState = latestState;
    latestState = state;
    if (state.roomState === "lobby") {
      finalCompletionMs = null;
      hideCongratsScreen();
    }
    const mainScene = game?.scene.getScene("main") as MainScene | undefined;
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
      const previousDistanceFromSpawn = Math.hypot(
        previousState.teamPosition.x - previousState.level.spawn.x,
        previousState.teamPosition.y - previousState.level.spawn.y
      );
      if (distanceFromSpawn <= state.level.playerRadius && previousDistanceFromSpawn > state.level.playerRadius * 2) {
        pendingDieAnimation = {
          position: { ...previousState.teamPosition },
          keepPlayerHidden: false
        };
        // Hazard respawns happen during the "playing" state, so clear any previous round result UI.
        latestResult = null;
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
    const currentPlayerCount = state.players.length;
    const isHost = state.hostId === myPlayerId;
    if (state.roomState === "lobby" && isHost && currentPlayerCount > previousPlayerCount && previousPlayerCount > 0) {
      playNotificationSound();
    }
    previousPlayerCount = currentPlayerCount;
    writePersistedRoom();
    updateUi();
  });

  room.onMessage("round_result", (result: RoundResult) => {
    latestResult = result;
    if (result.outcome === "fail" && result.failReason === "trap_hit" && latestState) {
      pendingDieAnimation = {
        position: { ...latestState.teamPosition },
        keepPlayerHidden: true
      };
    }
    if (result.outcome === "win" && result.completionMs !== undefined) {
      finalCompletionMs = result.completionMs;
      const currentLevelNum = latestState ? levelNumberFromId(latestState.level.id) : null;
      if (currentLevelNum === 10) {
        showCongratsScreen(result);
      } else {
        showWinReveal(result);
      }
      if (latestState) {
        if (currentLevelNum === 3 || currentLevelNum === 6 || currentLevelNum === 9 || currentLevelNum === 10) {
          void stopSoundtrack();
        }
      }
    }
    updateUi();
  });

  room.onMessage("error_event", ({ message }: { message: string }) => {
    showMenu(message);
    alert(message);
  });

  room.onMessage("pong", ({ sentAt }: { sentAt: number }) => {
    latency = Date.now() - sentAt;
    lastPongAt = Date.now();
    updateUi();
  });

  room.onLeave(() => {
    currentRoom = null;
    latestState = null;
    currentLevel = null;
    latestResult = null;
    currentDebugInvincible = false;
    myRoles = [];
    myPlayerId = "";
    roomCode = "";
    myRoomId = "";
    resetConnectionStats();
    hostStartPending = false;
    obstacleTargets.clear();
    pendingDieAnimation = null;
    hideCongratsScreen();
    clearPersistedRoom();
    void stopSoundtrack();
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
  currentLevel = null;
  latestResult = null;
  currentDebugInvincible = false;
  myRoles = [];
  myPlayerId = "";
  roomCode = "";
  myRoomId = "";
  obstacleTargets.clear();
  pendingDieAnimation = null;
  hideCongratsScreen();
  void stopSoundtrack();
  updateUi();
  showMenu();
  isTransitioningRoom = false;
}

async function enterRoom(options: { visibility?: RoomVisibility; roomId?: string; roomCode?: string; reconnectPlayerId?: string }) {
  try {
    isTransitioningRoom = true;
    showLoading(options.roomId || options.roomCode ? "Joining room..." : "Creating your room...");
    await leaveCurrentRoom();
    await stopLobbySound();
    const reconnectPlayerId = options.reconnectPlayerId;
    latestResult = null;
    latestState = null;
    currentLevel = null;
    myRoles = [];
    myPlayerId = "";
    roomCode = "";
    resetConnectionStats();
    const playerName = selectedPlayerName();
    currentDebugSolo = isDebugCreatePath && Boolean(debugSoloEl.checked) && !options.roomId && !options.roomCode;
    currentDebugInvincible =
      isDebugCreatePath &&
      Boolean(debugSoloEl.checked) &&
      Boolean(debugInvincibleEl.checked) &&
      !options.roomId &&
      !options.roomCode;

    if (options.roomId) {
      currentRoom = await colyseus.joinById(options.roomId, { reconnectPlayerId, playerName });
      currentVisibility = "public";
      myRoomId = options.roomId;
    } else if (options.roomCode) {
      const lookupRes = await fetch(`${httpServerUrl}/rooms/${encodeURIComponent(options.roomCode)}`);
      if (!lookupRes.ok) {
        throw new Error(lookupRes.status === 409 ? "Game already started." : "Room not found.");
      }
      const lookup = (await lookupRes.json()) as { roomId: string };
      currentRoom = await colyseus.joinById(lookup.roomId, { reconnectPlayerId, playerName });
      currentVisibility = "private";
      myRoomId = lookup.roomId;
    } else {
      currentVisibility = options.visibility ?? "public";
      currentRoom = await colyseus.create("wasd_room", {
        debugSolo: currentDebugSolo,
        debugMoveSpeed: isDebugCreatePath ? selectedDebugMoveSpeed() : undefined,
        debugLevelId: isDebugCreatePath ? selectedDebugLevelId() : undefined,
        debugInvincible: currentDebugInvincible,
        debugSpawnNearGoal: isDebugCreatePath && Boolean(debugSoloEl.checked) && Boolean(debugSpawnNearGoalEl.checked),
        playerName,
        visibility: currentVisibility
      });
      myRoomId = currentRoom.roomId;
      playRoomCreatedSound();
    }

    bindRoom(currentRoom);
    showLoading("Loading the forest map...");
    await ensureGameStarted();
    resizeGame();
    showHud();
    updateUi();

    if (isDebugCreatePath && !options.roomId && !options.roomCode) {
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
  if (!isDebugCreatePath) {
    void enterRoom({ visibility: "public" });
    return;
  }
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
  hideCongratsScreen();
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
document.getElementById("howToPlay")?.addEventListener("click", () => openModal(howToModalEl));
document.getElementById("closeHowTo")?.addEventListener("click", closeAllModals);
document.getElementById("leaderboard")?.addEventListener("click", openLeaderboardModal);
document.getElementById("closeLeaderboard")?.addEventListener("click", closeAllModals);
(document.getElementById("closeCreateRoom") as HTMLButtonElement).onclick = () => void quitToMenu();
(document.getElementById("closeJoinRoom") as HTMLButtonElement).onclick = closeAllModals;
(document.getElementById("confirmCreateRoom") as HTMLButtonElement).onclick = () => void createRoomFromModal();
(document.getElementById("refreshRooms") as HTMLButtonElement).onclick = () => void fetchRoomList();
(document.getElementById("joinByCode") as HTMLButtonElement).onclick = () => void joinPrivateRoomFromModal();
lobbyStartGameEl.onclick = startGame;
quitGameEl.onclick = () => void quitToMenu();
congratsCloseEl.onclick = () => void quitToMenu();
shareResultXEl.onclick = () => {
  const result = latestCongratsResult;
  const teamDisplay = latestCongratsTeam || (result ? resultTeamDisplay(result) : "");

  if (!capturedCongratsImage || !result) {
    const shareUrl = result
      ? shareUrlForResult(result, teamDisplay)
      : shareResultXEl.dataset.shareUrl;
    if (!shareUrl) return;
    const opened = window.open(shareUrl, "_blank", "noopener,noreferrer");
    if (!opened) window.location.href = shareUrl;
    return;
  }

  const originalText = shareResultXEl.textContent;
  shareResultXEl.textContent = "Uploading...";
  shareResultXEl.disabled = true;

  fetch(`${httpServerUrl}/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: capturedCongratsImage,
      teamName: teamDisplay,
      completionMs: result.completionMs ?? 0,
      leaderboardRank: result.leaderboardRank ?? null
    })
  })
    .then((res) => {
      if (!res.ok) throw new Error("Upload failed");
      return res.json() as Promise<{ id: string; url: string }>;
    })
    .then(({ url }) => {
      const sharePageUrl = `${httpServerUrl}${url}`;
      const timeText = formatTime(result.completionMs ?? 0);
      const rankText = result.leaderboardRank ? `#${result.leaderboardRank}` : "Unranked";
      const text = `${teamDisplay} completed Chaosey in ${timeText} with leaderboard rank ${rankText}. Can you beat us?`;
      const params = new URLSearchParams({ text, url: sharePageUrl });
      const tweetUrl = `https://twitter.com/intent/tweet?${params.toString()}`;
      const opened = window.open(tweetUrl, "_blank", "noopener,noreferrer");
      if (!opened) window.location.href = tweetUrl;
    })
    .catch(() => {
      const shareUrl = shareUrlForResult(result, teamDisplay);
      const opened = window.open(shareUrl, "_blank", "noopener,noreferrer");
      if (!opened) window.location.href = shareUrl;
    })
    .finally(() => {
      shareResultXEl.textContent = originalText;
      shareResultXEl.disabled = false;
    });
};

visibilityPublicEl.onclick = () => setSelectedVisibility("public");
visibilityPrivateEl.onclick = () => setSelectedVisibility("private");
debugSoloEl.onchange = updateDebugSpeedControl;

setInterval(() => {
  const sentAt = Date.now();
  if (!currentRoom) {
    updateConnectionIndicator();
    return;
  }
  lastPingSentAt = sentAt;
  send("ping", { sentAt });
  updateConnectionIndicator();
  updateActivePowerUpDisplay();
  updateActivatePowerUpButton();
}, 1500);

window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  if (event.key === "Escape" && (!howToModalEl.hidden || !createRoomModalEl.hidden || !joinRoomModalEl.hidden)) {
    closeAllModals();
    return;
  }
  if (event.key === "Escape" && currentRoom) {
    void quitToMenu();
    return;
  }
  if (event.code === "Space" && latestState?.roomState === "playing" && latestState.selectedPowerUp && latestState.powerUpHolderId === myPlayerId) {
    event.preventDefault();
    send("activate_powerup");
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

hudSoundToggleEl?.addEventListener("click", () => {
  unlockAudio();
  toggleMute();
});
menuSoundToggleEl?.addEventListener("click", () => {
  unlockAudio();
  toggleMute();
});
applyMuteState();

void resumePersistedRoom();
