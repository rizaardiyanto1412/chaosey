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

interface MapDocument {
  version: 2;
  tilesetSrc: string;
  tileMode: TileMode;
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
const saveLocalBtn = document.getElementById("saveLocalBtn") as HTMLButtonElement;
const loadLocalBtn = document.getElementById("loadLocalBtn") as HTMLButtonElement;
const downloadBtn = document.getElementById("downloadBtn") as HTMLButtonElement;
const importBtn = document.getElementById("importBtn") as HTMLButtonElement;
const importFileInput = document.getElementById("importFile") as HTMLInputElement;
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

let currentPaletteRects: SourceRect[] = [];
let autoDetectedRects: SourceRect[] = [];
let paletteCells: Array<{ x: number; y: number; w: number; h: number; index: number }> = [];

const tilesetImage = new Image();
tilesetImage.decoding = "async";

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

function setTool(next: Tool) {
  tool = next;
  paintBtn.classList.toggle("primary", next === "paint");
  eraseBtn.classList.toggle("primary", next === "erase");
}

function setTileMode(mode: TileMode) {
  tileMode = mode;
  currentPaletteRects = mode === "auto" ? autoDetectedRects : buildGridRects();
  selectedTileIndex = Math.min(selectedTileIndex, Math.max(0, currentPaletteRects.length - 1));
  renderPalette();
  renderMap();
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

  for (let i = 0; i < currentPaletteRects.length; i += 1) {
    const rect = currentPaletteRects[i];
    const cellX = pad + (i % cols) * slot;
    const cellY = pad + Math.floor(i / cols) * slot;
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

function mapCellFromPointer(event: PointerEvent) {
  const { cols, rows, cellSize, zoom } = mapConfig();
  const displaySize = Math.max(2, Math.floor(cellSize * zoom));
  const rect = mapCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const col = Math.floor(x / displaySize);
  const row = Math.floor(y / displaySize);

  if (col < 0 || row < 0 || col >= cols || row >= rows) return null;
  return { index: row * cols + col };
}

function applyAtPointer(event: PointerEvent) {
  const cell = mapCellFromPointer(event);
  if (!cell) return;
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
  mapTiles = [...doc.map.tiles];
  selectedTileIndex = 0;

  loadTileset(() => {
    if (tileMode === "auto") {
      currentPaletteRects = doc.paletteRects && doc.paletteRects.length > 0 ? doc.paletteRects : autoDetectedRects;
    } else {
      currentPaletteRects = buildGridRects();
    }
    renderPalette();
    renderMap();
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
  tilesetImage.onload = () => {
    autoDetectedRects = detectSprites(tilesetImage);
    if (!onLoaded) {
      if (autoDetectedRects.length >= 8) {
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
    setStatus(
      `Tileset loaded: ${tilesetImage.width}x${tilesetImage.height}, auto-detected ${autoDetectedRects.length} sprites, mode=${tileMode}.`
    );
  };
  tilesetImage.src = tilesetSelect.value;
}

paletteCanvas.addEventListener("click", (event) => {
  const rect = paletteCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

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
saveLocalBtn.onclick = () => saveLocal();
loadLocalBtn.onclick = () => loadLocal();
downloadBtn.onclick = () => downloadJson();
importBtn.onclick = () => importFileInput.click();
importFileInput.onchange = () => {
  const file = importFileInput.files?.[0];
  if (file) importJson(file);
};

tilesetSelect.addEventListener("change", () => loadTileset());

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
    renderMap();
  })
);

const autoBtn = document.createElement("button");
autoBtn.textContent = "Use Auto Palette";
autoBtn.onclick = () => setTileMode("auto");
const gridBtn = document.createElement("button");
gridBtn.textContent = "Use Grid Palette";
gridBtn.onclick = () => setTileMode("grid");

const panel = document.querySelector(".panel");
if (panel) {
  const wrap = document.createElement("div");
  wrap.className = "toolbar";
  wrap.append(autoBtn, gridBtn);
  panel.insertBefore(wrap, panel.querySelector(".status"));
}

setTool("paint");
ensureMapSize();
loadTileset();
renderMap();
