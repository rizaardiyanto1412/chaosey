"use strict";
const LOCAL_KEY = "wasd_map_editor_document_v1";
const tilesetSelect = document.getElementById("tilesetSelect");
const tileWInput = document.getElementById("tileW");
const tileHInput = document.getElementById("tileH");
const spacingXInput = document.getElementById("spacingX");
const spacingYInput = document.getElementById("spacingY");
const offsetXInput = document.getElementById("offsetX");
const offsetYInput = document.getElementById("offsetY");
const mapColsInput = document.getElementById("mapCols");
const mapRowsInput = document.getElementById("mapRows");
const cellSizeInput = document.getElementById("cellSize");
const zoomInput = document.getElementById("zoom");
const paintBtn = document.getElementById("paintBtn");
const eraseBtn = document.getElementById("eraseBtn");
const newMapBtn = document.getElementById("newMapBtn");
const clearBtn = document.getElementById("clearBtn");
const saveLocalBtn = document.getElementById("saveLocalBtn");
const loadLocalBtn = document.getElementById("loadLocalBtn");
const downloadBtn = document.getElementById("downloadBtn");
const importBtn = document.getElementById("importBtn");
const importFileInput = document.getElementById("importFile");
const statusEl = document.getElementById("status");
const paletteCanvas = document.getElementById("palette");
const mapCanvas = document.getElementById("map");
const paletteCtx = paletteCanvas.getContext("2d");
const mapCtx = mapCanvas.getContext("2d");
const tilesetImage = new Image();
tilesetImage.decoding = "async";
tilesetImage.onload = () => {
    renderPalette();
    renderMap();
    setStatus(`Tileset loaded: ${tilesetImage.width}x${tilesetImage.height}`);
};
tilesetImage.onerror = () => {
    setStatus("Failed to load tileset.");
};
let mapTiles = [];
let selectedTileIndex = 0;
let tool = "paint";
let drawing = false;
let paletteDraw = {
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    scale: 1
};
function n(input) {
    return Number(input.value || "0");
}
function atlasConfig() {
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
function atlasGridSize(config = atlasConfig()) {
    if (!tilesetImage.width || !tilesetImage.height) {
        return { cols: 0, rows: 0, count: 0 };
    }
    const cols = Math.floor((tilesetImage.width - config.offsetX + config.spacingX) / (config.tileW + config.spacingX));
    const rows = Math.floor((tilesetImage.height - config.offsetY + config.spacingY) / (config.tileH + config.spacingY));
    return {
        cols: Math.max(0, cols),
        rows: Math.max(0, rows),
        count: Math.max(0, cols * rows)
    };
}
function srcRectForTile(index, config = atlasConfig()) {
    const grid = atlasGridSize(config);
    if (grid.cols <= 0) {
        return { sx: 0, sy: 0, sw: 0, sh: 0 };
    }
    const col = index % grid.cols;
    const row = Math.floor(index / grid.cols);
    return {
        sx: config.offsetX + col * (config.tileW + config.spacingX),
        sy: config.offsetY + row * (config.tileH + config.spacingY),
        sw: config.tileW,
        sh: config.tileH
    };
}
function ensureMapSize() {
    const { cols, rows } = mapConfig();
    const required = cols * rows;
    if (mapTiles.length === required)
        return;
    const next = new Array(required).fill(-1);
    for (let i = 0; i < Math.min(required, mapTiles.length); i += 1) {
        next[i] = mapTiles[i];
    }
    mapTiles = next;
}
function clearMap() {
    mapTiles.fill(-1);
    renderMap();
    setStatus("Map cleared.");
}
function setTool(next) {
    tool = next;
    paintBtn.classList.toggle("primary", next === "paint");
    eraseBtn.classList.toggle("primary", next === "erase");
}
function setStatus(message) {
    statusEl.textContent = message;
}
function renderPalette() {
    const config = atlasConfig();
    const grid = atlasGridSize(config);
    paletteCtx.clearRect(0, 0, paletteCanvas.width, paletteCanvas.height);
    if (!tilesetImage.width || grid.count === 0)
        return;
    const maxW = paletteCanvas.width - 8;
    const maxH = paletteCanvas.height - 8;
    const scale = Math.min(maxW / tilesetImage.width, maxH / tilesetImage.height);
    const drawW = Math.max(1, Math.floor(tilesetImage.width * scale));
    const drawH = Math.max(1, Math.floor(tilesetImage.height * scale));
    const drawX = Math.floor((paletteCanvas.width - drawW) / 2);
    const drawY = Math.floor((paletteCanvas.height - drawH) / 2);
    paletteDraw = { x: drawX, y: drawY, w: drawW, h: drawH, scale };
    paletteCtx.imageSmoothingEnabled = false;
    paletteCtx.drawImage(tilesetImage, drawX, drawY, drawW, drawH);
    if (selectedTileIndex >= 0) {
        const rect = srcRectForTile(selectedTileIndex, config);
        const x = drawX + Math.floor(rect.sx * scale);
        const y = drawY + Math.floor(rect.sy * scale);
        const w = Math.max(1, Math.floor(rect.sw * scale));
        const h = Math.max(1, Math.floor(rect.sh * scale));
        paletteCtx.strokeStyle = "#34d399";
        paletteCtx.lineWidth = 2;
        paletteCtx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    setStatus(`Tiles: ${grid.count} (${grid.cols}x${grid.rows}). Selected: ${selectedTileIndex}`);
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
    const config = atlasConfig();
    for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
            const mapIndex = row * cols + col;
            const tileIndex = mapTiles[mapIndex];
            const dx = col * displaySize;
            const dy = row * displaySize;
            if (tileIndex >= 0 && tilesetImage.width) {
                const rect = srcRectForTile(tileIndex, config);
                mapCtx.drawImage(tilesetImage, rect.sx, rect.sy, rect.sw, rect.sh, dx, dy, displaySize, displaySize);
            }
            mapCtx.strokeStyle = "rgba(143, 163, 191, 0.25)";
            mapCtx.lineWidth = 1;
            mapCtx.strokeRect(dx + 0.5, dy + 0.5, displaySize, displaySize);
        }
    }
}
function mapCellFromPointer(event) {
    const { cols, rows, cellSize, zoom } = mapConfig();
    const displaySize = Math.max(2, Math.floor(cellSize * zoom));
    const rect = mapCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const col = Math.floor(x / displaySize);
    const row = Math.floor(y / displaySize);
    if (col < 0 || row < 0 || col >= cols || row >= rows) {
        return null;
    }
    return { col, row, index: row * cols + col };
}
function applyAtPointer(event) {
    const cell = mapCellFromPointer(event);
    if (!cell)
        return;
    mapTiles[cell.index] = tool === "paint" ? selectedTileIndex : -1;
    renderMap();
}
function buildDocument() {
    ensureMapSize();
    const { cols, rows, cellSize } = mapConfig();
    return {
        version: 1,
        tilesetSrc: tilesetSelect.value,
        atlas: atlasConfig(),
        map: {
            cols,
            rows,
            cellSize,
            tiles: [...mapTiles]
        }
    };
}
function applyDocument(doc) {
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
    mapTiles = [...doc.map.tiles];
    selectedTileIndex = 0;
    loadTileset();
    renderMap();
}
function saveLocal() {
    const payload = buildDocument();
    localStorage.setItem(LOCAL_KEY, JSON.stringify(payload));
    setStatus("Saved to local storage.");
}
function loadLocal() {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) {
        setStatus("No local map found.");
        return;
    }
    try {
        const parsed = JSON.parse(raw);
        applyDocument(parsed);
        setStatus("Loaded from local storage.");
    }
    catch {
        setStatus("Failed to parse local map.");
    }
}
function downloadJson() {
    const payload = buildDocument();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "wasd-map.json";
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Map JSON downloaded.");
}
function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const parsed = JSON.parse(String(reader.result));
            applyDocument(parsed);
            setStatus("Map JSON imported.");
        }
        catch {
            setStatus("Import failed: invalid JSON.");
        }
    };
    reader.readAsText(file);
}
function loadTileset() {
    tilesetImage.src = tilesetSelect.value;
}
function onAtlasChanged() {
    selectedTileIndex = 0;
    renderPalette();
    renderMap();
}
paletteCanvas.addEventListener("click", (event) => {
    if (!tilesetImage.width)
        return;
    const rect = paletteCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < paletteDraw.x ||
        y < paletteDraw.y ||
        x > paletteDraw.x + paletteDraw.w ||
        y > paletteDraw.y + paletteDraw.h) {
        return;
    }
    const imageX = (x - paletteDraw.x) / paletteDraw.scale;
    const imageY = (y - paletteDraw.y) / paletteDraw.scale;
    const cfg = atlasConfig();
    const grid = atlasGridSize(cfg);
    const tx = Math.floor((imageX - cfg.offsetX) / (cfg.tileW + cfg.spacingX));
    const ty = Math.floor((imageY - cfg.offsetY) / (cfg.tileH + cfg.spacingY));
    if (tx < 0 || ty < 0 || tx >= grid.cols || ty >= grid.rows)
        return;
    selectedTileIndex = ty * grid.cols + tx;
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
    if (!drawing)
        return;
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
clearBtn.onclick = () => clearMap();
saveLocalBtn.onclick = () => saveLocal();
loadLocalBtn.onclick = () => loadLocal();
downloadBtn.onclick = () => downloadJson();
importBtn.onclick = () => importFileInput.click();
importFileInput.onchange = () => {
    const file = importFileInput.files?.[0];
    if (file) {
        importJson(file);
    }
};
[
    tilesetSelect,
    tileWInput,
    tileHInput,
    spacingXInput,
    spacingYInput,
    offsetXInput,
    offsetYInput
].forEach((el) => el.addEventListener("change", onAtlasChanged));
[mapColsInput, mapRowsInput, cellSizeInput, zoomInput].forEach((el) => el.addEventListener("change", () => {
    ensureMapSize();
    renderMap();
}));
setTool("paint");
ensureMapSize();
loadTileset();
renderMap();
