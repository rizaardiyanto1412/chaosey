# PLAN — WASD-Style Web Co-op Game

## Product Goal
Create a browser-based co-op chaos game where each player controls one movement key (W/A/S/D), requiring teamwork to complete trap-based levels.

## Chosen Scope
- MVP target: core co-op loop only (2–4 players)
- Stack: Phaser (client), Node.js + Colyseus (server), shared TS package
- Planning mode: phase-based roadmap

## Roadmap

### Phase 1 — Foundation
- [x] Initialize monorepo: `apps/client`, `apps/server`, `packages/shared`
- [x] Configure TypeScript, lint, test, build scripts
- [x] Add `.env.example` and runtime config strategy
- [x] Add CI pipeline for install/typecheck/build/test

### Phase 2 — Multiplayer Core
- [x] Implement room create/join with room code
- [x] Implement role assignment (`W|A|S|D`)
- [x] Implement ready/start flow
- [x] Define and enforce shared socket payload types

### Phase 3 — Authoritative Simulation
- [x] Build fixed-tick server loop (20 Hz)
- [x] Merge player inputs into team movement
- [x] Implement collision and trap resolution server-side
- [x] Broadcast state snapshots to all clients

### Phase 4 — Playable MVP Level
- [x] Create one complete obstacle/trap level
- [x] Implement win and fail conditions
- [x] Implement restart loop after round end
- [x] Add reconnect grace timeout behavior

### Phase 5 — UX and Stability
- [x] Add lobby/game HUD (role, status, ping)
- [x] Add keyboard + touch input fallback
- [x] Add SFX and end-of-round overlays
- [x] Add anti-inactivity handling and host restart controls

### Phase 6 — QA and Launch
- [x] Unit tests for movement/collision core logic
- [x] Contract tests for socket events/payloads
- [ ] Manual multiplayer matrix (2/3/4 players, lag, reconnect)
- [ ] Deploy client + server and verify production room flow

## Acceptance Criteria (MVP)
- [x] 2–4 players can join via room code
- [x] Each player gets exactly one movement role
- [x] Team can complete or fail level with synchronized result
- [x] Reconnect and restart flows work without desync
- [ ] Build/test/deploy pipeline passes
