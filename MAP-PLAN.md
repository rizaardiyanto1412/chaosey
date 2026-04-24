# MAP-PLAN — New Tile Map Editor

## Product Goal
A first-class, in-browser level editor that lets us paint terrain, place auto-extracted props from any tileset, place animated entities that move along N-waypoint paths, and **save maps that play immediately in the real multiplayer game**.

## Locked Decisions (answers from the user)
1. **Tileset auto-extraction:** pixel analysis (connected-component bounding boxes on alpha). Editor names are manual after extraction.
2. **Character sprite sheets:** only used for **waypoint-path entities**, not as the player character. Player animation stays as-is in the existing game code.
3. **Waypoint paths:** N points per entity; per-entity toggles for **loop** and **speed**; motion runs **in the editor preview AND in the actual multiplayer game** (server simulates, broadcasts, clients render).
4. **Server consumable:** yes — the new level format replaces the current Tiled JSON loader. Editor has a **"Save as Map in game"** button to play instantly.
5. **Delete legacy editor:** done (`apps/client/editor.html`, `apps/client/src/editor/` removed; link in `index.html` removed).
6. **Stack choice:** whichever is fastest → **React + Tailwind + shadcn/ui** for the editor route (rich paneled UI in the reference screenshot benefits most from prebuilt components). The game page stays vanilla TS + Phaser. Vite multi-entry handles this trivially.

## Reference
- UI inspiration: the provided screenshot (top menu bar; left tools/terrain/items; canvas center; Test It button). Non-pixel, clean style.
- Example tileset for pixel extraction: `water-props-proportional-64-atlas-v7.png`.
- Example animation sheet for waypoints: `squirrel_walk_sheet_12f.png` (12 frames, single direction).

---

## New Level Document Format (`LevelDocument v1`)
Single JSON file per level, lives at `apps/client/public/maps/<id>/map.json`. Replaces the current Tiled format.

```
LevelDocument {
  version: 1
  id: string
  name: string
  grid: { cols, rows, tileSize }       // tileSize is world units per cell
  assets: {
    tilesets: Tileset[]                 // one or more
    spriteSheets: SpriteSheet[]         // for animated entities
  }
  layers: Layer[]                       // ordered bottom→top
  spawn: { x, y }                       // world coords (pixels)
  goal:  { x, y, w, h }
  entities: AnimatedEntity[]            // waypoint-driven, animated props/NPCs
  meta: { createdAt, updatedAt, thumbnail? }
}

Tileset {
  id, name, imagePath                   // /assets/tilesets/<file>.png
  extraction: "pixel" | "grid"
  tiles: Tile[]                         // each with { id, name, sx, sy, sw, sh }
}

SpriteSheet {
  id, name, imagePath
  frameW, frameH, frameCount, fps
  detection: "manual" | "uniform-grid"
}

Layer (tile) {
  id, name, kind: "tile"
  visible, opacity, collider: boolean
  tilesetId, cells: { [index]: tileId } // sparse; index = row*cols + col
}
Layer (object) { ... }                  // future use; not required for MVP

AnimatedEntity {
  id, name
  spriteSheetId
  waypoints: [{x,y}, ...]               // N ≥ 2
  speed: number                         // px/sec
  loopMode: "once" | "loop" | "pingpong"
  facingMode: "path" | "fixed-left" | "fixed-right"
  blocking: boolean                     // future: collide with players
}
```

All schemas live in `packages/shared/src/level.ts` with Zod validators so client, server, and editor agree.

---

## Architecture Overview
- **Editor** = new React SPA mounted at `/editor.html` (Vite multi-entry). State via Zustand (lightweight, minimal boilerplate vs Redux). Canvas rendered with raw 2D context (no Phaser — editor needs only tiles + sprites).
- **Shared package** = authoritative types + Zod schemas + pure helpers (extractSpritesFromAlpha, interpolateWaypoints, etc.).
- **Server** = new loader `loadLevelDocument(path)` replaces `loadLevelFromTiledJson`. Simulates `AnimatedEntity`s at tick rate and broadcasts their positions + current frame in the snapshot.
- **Game client** = Phaser scene gains an `EntityRenderer` that reads `entities[]` from snapshots and plays animations from the level's `spriteSheets`.
- **Level registry** = `apps/client/public/maps/index.json` generated/updated on save; lobby room creation accepts a `levelId`.
- **Dev-only save API** = Vite dev middleware `POST /__editor/save` writes files under `public/maps/`; in production, editor falls back to download-only.
- **"Test in Game"** = editor → save → open `/?room=auto&level=<id>` which creates a solo room on that level and auto-joins.

---

## Phased Roadmap

### Phase 0 — Cleanup (DONE)
- Deleted old editor files and link.

### Phase 1 — Shared Level Schema
- Add `packages/shared/src/level.ts` with TS types + Zod schemas for LevelDocument and sub-types.
- Add pure helpers: `worldToCell`, `cellToWorld`, `sampleWaypointPath(entity, tSeconds)` (supports once/loop/pingpong).
- Unit tests for helpers and schema round-trip.

### Phase 2 — Editor Scaffold (React/Tailwind/shadcn)
- Install `react`, `react-dom`, `@types/react*`, `@vitejs/plugin-react`, `tailwindcss`, `postcss`, `autoprefixer`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `zustand`.
- Add `vite.config.ts` with the React plugin and multi-entry (game + editor).
- Create `apps/client/editor.html` mounting `src/editor/main.tsx`.
- Initialize Tailwind + shadcn base; install `button`, `dialog`, `tabs`, `collapsible`, `tooltip`, `scroll-area`, `input`, `slider`, `select`, `toggle`, `separator`.
- App shell: top menu bar (File / Edit / View / Level / **Test It!**), left panel (Tools, Terrain, Items, Entities), center canvas, right properties panel, bottom status bar.
- Zustand store skeleton: `document`, `selection`, `tool`, `camera`, `history`.

### Phase 3 — Canvas Core & Terrain Tools
- Viewport component: pan (space+drag / middle drag), zoom (wheel), pixel-perfect grid overlay.
- Renderer draws all visible tile layers from cached HTMLImageElements of tilesets.
- Tools: **Move** (pan/select), **Paint**, **Erase**, **Fill (bucket)**, **Rect**.
- Layer panel: add / rename / reorder / visibility / opacity / delete / `collider` toggle.
- Undo/redo via command stack (Ctrl+Z / Ctrl+Shift+Z). Commands: `setCells`, `addLayer`, `removeLayer`, `reorderLayer`, `setLayerProps`, `setSpawn`, `setGoal`, `upsertEntity`, `removeEntity`.

### Phase 4 — Tileset Upload + Pixel-Analysis Extraction
- Drag-drop or file input for PNG tilesets (stored under `/assets/tilesets/`; in dev written via save API, in browser-only mode held in memory + embedded as data URL until saved).
- Worker-based extractor: scan alpha channel, run 4/8-connectivity flood-fill, compute tight bboxes, merge tiny orphans, sort top-left → right, emit `Tile[]` with auto names (`item_01`, `item_02`, …).
- Preview grid in the left "Terrain" / "Items" sections; click to select, drag-to-paint on canvas.
- Manual rename per tile; persist in the tileset `tiles[]`.
- Optional "Grid mode" toggle for uniform sheets (cell size, spacing, margin) — kept for convenience.

### Phase 5 — Spawn, Goal, Map Metadata
- Dedicated tools: **Set Spawn** (single point marker), **Set Goal** (drag a rect).
- Map properties dialog: name, cols, rows, tileSize.
- Resize handling: grow fills with 0; shrink prompts confirmation and clips.

### Phase 6 — Sprite Sheet Import + Waypoint Entities
- Upload sheet; user supplies `frameCount` and `fps` (auto-guessed from filename pattern like `_12f`).
- Frame extraction = uniform grid based on sheet width / frameCount (single-row assumption; matches provided example).
- Preview: scrubber + play/pause looping.
- **Entity tool:** click canvas to place an entity using the currently-selected sprite sheet → places first waypoint. Each subsequent click while the entity is selected adds another waypoint. Esc or double-click ends. Drag waypoints to move; right-click waypoint to delete.
- Properties panel (right side): name, sprite sheet, **speed** (slider + number, px/sec), **loop mode** (`once` / `loop` / `pingpong`), **facing** (`path` / `fixed-left` / `fixed-right`), `blocking` (future).
- **Live preview toggle** in the toolbar: when ON, entities animate and traverse their paths in the editor canvas using `sampleWaypointPath`.

### Phase 7 — Save / Load / Registry
- IndexedDB autosave of the current `LevelDocument` every N seconds (with thumbnail).
- **File menu:** New, Open (from `maps/index.json`), Import JSON, Download JSON, **Save** (writes to `public/maps/<id>/map.json` via dev API), **Save As…**.
- Thumbnail = offscreen-canvas downscale of the map + entities preview → `thumb.webp`.
- `maps/index.json` auto-updated on save: `[{ id, name, path, thumbnail, updatedAt }]`.
- Vite dev middleware: `POST /__editor/save` validates with Zod and writes files; rejects outside `public/maps/`. Disabled in production builds.

### Phase 8 — Server Integration
- Replace `loadLevelFromTiledJson` with `loadLevelDocument` in `apps/server/src/index.ts`.
- Room creation accepts `levelId`; server resolves against `maps/index.json` (MAPS_DIR env overrides). Fallback: first level in index.
- Build collision geometry from every layer where `collider === true` (cells with non-zero tileId become solid rects).
- Simulate `AnimatedEntity`s each tick: compute `(position, frameIndex)` via shared helper, store in room state.
- Extend `GameState` / snapshot payload with `entities: { id, x, y, frame, spriteSheetId }[]` and the level's `spriteSheets` in `level` info.
- Contract tests: Zod-validate snapshots; simulate entities in unit tests.

### Phase 9 — In-Game Entity Renderer
- Add `EntityRenderer` in the Phaser scene: on level init, preload every `spriteSheet.imagePath` as a Phaser spritesheet; each tick, upsert sprites keyed by entity id and set frame.
- Handle destroy on level change / disconnect.

### Phase 10 — Level Picker + "Test in Game"
- Lobby "Create Room" UI: dropdown of levels from `maps/index.json` (thumbnail + name). Default = current `reference-map` migrated.
- Editor **Test It!** button: save → `window.open("/?level=<id>&autoroom=1")` → game auto-creates a private room and starts immediately for solo testing.

### Phase 11 — Migration of Existing Map
- One-off script `scripts/convert-tiled-to-leveldoc.ts` that converts `apps/client/public/maps/reference-map/map.json` (current Tiled format) into new `LevelDocument`. Then delete Tiled-specific code paths.
- Ensures the existing playable level keeps working after the loader swap.

### Phase 12 — QA & Docs
- Playwright smoke: open editor, upload tileset (fixture image), paint wall, set spawn+goal, add entity with 3 waypoints + loop, save, reload, verify document integrity and `maps/index.json`.
- Unit: waypoint sampling edge cases (loop, pingpong, 0-length segment, single waypoint invalid → schema error).
- Update `README.md` with "Authoring a Level" + screenshots.
- Author one brand-new level end-to-end with the editor and ship it as `level-2`.

---

## Acceptance Criteria
- [ ] Editor produces a valid `LevelDocument v1` that the server loads without custom conversion.
- [ ] Pixel-analysis extraction yields a usable palette from `water-props-proportional-64-atlas-v7.png` with zero manual cropping.
- [ ] A waypoint entity using `squirrel_walk_sheet_12f.png` animates identically in the editor preview and in a live multiplayer room.
- [ ] At least two levels selectable at room creation, one of them authored entirely via the new editor.
- [ ] "Save as Map in game" button takes a user from editor → playable room in ≤ 2 clicks.
- [ ] Typecheck, unit tests, and Playwright smoke all green in CI.

## Open Risks
- **Pixel extraction quality** on assets with touching or anti-aliased props — mitigation: 8-connectivity + small-blob merge threshold + manual split tool as stretch.
- **Server perf** with many animated entities — mitigation: waypoint sampling is O(1) per entity per tick; broadcast deltas only.
- **Dev-save security** — strictly path-whitelist to `public/maps/` and reject `..`.
