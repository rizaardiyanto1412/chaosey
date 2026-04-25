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
- Tileset (recommended): `apps/client/public/assets/tilesets/grass-water-tileset-v2.png`
- Legacy tileset: `apps/client/public/assets/tilesets/grass-water-tileset-v1.png`

## SpriteFusion Map Export
SpriteFusion can export very tall spritesheets that exceed WebGL texture limits and render as a blank tilemap in Phaser. Compact a fresh export before using it in the game:

```bash
npm run compact-map -- "/Users/rizaardiyanto/Downloads/mapnew fix" apps/client/public/maps/levels/level-01 --pretty
```

The input folder must contain `map.json` and `spritesheet.png`. The command copies only the tiles used by the map into a smaller `spritesheet.png`, rewrites the tile IDs in `map.json`, and writes the fixed files to the output folder.

To compact an existing map folder in place:

```bash
npm run compact-map -- apps/client/public/maps/levels/level-01 --in-place --pretty
```

For the usual workflow, run the interactive helper and paste or drag the SpriteFusion export folder path when prompted:

```bash
npm run update-map
```

It asks for the target level number (`1` to `20`) and writes the compacted output to `apps/client/public/maps/levels/level-XX`.

The game currently loads `level-01` by default. For local testing, set both server and client level ids to the same level:

```bash
LEVEL_ID=level-02 VITE_LEVEL_ID=level-02 npm run dev
```

## Manual Multiplayer QA Matrix
- 2 players: join, ready, start, finish/fail
- 3 players: role assignment with one missing role
- 4 players: full role assignment
- Reconnect: drop one player and rejoin with same name within grace window
- Latency: verify RTT display and acceptable input feel
