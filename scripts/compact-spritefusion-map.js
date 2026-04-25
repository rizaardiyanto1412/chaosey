#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const FLIPPED_HORIZONTALLY_FLAG = 0x80000000;
const FLIPPED_VERTICALLY_FLAG = 0x40000000;
const FLIPPED_DIAGONALLY_FLAG = 0x20000000;
const ROTATED_HEXAGONAL_120_FLAG = 0x10000000;
const FLAGS_MASK =
  FLIPPED_HORIZONTALLY_FLAG |
  FLIPPED_VERTICALLY_FLAG |
  FLIPPED_DIAGONALLY_FLAG |
  ROTATED_HEXAGONAL_120_FLAG;
const GID_MASK = ~FLAGS_MASK >>> 0;

function usage() {
  console.log(`Usage:
  node scripts/compact-spritefusion-map.js <input-folder> [output-folder] [options]

Arguments:
  input-folder          Folder containing map.json and spritesheet.png.
  output-folder         Folder to write compacted files. Required unless --in-place is used.

Options:
  --in-place            Overwrite input-folder/map.json and input-folder/spritesheet.png.
  --map <file>          Map JSON filename. Default: map.json.
  --image <file>        Tilesheet filename. Default: spritesheet.png.
  --tileset <name>      Tileset name in the JSON. Default: first tileset that uses --image, otherwise first tileset.
  --columns <number>    Columns in the compacted sheet. Default: auto, capped for 4096px texture width.
  --pretty              Pretty-print output map JSON with 2-space indentation.
  --help                Show this help.

Examples:
  node scripts/compact-spritefusion-map.js "/Users/me/Downloads/mapnew fix" apps/client/public/maps/reference-map
  node scripts/compact-spritefusion-map.js apps/client/public/maps/reference-map --in-place
`);
}

function parseArgs(argv) {
  const positional = [];
  const options = {
    mapFile: 'map.json',
    imageFile: 'spritesheet.png',
    tilesetName: null,
    columns: null,
    inPlace: false,
    pretty: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--in-place') {
      options.inPlace = true;
    } else if (arg === '--pretty') {
      options.pretty = true;
    } else if (arg === '--map') {
      options.mapFile = argv[++i];
    } else if (arg === '--image') {
      options.imageFile = argv[++i];
    } else if (arg === '--tileset') {
      options.tilesetName = argv[++i];
    } else if (arg === '--columns') {
      options.columns = Number(argv[++i]);
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (options.columns !== null && (!Number.isInteger(options.columns) || options.columns < 1)) {
    throw new Error('--columns must be a positive integer');
  }

  return { positional, options };
}

function ensureFile(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Missing file: ${filePath}`);
  }
}

function findTileset(map, imageFile, tilesetName) {
  if (!Array.isArray(map.tilesets) || map.tilesets.length === 0) {
    throw new Error('Map has no tilesets');
  }

  if (tilesetName) {
    const found = map.tilesets.find((tileset) => tileset.name === tilesetName);
    if (!found) throw new Error(`Tileset not found: ${tilesetName}`);
    return found;
  }

  return map.tilesets.find((tileset) => path.basename(tileset.image || '') === imageFile) ?? map.tilesets[0];
}

function collectUsedGids(map, tileset) {
  const start = tileset.firstgid;
  const end = tileset.firstgid + tileset.tilecount - 1;
  const used = new Set();

  for (const layer of map.layers ?? []) {
    if (!Array.isArray(layer.data)) continue;
    for (const raw of layer.data) {
      const gid = raw & GID_MASK;
      if (gid >= start && gid <= end) used.add(gid);
    }
  }

  return [...used].sort((a, b) => a - b);
}

function chooseColumns(tileCount, tileWidth, requestedColumns) {
  if (requestedColumns) return requestedColumns;

  const maxTextureWidth = 4096;
  const maxColumns = Math.max(1, Math.floor(maxTextureWidth / tileWidth));
  const squareishColumns = Math.ceil(Math.sqrt(tileCount));
  return Math.min(maxColumns, Math.max(1, squareishColumns));
}

async function compact({ inputDir, outputDir, options }) {
  const inputMapPath = path.join(inputDir, options.mapFile);
  const inputImagePath = path.join(inputDir, options.imageFile);
  const outputMapPath = path.join(outputDir, options.mapFile);
  const outputImagePath = path.join(outputDir, options.imageFile);

  ensureFile(inputMapPath);
  ensureFile(inputImagePath);

  const map = JSON.parse(fs.readFileSync(inputMapPath, 'utf8'));
  const tileset = findTileset(map, options.imageFile, options.tilesetName);
  const usedGids = collectUsedGids(map, tileset);
  if (usedGids.length === 0) {
    throw new Error(`No used tiles found for tileset ${tileset.name}`);
  }

  const tileWidth = tileset.tilewidth ?? map.tilewidth;
  const tileHeight = tileset.tileheight ?? map.tileheight;
  const sourceColumns = tileset.columns;
  if (!tileWidth || !tileHeight || !sourceColumns) {
    throw new Error('Tileset must include tilewidth, tileheight, and columns');
  }

  const source = await loadImage(inputImagePath);
  const columns = chooseColumns(usedGids.length, tileWidth, options.columns);
  const rows = Math.ceil(usedGids.length / columns);
  const outputWidth = columns * tileWidth;
  const outputHeight = rows * tileHeight;
  const canvas = createCanvas(outputWidth, outputHeight);
  const ctx = canvas.getContext('2d');
  const gidMap = new Map();

  usedGids.forEach((oldGid, index) => {
    const oldTile = oldGid - tileset.firstgid;
    const sx = (oldTile % sourceColumns) * tileWidth + (tileset.margin ?? 0);
    const sy = Math.floor(oldTile / sourceColumns) * tileHeight + (tileset.margin ?? 0);
    const dx = (index % columns) * tileWidth;
    const dy = Math.floor(index / columns) * tileHeight;
    ctx.drawImage(source, sx, sy, tileWidth, tileHeight, dx, dy, tileWidth, tileHeight);
    gidMap.set(oldGid, tileset.firstgid + index);
  });

  for (const layer of map.layers ?? []) {
    if (!Array.isArray(layer.data)) continue;
    layer.data = layer.data.map((raw) => {
      const flags = raw & FLAGS_MASK;
      const gid = raw & GID_MASK;
      if (!gid || !gidMap.has(gid)) return raw;
      return flags | gidMap.get(gid);
    });
  }

  tileset.columns = columns;
  tileset.tilecount = usedGids.length;
  tileset.image = options.imageFile;
  tileset.imagewidth = outputWidth;
  tileset.imageheight = outputHeight;
  tileset.margin = 0;
  tileset.spacing = 0;

  fs.mkdirSync(outputDir, { recursive: true });
  const json = options.pretty ? `${JSON.stringify(map, null, 2)}\n` : `${JSON.stringify(map)}\n`;
  fs.writeFileSync(outputMapPath, json);
  fs.writeFileSync(outputImagePath, canvas.toBuffer('image/png'));

  return {
    tileset: tileset.name,
    usedTiles: usedGids.length,
    oldImage: `${source.width}x${source.height}`,
    newImage: `${outputWidth}x${outputHeight}`,
    columns,
    rows,
    outputDir
  };
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const inputDir = positional[0] ? path.resolve(positional[0]) : null;
  const outputDir = options.inPlace ? inputDir : positional[1] ? path.resolve(positional[1]) : null;

  if (!inputDir || !outputDir || positional.length > 2) {
    usage();
    process.exitCode = 1;
    return;
  }

  const result = await compact({ inputDir, outputDir, options });
  console.log(`Compacted tileset "${result.tileset}"`);
  console.log(`Used tiles: ${result.usedTiles}`);
  console.log(`Image: ${result.oldImage} -> ${result.newImage}`);
  console.log(`Layout: ${result.columns} columns x ${result.rows} rows`);
  console.log(`Output: ${result.outputDir}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
