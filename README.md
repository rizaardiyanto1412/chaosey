# WASD-Style Web Co-op Game

Monorepo for a browser co-op game inspired by split-direction movement.

## Stack
- Client: Phaser + Vite + Colyseus client
- Server: Node.js + Express + Colyseus (authoritative simulation)
- Shared package: TypeScript socket contracts, types, and simulation helpers

## Workspace
- `apps/client`
- `apps/server`
- `packages/shared`

## Local Development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start both apps:
   ```bash
   npm run dev
   ```
3. Open client at `http://localhost:5173`.
4. Open map editor at `http://localhost:5173/editor.html`.

## Environment
Copy `.env.example` to `.env` for server env settings. Client server URL uses `VITE_SERVER_URL`.
Use `SNAPSHOT_RATE` to tune network update frequency (default `10`).

## Deployment
- Client: static hosting (Vercel / Cloudflare Pages).
- Server: WebSocket-capable runtime (Railway / Fly / Render).
- Set client `VITE_SERVER_URL` to deployed server URL.

## Assets
- Capybara sprite sheet: `apps/client/public/assets/sprites/capybara-4dir-sheet-v1.png`
- Tileset: `apps/client/public/assets/tilesets/grass-water-tileset-v1.png`

## Manual Multiplayer QA Matrix
- 2 players: join, ready, start, finish/fail
- 3 players: role assignment with one missing role
- 4 players: full role assignment
- Reconnect: drop one player and rejoin with same name within grace window
- Latency: verify RTT display and acceptable input feel
