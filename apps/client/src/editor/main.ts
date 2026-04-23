type Tool = "paint" | "erase";
type TileMode = "auto" | "grid";

interface AtlasConfig {
  tileW: number;
  tileH: number;
  spacingX: number;
  spacingY: number;
  offsetX: number;
  offsetY: number;
}

interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

interface TilesetPreset {
  mode: TileMode;
  atlas: AtlasConfig;
}

interface MapDocument {
  version: 2;
  tilesetSrc: string;
  tileMode: TileMode;
  autoTerrain?: boolean;
  atlas: AtlasConfig;
  paletteRects?: SourceRect[];
  map: {
    cols: number;
    rows: number;
    cellSize: number;
    tiles: number[];
  };
}

const LOCAL_KEY = "wasd_map_editor_document_v2";

const tilesetSelect = document.getElementById("tilesetSelect") as HTMLSelectElement;
const tileWInput = document.getElementById("tileW") as HTMLInputElement;
const tileHInput = document.getElementById("tileH") as HTMLInputElement;
const spacingXInput = document.getElementById("spacingX") as HTMLInputElement;
const spacingYInput = document.getElementById("spacingY") as HTMLInputElement;
const offsetXInput = document.getElementById("offsetX") as HTMLInputElement;
const offsetYInput = document.getElementById("offsetY") as HTMLInputElement;
const mapColsInput = document.getElementById("mapCols") as HTMLInputElement;
const mapRowsInput = document.getElementById("mapRows") as HTMLInputElement;
const cellSizeInput = document.getElementById("cellSize") as HTMLInputElement;
const zoomInput = document.getElementById("zoom") as HTMLInputElement;

const paintBtn = document.getElementById("paintBtn") as HTMLButtonElement;
const eraseBtn = document.getElementById("eraseBtn") as HTMLButtonElement;
const newMapBtn = document.getElementById("newMapBtn") as HTMLButtonElement;
const clearBtn = document.getElementById("clearBtn") as HTMLButtonElement;
const autoTerrainBtn = document.getElementById("autoTerrainBtn") as HTMLButtonElement;
const saveLocalBtn = document.getElementById("saveLocalBtn") as HTMLButtonElement;
const loadLocalBtn = document.getElementById("loadLocalBtn") as HTMLButtonElement;
const downloadBtn = document.getElementById("downloadBtn") as HTMLButtonElement;
const importBtn = document.getElementById("importBtn") as HTMLButtonElement;
const importFileInput = document.getElementById("importFile") as HTMLInputElement;
const tilesetQuickPick = document.getElementById("tilesetQuickPick") as HTMLDivElement;
const uploadTilesetBtn = document.getElementById("uploadTilesetBtn") as HTMLButtonElement;
const reloadTilesetBtn = document.getElementById("reloadTilesetBtn") as HTMLButtonElement;
const tilesetFileInput = document.getElementById("tilesetFile") as HTMLInputElement;
const palettePrevBtn = document.getElementById("palettePrevBtn") as HTMLButtonElement;
const paletteNextBtn = document.getElementById("paletteNextBtn") as HTMLButtonElement;
const palettePageInfo = document.getElementById("palettePageInfo") as HTMLDivElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

const paletteCanvas = document.getElementById("palette") as HTMLCanvasElement;
const mapCanvas = document.getElementById("map") as HTMLCanvasElement;
const paletteCtx = paletteCanvas.getContext("2d")!;
const mapCtx = mapCanvas.getContext("2d")!;

let mapTiles: number[] = [];
let selectedTileIndex = 0;
let tool: Tool = "paint";
let tileMode: TileMode = "auto";
let drawing = false;
let palettePage = 0;
let autoTerrainEnabled = false;

let currentPaletteRects: SourceRect[] = [];
let autoDetectedRects: SourceRect[] = [];
let paletteCells: Array<{ x: number; y: number; w: number; h: number; index: number }> = [];
let autotileMaskToTile: number[] | null = null;

const tilesetImage = new Image();
tilesetImage.decoding = "async";

const TILESET_PRESETS: Record<string, TilesetPreset> = {
  "/assets/tilesets/grass-water-autotile-v1.png": {
    mode: "grid",
    atlas: {
      tileW: 256,
      tileH: 256,
      spacingX: 0,
      spacingY: 0,
      offsetX: 0,
      offsetY: 0
    }
  },
  "/assets/tilesets/grass-water-tileset-v2.png": {
    mode: "grid",
    atlas: {
      tileW: 128,
      tileH: 128,
      spacingX: 0,
      spacingY: 0,
      offsetX: 0,
      offsetY: 0
    }
  },
  "/assets/tilesets/grass-water-tileset-v1.png": {
    mode: "grid",
    atlas: {
      tileW: 170,
      tileH: 170,
      spacingX: 0,
      spacingY: 0,
      offsetX: 0,
      offsetY: 0
    }
  }
};

tilesetImage.onload = () => {
  autoDetectedRects = detectSprites(tilesetImage);
  if (tileMode === "auto" && autoDetectedRects.length > 0) {
    currentPaletteRects = autoDetectedRects;
  } else {
    currentPaletteRects = buildGridRects();
  }

  selectedTileIndex = Math.min(selectedTileIndex, Math.max(0, currentPaletteRects.length - 1));
  renderPalette();
  renderMap();
  setStatus(`Tileset loaded: ${tilesetImage.width}x${tilesetImage.height}, auto-detected ${autoDetectedRects.length} sprites.`);
};

tilesetImage.onerror = () => {
  setStatus("Failed to load tileset.");
};

function n(input: HTMLInputElement): number {
  return Number(input.value || "0");
}

function atlasConfig(): AtlasConfig {
  return {
    tileW: Math.max(1, n(tileWInput)),
    tileH: Math.max(1, n(tileHInput)),
    spacingX: Math.max(0, n(spacingXInput)),
    spacingY: Math.max(0, n(spacingYInput)),
    offsetX: Math.max(0, n(offsetXInput)),
    offsetY: Math.max(0, n(offsetYInput))
  };
}

function mapConfig() {
  return {
    cols: Math.max(1, n(mapColsInput)),
    rows: Math.max(1, n(mapRowsInput)),
    cellSize: Math.max(4, n(cellSizeInput)),
    zoom: Math.max(0.5, n(zoomInput))
  };
}

function detectSprites(image: HTMLImageElement): SourceRect[] {
  if (!image.width || !image.height) return [];

  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0);

  const { data, width, height } = ctx.getImageData(0, 0, image.width, image.height);
  const visited = new Uint8Array(width * height);
  const rects: SourceRect[] = [];
  const alphaThreshold = 10;
  const minPixels = 120;

  const stack: number[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (visited[idx]) continue;

      const alpha = data[idx * 4 + 3];
      if (alpha <= alphaThreshold) {
        visited[idx] = 1;
        continue;
      }

      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let pixels = 0;

      stack.push(idx);
      visited[idx] = 1;

      while (stack.length > 0) {
        const p = stack.pop()!;
        const py = Math.floor(p / width);
        const px = p - py * width;

        const pAlpha = data[p * 4 + 3];
        if (pAlpha <= alphaThreshold) {
          continue;
        }

        pixels += 1;
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;

        const neighbors = [p - 1, p + 1, p - width, p + width];
        for (const nIdx of neighbors) {
          if (nIdx < 0 || nIdx >= width * height) continue;
          const ny = Math.floor(nIdx / width);
          const nx = nIdx - ny * width;
          if (Math.abs(nx - px) + Math.abs(ny - py) !== 1) continue;
          if (visited[nIdx]) continue;
          visited[nIdx] = 1;
          stack.push(nIdx);
        }
      }

      if (pixels >= minPixels) {
        rects.push({
          sx: Math.max(0, minX - 1),
          sy: Math.max(0, minY - 1),
          sw: Math.min(width - minX, maxX - minX + 3),
          sh: Math.min(height - minY, maxY - minY + 3)
        });
      }
    }
  }

  rects.sort((a, b) => {
    const dy = a.sy - b.sy;
    if (Math.abs(dy) > 24) return dy;
    return a.sx - b.sx;
  });

  return rects;
}

function detectBestGridConfig(image: HTMLImageElement): AtlasConfig | null {
  const w = image.width;
  const h = image.height;
  let best: { cfg: AtlasConfig; score: number } | null = null;

  for (let tileW = 24; tileW <= 256; tileW += 1) {
    for (let tileH = 24; tileH <= 256; tileH += 1) {
      for (let offsetX = 0; offsetX <= 16; offsetX += 1) {
        if ((w - offsetX) <= 0 || (w - offsetX) % tileW !== 0) continue;
        const cols = (w - offsetX) / tileW;
        if (cols < 3 || cols > 16) continue;

        for (let offsetY = 0; offsetY <= 16; offsetY += 1) {
          if ((h - offsetY) <= 0 || (h - offsetY) % tileH !== 0) continue;
          const rows = (h - offsetY) / tileH;
          if (rows < 3 || rows > 16) continue;

          const cellCount = cols * rows;
          const cellArea = tileW * tileH;
          const squarenessPenalty = Math.abs(tileW - tileH);
          const tinyOffsetPenalty = offsetX + offsetY;
          const score = cellCount * 10000 + cellArea - squarenessPenalty * 10 - tinyOffsetPenalty * 20;

          if (!best || score > best.score) {
            best = {
              score,
              cfg: {
                tileW,
                tileH,
                spacingX: 0,
                spacingY: 0,
                offsetX,
                offsetY
              }
            };
          }
        }
      }
    }
  }

  return best?.cfg ?? null;
}

function detectLineGridRects(image: HTMLImageElement): SourceRect[] {
  if (!image.width || !image.height) return [];

  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0);
  const raw = ctx.getImageData(0, 0, image.width, image.height).data;
  const w = image.width;
  const h = image.height;

  const colDark = new Array<number>(w).fill(0);
  const rowDark = new Array<number>(h).fill(0);

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = (y * w + x) * 4;
      const lum = (raw[idx] + raw[idx + 1] + raw[idx + 2]) / 3;
      if (lum < 50) {
        colDark[x] += 1;
        rowDark[y] += 1;
      }
    }
  }

  const colLineCandidates: number[] = [];
  const rowLineCandidates: number[] = [];
  for (let x = 0; x < w; x += 1) {
    if (colDark[x] > h * 0.72) colLineCandidates.push(x);
  }
  for (let y = 0; y < h; y += 1) {
    if (rowDark[y] > w * 0.72) rowLineCandidates.push(y);
  }

  const group = (arr: number[]) => {
    if (arr.length === 0) return [] as Array<{ start: number; end: number }>;
    const out: Array<{ start: number; end: number }> = [];
    let start = arr[0];
    let prev = arr[0];
    for (let i = 1; i < arr.length; i += 1) {
      const cur = arr[i];
      if (cur === prev + 1) {
        prev = cur;
      } else {
        out.push({ start, end: prev });
        start = cur;
        prev = cur;
      }
    }
    out.push({ start, end: prev });
    return out;
  };

  const colGroups = group(colLineCandidates);
  const rowGroups = group(rowLineCandidates);
  if (colGroups.length < 3 || rowGroups.length < 3) return [];

  const rects: SourceRect[] = [];
  for (let yi = 0; yi < rowGroups.length - 1; yi += 1) {
    const sy = rowGroups[yi].end + 1;
    const ey = rowGroups[yi + 1].start - 1;
    const sh = ey - sy + 1;
    if (sh < 16) continue;

    for (let xi = 0; xi < colGroups.length - 1; xi += 1) {
      const sx = colGroups[xi].end + 1;
      const ex = colGroups[xi + 1].start - 1;
      const sw = ex - sx + 1;
      if (sw < 16) continue;
      rects.push({ sx, sy, sw, sh });
    }
  }

  return rects;
}

function buildGridRects(config = atlasConfig()): SourceRect[] {
  if (!tilesetImage.width || !tilesetImage.height) return [];

  const cols = Math.floor((tilesetImage.width - config.offsetX + config.spacingX) / (config.tileW + config.spacingX));
  const rows = Math.floor((tilesetImage.height - config.offsetY + config.spacingY) / (config.tileH + config.spacingY));

  const rects: SourceRect[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      rects.push({
        sx: config.offsetX + col * (config.tileW + config.spacingX),
        sy: config.offsetY + row * (config.tileH + config.spacingY),
        sw: config.tileW,
        sh: config.tileH
      });
    }
  }

  return rects;
}

function setStatus(message: string) {
  statusEl.textContent = message;
}

function hamming4(a: number, b: number): number {
  let v = a ^ b;
  let bits = 0;
  while (v) {
    bits += v & 1;
    v >>= 1;
  }
  return bits;
}

function buildAutotileMaskToTileMap(rects: SourceRect[]): number[] | null {
  if (rects.length < 16 || !tilesetImage.width || !tilesetImage.height) return null;

  const canvas = document.createElement("canvas");
  canvas.width = tilesetImage.width;
  canvas.height = tilesetImage.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(tilesetImage, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const imgW = canvas.width;

  const isGrass = (r: number, g: number, b: number) => g > r + 8 && g > b + 8;
  const edgeHasGrass = (rect: SourceRect, side: "N" | "E" | "S" | "W") => {
    const sampleDepth = Math.max(2, Math.floor(Math.min(rect.sw, rect.sh) * 0.06));
    const inset = Math.max(2, Math.floor(Math.min(rect.sw, rect.sh) * 0.12));
    let grass = 0;
    let total = 0;

    for (let dy = 0; dy < rect.sh; dy += 1) {
      for (let dx = 0; dx < rect.sw; dx += 1) {
        const onSide =
          (side === "N" && dy < sampleDepth && dx >= inset && dx < rect.sw - inset) ||
          (side === "S" && dy >= rect.sh - sampleDepth && dx >= inset && dx < rect.sw - inset) ||
          (side === "W" && dx < sampleDepth && dy >= inset && dy < rect.sh - inset) ||
          (side === "E" && dx >= rect.sw - sampleDepth && dy >= inset && dy < rect.sh - inset);
        if (!onSide) continue;
        const px = rect.sx + dx;
        const py = rect.sy + dy;
        const idx = (py * imgW + px) * 4;
        if (isGrass(data[idx], data[idx + 1], data[idx + 2])) grass += 1;
        total += 1;
      }
    }

    if (total === 0) return false;
    return grass / total > 0.45;
  };

  const descriptors = rects.slice(0, 16).map((rect, idx) => {
    const n = edgeHasGrass(rect, "N") ? 1 : 0;
    const e = edgeHasGrass(rect, "E") ? 2 : 0;
    const s = edgeHasGrass(rect, "S") ? 4 : 0;
    const w = edgeHasGrass(rect, "W") ? 8 : 0;
    return { idx, mask: n | e | s | w };
  });

  const mapping = new Array<number>(16).fill(0);
  for (let mask = 0; mask < 16; mask += 1) {
    const exact = descriptors.find((d) => d.mask === mask);
    if (exact) {
      mapping[mask] = exact.idx;
      continue;
    }

    let bestIdx = descriptors[0]?.idx ?? 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const d of descriptors) {
      const distance = hamming4(d.mask, mask);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIdx = d.idx;
      }
    }
    mapping[mask] = bestIdx;
  }

  return mapping;
}

function ensureMapSize() {
  const { cols, rows } = mapConfig();
  const required = cols * rows;
  if (mapTiles.length === required) return;

  const next = new Array<number>(required).fill(-1);
  for (let i = 0; i < Math.min(required, mapTiles.length); i += 1) {
    next[i] = mapTiles[i];
  }
  mapTiles = next;
}

function updateAutoTerrainUi() {
  const hasAutotileMap = Boolean(autotileMaskToTile);
  if (!hasAutotileMap) {
    autoTerrainEnabled = false;
  }
  autoTerrainBtn.disabled = !hasAutotileMap;
  autoTerrainBtn.textContent = `Auto Terrain: ${autoTerrainEnabled ? "On" : "Off"}`;
  autoTerrainBtn.classList.toggle("primary", autoTerrainEnabled);
}

function setTool(next: Tool) {
  tool = next;
  paintBtn.classList.toggle("primary", next === "paint");
  eraseBtn.classList.toggle("primary", next === "erase");
}

function setTileMode(mode: TileMode) {
  tileMode = mode;
  if (tileMode === "auto") {
    currentPaletteRects = autoDetectedRects.length >= 8 ? autoDetectedRects : buildGridRects();
    if (autoDetectedRects.length < 8) {
      tileMode = "grid";
    }
  } else {
    currentPaletteRects = buildGridRects();
  }
  selectedTileIndex = Math.min(selectedTileIndex, Math.max(0, currentPaletteRects.length - 1));
  palettePage = 0;
  renderPalette();
  renderMap();
}

function applyPresetIfAny() {
  const preset = TILESET_PRESETS[tilesetSelect.value];
  if (!preset) return false;

  tileWInput.value = String(preset.atlas.tileW);
  tileHInput.value = String(preset.atlas.tileH);
  spacingXInput.value = String(preset.atlas.spacingX);
  spacingYInput.value = String(preset.atlas.spacingY);
  offsetXInput.value = String(preset.atlas.offsetX);
  offsetYInput.value = String(preset.atlas.offsetY);
  tileMode = preset.mode;
  return true;
}

function renderTilesetQuickPick() {
  if (!tilesetQuickPick) return;
  tilesetQuickPick.innerHTML = "";
  const options = [...tilesetSelect.options];
  for (const option of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = option.textContent?.trim() || option.value;
    btn.classList.toggle("primary", option.value === tilesetSelect.value);
    btn.onclick = () => {
      tilesetSelect.value = option.value;
      loadTileset();
      renderTilesetQuickPick();
    };
    tilesetQuickPick.append(btn);
  }
}

function recomputeAutoTerrainTiles() {
  if (!autotileMaskToTile) return;
  const { cols, rows } = mapConfig();
  const old = [...mapTiles];
  const isFilled = (col: number, row: number) => {
    if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
    return old[row * cols + col] >= 0;
  };

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const i = row * cols + col;
      if (!isFilled(col, row)) {
        mapTiles[i] = -1;
        continue;
      }
      const mask =
        (isFilled(col, row - 1) ? 1 : 0) |
        (isFilled(col + 1, row) ? 2 : 0) |
        (isFilled(col, row + 1) ? 4 : 0) |
        (isFilled(col - 1, row) ? 8 : 0);
      mapTiles[i] = autotileMaskToTile[mask];
    }
  }
}

function renderPalette() {
  paletteCtx.clearRect(0, 0, paletteCanvas.width, paletteCanvas.height);
  paletteCells = [];

  if (!tilesetImage.width || currentPaletteRects.length === 0) {
    setStatus("No palette tiles available.");
    return;
  }

  const pad = 8;
  const slot = 68;
  const cols = Math.max(1, Math.floor((paletteCanvas.width - pad * 2) / slot));
  const rows = Math.max(1, Math.floor((paletteCanvas.height - pad * 2) / slot));
  const tilesPerPage = Math.max(1, cols * rows);
  const totalPages = Math.max(1, Math.ceil(currentPaletteRects.length / tilesPerPage));
  palettePage = Math.max(0, Math.min(palettePage, totalPages - 1));
  const start = palettePage * tilesPerPage;
  const end = Math.min(currentPaletteRects.length, start + tilesPerPage);

  for (let i = start; i < end; i += 1) {
    const rect = currentPaletteRects[i];
    const local = i - start;
    const cellX = pad + (local % cols) * slot;
    const cellY = pad + Math.floor(local / cols) * slot;
    const cellW = slot - 6;
    const cellH = slot - 6;

    paletteCells.push({ x: cellX, y: cellY, w: cellW, h: cellH, index: i });

    paletteCtx.fillStyle = "rgba(22, 35, 60, 0.7)";
    paletteCtx.fillRect(cellX, cellY, cellW, cellH);

    const scale = Math.min((cellW - 8) / rect.sw, (cellH - 8) / rect.sh);
    const drawW = Math.max(1, Math.floor(rect.sw * scale));
    const drawH = Math.max(1, Math.floor(rect.sh * scale));
    const drawX = cellX + Math.floor((cellW - drawW) / 2);
    const drawY = cellY + Math.floor((cellH - drawH) / 2);

    paletteCtx.imageSmoothingEnabled = false;
    paletteCtx.drawImage(tilesetImage, rect.sx, rect.sy, rect.sw, rect.sh, drawX, drawY, drawW, drawH);

    paletteCtx.strokeStyle = i === selectedTileIndex ? "#34d399" : "rgba(103, 128, 165, 0.7)";
    paletteCtx.lineWidth = i === selectedTileIndex ? 2 : 1;
    paletteCtx.strokeRect(cellX + 0.5, cellY + 0.5, cellW - 1, cellH - 1);
  }

  palettePageInfo.textContent = `Page ${palettePage + 1}/${totalPages}`;
  palettePrevBtn.disabled = palettePage <= 0;
  paletteNextBtn.disabled = palettePage >= totalPages - 1;
  setStatus(`${tileMode === "auto" ? "Auto" : "Grid"} palette: ${currentPaletteRects.length} selectable tiles.`);
}

function renderMap() {
  ensureMapSize();
  const { cols, rows, cellSize, zoom } = mapConfig();
  const displaySize = Math.max(2, Math.floor(cellSize * zoom));

  mapCanvas.width = cols * displaySize;
  mapCanvas.height = rows * displaySize;

  mapCtx.imageSmoothingEnabled = false;
  mapCtx.fillStyle = "#081223";
  mapCtx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const mapIndex = row * cols + col;
      const tileIndex = mapTiles[mapIndex];
      const dx = col * displaySize;
      const dy = row * displaySize;

      if (tileIndex >= 0 && tileIndex < currentPaletteRects.length && tilesetImage.width) {
        const rect = currentPaletteRects[tileIndex];
        mapCtx.drawImage(tilesetImage, rect.sx, rect.sy, rect.sw, rect.sh, dx, dy, displaySize, displaySize);
      }

      mapCtx.strokeStyle = "rgba(143, 163, 191, 0.25)";
      mapCtx.lineWidth = 1;
      mapCtx.strokeRect(dx + 0.5, dy + 0.5, displaySize, displaySize);
    }
  }
}

function canvasPointFromEvent(canvas: HTMLCanvasElement, event: PointerEvent | MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}

function mapCellFromPointer(event: PointerEvent) {
  const { cols, rows, cellSize, zoom } = mapConfig();
  const displaySize = Math.max(2, Math.floor(cellSize * zoom));
  const { x, y } = canvasPointFromEvent(mapCanvas, event);
  const col = Math.floor(x / displaySize);
  const row = Math.floor(y / displaySize);

  if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
  return { index: row * cols + col };
}

function applyAtPointer(event: PointerEvent) {
  const cell = mapCellFromPointer(event);
  if (!cell) return;
  if (autoTerrainEnabled && autotileMaskToTile) {
    mapTiles[cell.index] = tool === "paint" ? autotileMaskToTile[15] : -1;
    recomputeAutoTerrainTiles();
    renderMap();
    return;
  }
  mapTiles[cell.index] = tool === "paint" ? selectedTileIndex : -1;
  renderMap();
}

function buildDocument(): MapDocument {
  ensureMapSize();
  const { cols, rows, cellSize } = mapConfig();
  return {
    version: 2,
    tilesetSrc: tilesetSelect.value,
    tileMode,
    autoTerrain: autoTerrainEnabled,
    atlas: atlasConfig(),
    paletteRects: tileMode === "auto" ? currentPaletteRects : undefined,
    map: {
      cols,
      rows,
      cellSize,
      tiles: [...mapTiles]
    }
  };
}

function applyDocument(doc: MapDocument | (MapDocument & { version?: 1 })) {
  tilesetSelect.value = doc.tilesetSrc;
  tileWInput.value = String(doc.atlas.tileW);
  tileHInput.value = String(doc.atlas.tileH);
  spacingXInput.value = String(doc.atlas.spacingX);
  spacingYInput.value = String(doc.atlas.spacingY);
  offsetXInput.value = String(doc.atlas.offsetX);
  offsetYInput.value = String(doc.atlas.offsetY);
  mapColsInput.value = String(doc.map.cols);
  mapRowsInput.value = String(doc.map.rows);
  cellSizeInput.value = String(doc.map.cellSize);

  tileMode = doc.tileMode ?? "grid";
  autoTerrainEnabled = Boolean(doc.autoTerrain);
  mapTiles = [...doc.map.tiles];
  selectedTileIndex = 0;

  loadTileset(() => {
    if (tileMode === "auto") {
      currentPaletteRects = doc.paletteRects && doc.paletteRects.length > 0 ? doc.paletteRects : autoDetectedRects;
    } else {
      currentPaletteRects = buildGridRects();
    }
    renderPalette();
    if (autoTerrainEnabled) {
      recomputeAutoTerrainTiles();
    }
    renderMap();
    updateAutoTerrainUi();
  });
}

function saveLocal() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(buildDocument()));
  setStatus("Saved to local storage.");
}

function loadLocal() {
  const raw = localStorage.getItem(LOCAL_KEY);
  if (!raw) {
    setStatus("No local map found.");
    return;
  }

  try {
    applyDocument(JSON.parse(raw) as MapDocument);
    setStatus("Loaded from local storage.");
  } catch {
    setStatus("Failed to parse local map.");
  }
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(buildDocument(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "wasd-map.json";
  a.click();
  URL.revokeObjectURL(url);
  setStatus("Map JSON downloaded.");
}

function importJson(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      applyDocument(JSON.parse(String(reader.result)) as MapDocument);
      setStatus("Map JSON imported.");
    } catch {
      setStatus("Import failed: invalid JSON.");
    }
  };
  reader.readAsText(file);
}

function loadTileset(onLoaded?: () => void) {
  const hadPreset = applyPresetIfAny();
  renderTilesetQuickPick();
  tilesetImage.onload = () => {
    autoDetectedRects = detectSprites(tilesetImage);
    const lineGridRects = detectLineGridRects(tilesetImage);
    if (!onLoaded) {
      if (lineGridRects.length >= 16) {
        currentPaletteRects = lineGridRects;
        tileMode = "grid";
        renderPalette();
        renderMap();
      } else if (hadPreset) {
        setTileMode(tileMode);
      } else if (autoDetectedRects.length >= 8) {
        setTileMode("auto");
      } else {
        const guessed = detectBestGridConfig(tilesetImage);
        if (guessed) {
          tileWInput.value = String(guessed.tileW);
          tileHInput.value = String(guessed.tileH);
          spacingXInput.value = String(guessed.spacingX);
          spacingYInput.value = String(guessed.spacingY);
          offsetXInput.value = String(guessed.offsetX);
          offsetYInput.value = String(guessed.offsetY);
        }
        setTileMode("grid");
      }
    } else {
      onLoaded();
    }
    autotileMaskToTile = buildAutotileMaskToTileMap(currentPaletteRects);
    if (!autotileMaskToTile) {
      autoTerrainEnabled = false;
    }
    updateAutoTerrainUi();
    palettePage = 0;
    setStatus(
      `Tileset loaded: ${tilesetImage.width}x${tilesetImage.height}, auto=${autoDetectedRects.length}, line-grid=${lineGridRects.length}, mode=${tileMode}.`
    );
  };
  tilesetImage.src = tilesetSelect.value;
}

paletteCanvas.addEventListener("click", (event) => {
  const { x, y } = canvasPointFromEvent(paletteCanvas, event);

  const hit = paletteCells.find((cell) => x >= cell.x && y >= cell.y && x <= cell.x + cell.w && y <= cell.y + cell.h);
  if (!hit) return;

  selectedTileIndex = hit.index;
  renderPalette();
});

mapCanvas.addEventListener("contextmenu", (event) => event.preventDefault());
mapCanvas.addEventListener("pointerdown", (event) => {
  drawing = true;
  if (event.button === 2) {
    setTool("erase");
  }
  applyAtPointer(event);
});
mapCanvas.addEventListener("pointermove", (event) => {
  if (!drawing) return;
  applyAtPointer(event);
});
window.addEventListener("pointerup", () => {
  drawing = false;
});

paintBtn.onclick = () => setTool("paint");
eraseBtn.onclick = () => setTool("erase");
newMapBtn.onclick = () => {
  mapTiles = [];
  ensureMapSize();
  renderMap();
  setStatus("New map initialized.");
};
clearBtn.onclick = () => {
  mapTiles.fill(-1);
  renderMap();
  setStatus("Map cleared.");
};
autoTerrainBtn.onclick = () => {
  if (!autotileMaskToTile) return;
  autoTerrainEnabled = !autoTerrainEnabled;
  if (autoTerrainEnabled) {
    recomputeAutoTerrainTiles();
    renderMap();
  }
  updateAutoTerrainUi();
};
saveLocalBtn.onclick = () => saveLocal();
loadLocalBtn.onclick = () => loadLocal();
downloadBtn.onclick = () => downloadJson();
importBtn.onclick = () => importFileInput.click();
importFileInput.onchange = () => {
  const file = importFileInput.files?.[0];
  if (file) importJson(file);
};

tilesetSelect.addEventListener("change", () => loadTileset());
tilesetSelect.addEventListener("input", () => loadTileset());
uploadTilesetBtn.onclick = () => tilesetFileInput.click();
reloadTilesetBtn.onclick = () => loadTileset();
tilesetFileInput.onchange = () => {
  const file = tilesetFileInput.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const existing = [...tilesetSelect.options].find((o) => o.value === url);
  if (!existing) {
    const option = document.createElement("option");
    option.value = url;
    option.textContent = `custom: ${file.name}`;
    tilesetSelect.append(option);
  }
  tilesetSelect.value = url;
  loadTileset();
  renderTilesetQuickPick();
};

palettePrevBtn.onclick = () => {
  palettePage = Math.max(0, palettePage - 1);
  renderPalette();
};
paletteNextBtn.onclick = () => {
  palettePage += 1;
  renderPalette();
};

[tileWInput, tileHInput, spacingXInput, spacingYInput, offsetXInput, offsetYInput].forEach((el) =>
  el.addEventListener("change", () => {
    currentPaletteRects = buildGridRects();
    selectedTileIndex = 0;
    setTileMode("grid");
  })
);

[mapColsInput, mapRowsInput, cellSizeInput, zoomInput].forEach((el) =>
  el.addEventListener("change", () => {
    ensureMapSize();
    if (autoTerrainEnabled) {
      recomputeAutoTerrainTiles();
    }
    renderMap();
  })
);

setTool("paint");
ensureMapSize();
loadTileset();
renderMap();
