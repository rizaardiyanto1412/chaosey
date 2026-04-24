# MAP-PROGRESS — New Tile Map Editor

Track every actionable task from `MAP-PLAN.md`. Mark `[x]` as completed.

## Phase 0 — Cleanup
- [x] Delete `apps/client/editor.html`
- [x] Delete `apps/client/src/editor/main.ts`
- [x] Delete `apps/client/src/editor/main.js` and the `editor/` folder
- [x] Remove "Open Map Editor" link from `apps/client/index.html`

## Phase 1 — Shared Level Schema
- [ ] Create `packages/shared/src/level.ts` with TS types for `LevelDocument`, `Tileset`, `Tile`, `SpriteSheet`, `Layer`, `AnimatedEntity`
- [ ] Add Zod schemas + `parseLevelDocument()` helper
- [ ] Add `worldToCell` / `cellToWorld` helpers
- [ ] Add `sampleWaypointPath(entity, tSeconds) -> { position, segmentIndex, done }` (supports `once` / `loop` / `pingpong`)
- [ ] Add `computeFrameIndex(sheet, tSeconds, loop)` helper
- [ ] Export from `packages/shared/src/index.ts`
- [ ] Unit tests: schema round-trip, waypoint sampling edge cases, frame computation

## Phase 2 — Editor Scaffold (React + Tailwind + shadcn)
- [ ] Add deps: `react`, `react-dom`, `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`
- [ ] Add UI deps: `tailwindcss`, `postcss`, `autoprefixer`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `zustand`
- [ ] Create `apps/client/vite.config.ts` (React plugin + multi-entry for `index.html` and `editor.html`)
- [ ] Create new `apps/client/editor.html` mounting `src/editor/main.tsx`
- [ ] Create `src/editor/main.tsx` + `App.tsx` + Tailwind CSS entry
- [ ] Initialize Tailwind config + shadcn base; add components: `button`, `dialog`, `tabs`, `collapsible`, `tooltip`, `scroll-area`, `input`, `slider`, `select`, `toggle`, `separator`, `dropdown-menu`
- [ ] Build app shell: top menu bar, left sidebar (Tools / Terrain / Items / Entities / Layers), center canvas area, right properties panel, bottom status bar
- [ ] Create Zustand store: `document`, `selection`, `activeTool`, `camera`, `history`, actions
- [ ] Wire File/Edit/View/Level menus (stubs)

## Phase 3 — Canvas Core & Terrain Tools
- [ ] Canvas viewport component with pan (space+drag, middle drag) and zoom (wheel)
- [ ] Grid overlay at current zoom level
- [ ] Tileset image cache + layer renderer
- [ ] Tool: Move / select
- [ ] Tool: Paint (single tile / drag paint)
- [ ] Tool: Erase
- [ ] Tool: Rect fill
- [ ] Tool: Bucket fill
- [ ] Layers panel: add / rename / reorder / toggle visibility / opacity slider / delete / `collider` toggle
- [ ] Undo/redo command stack + shortcuts (Ctrl+Z / Ctrl+Shift+Z)

## Phase 4 — Tileset Upload + Pixel Extraction
- [ ] Drag-drop / file input for PNG tilesets
- [ ] Web Worker that runs connected-component (8-connectivity) flood-fill on alpha
- [ ] Compute bounding boxes; filter blobs below min-size threshold
- [ ] Sort tiles top-left → right; auto-name `item_01..n`
- [ ] Display extracted tiles in left "Items" grid (shadcn scroll area); selection state
- [ ] Rename tile in properties panel; persist to `Tileset.tiles[]`
- [ ] "Grid mode" fallback: uniform tile size + spacing + margin
- [ ] Save uploaded tileset: dev mode writes to `/public/assets/tilesets/`, browser mode keeps data URL + embeds on export

## Phase 5 — Spawn / Goal / Map Props
- [ ] Tool: Set Spawn (single marker; cyan)
- [ ] Tool: Set Goal (drag rect; red)
- [ ] Map properties dialog: name, cols, rows, tileSize
- [ ] Resize grid (grow with 0; shrink with confirm)
- [ ] Validation panel: blocks save when spawn or goal missing, or spawn overlaps a `collider` cell

## Phase 6 — Sprite Sheets + Animated Waypoint Entities
- [ ] Upload sprite sheet dialog: auto-detect `_<N>f` in filename, editable frameCount + fps
- [ ] Sprite preview with play/pause/scrub
- [ ] Tool: Entity — click to place first waypoint + spawn entity; subsequent clicks append waypoints; Esc/double-click ends
- [ ] Entity selection + waypoint drag handles; right-click to delete waypoint
- [ ] Properties panel: name, sprite sheet, speed (slider + number), loop mode (once/loop/pingpong), facing (path/fixed-left/fixed-right), blocking (future)
- [ ] Editor preview toggle: animate entities along paths using shared sampler
- [ ] Visual path rendering (dashed line + arrows)

## Phase 7 — Save / Load / Registry
- [ ] IndexedDB autosave of current `LevelDocument` (debounced) with thumbnail
- [ ] File → New / Open / Import JSON / Download JSON / Save / Save As…
- [ ] Thumbnail generator (offscreen canvas downscale → `thumb.webp`)
- [ ] Auto-maintain `apps/client/public/maps/index.json` on save
- [ ] Vite dev middleware `POST /__editor/save` with Zod validation + path whitelist under `public/maps/`
- [ ] Vite dev middleware `POST /__editor/upload-asset` for tilesets + sprite sheets (whitelist `public/assets/`)
- [ ] Open dialog reads `maps/index.json` and shows thumbnails

## Phase 8 — Server Integration
- [ ] Add `loadLevelDocument(path)` in server; keep signature similar to current loader
- [ ] Replace `loadLevelFromTiledJson` usage in `apps/server/src/index.ts`
- [ ] Room create payload accepts optional `levelId`; resolve against `maps/index.json` (or `MAPS_DIR` env)
- [ ] Build collision rects from any layer with `collider: true`
- [ ] Server-side entity simulation loop: update `(x, y, frame)` per tick via shared helpers
- [ ] Extend `GameState` / snapshot with `entities[]` and embed `spriteSheets` in `level`
- [ ] Contract tests: Zod-validate snapshots with entities; movement correctness

## Phase 9 — In-Game Entity Renderer
- [ ] Add `EntityRenderer` to Phaser scene: preload `spriteSheets` from the current level
- [ ] Each snapshot: upsert sprite per entity id, apply position and frame
- [ ] Cleanup sprites on level change / disconnect

## Phase 10 — Level Picker + "Test in Game"
- [ ] Lobby "Create Room" dropdown populated from `maps/index.json` (thumbnail + name)
- [ ] Persist `levelId` with the created room; server honors it
- [ ] Editor **Test It!** button: save → open `/?level=<id>&autoroom=1`
- [ ] Game recognizes `?autoroom=1` and creates+joins a private solo room on the chosen level

## Phase 11 — Migration of Existing Map
- [ ] Write `scripts/convert-tiled-to-leveldoc.ts`
- [ ] Convert `apps/client/public/maps/reference-map/map.json` to new format
- [ ] Add converted level to `maps/index.json`
- [ ] Remove Tiled-specific code paths from the server

## Phase 12 — QA & Docs
- [ ] Playwright smoke: upload fixture tileset → paint walls → set spawn/goal → add 3-waypoint looping entity → save → reload → validate
- [ ] Unit tests: waypoint sampler edge cases, frame index wrap, schema errors
- [ ] Update `README.md` with "Authoring a Level" section + screenshots
- [ ] Author and ship a second level (`level-2`) end-to-end using the new editor
- [ ] CI green: lint / typecheck / unit / Playwright

---

## Current Focus
- Phase 1 — Shared Level Schema (starting here because every other phase depends on these types).
