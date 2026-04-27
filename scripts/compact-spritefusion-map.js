#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
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

function readPngChunks(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== signature) {
    throw new Error('Tilesheet must be a PNG image');
  }

  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
    if (type === 'IEND') break;
  }

  return chunks;
}

function paethPredictor(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

function decodePngRgba(filePath) {
  const chunks = readPngChunks(fs.readFileSync(filePath));
  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR')?.data;
  if (!ihdr) throw new Error('PNG is missing IHDR');

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const compression = ihdr[10];
  const filter = ihdr[11];
  const interlace = ihdr[12];

  if (bitDepth !== 8 || compression !== 0 || filter !== 0 || interlace !== 0) {
    throw new Error('Only non-interlaced 8-bit PNG tilesheets are supported');
  }
  if (colorType !== 2 && colorType !== 6) {
    throw new Error('Only RGB and RGBA PNG tilesheets are supported');
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data)));
  const rgba = new Uint8ClampedArray(width * height * 4);
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  let inputOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filterType = inflated[inputOffset];
    inputOffset += 1;
    inflated.copy(current, 0, inputOffset, inputOffset + stride);
    inputOffset += stride;

    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      if (filterType === 1) current[x] = (current[x] + left) & 0xff;
      else if (filterType === 2) current[x] = (current[x] + up) & 0xff;
      else if (filterType === 3) current[x] = (current[x] + Math.floor((left + up) / 2)) & 0xff;
      else if (filterType === 4) current[x] = (current[x] + paethPredictor(left, up, upLeft)) & 0xff;
      else if (filterType !== 0) throw new Error(`Unsupported PNG filter: ${filterType}`);
    }

    for (let x = 0; x < width; x += 1) {
      const sourceOffset = x * channels;
      const targetOffset = (y * width + x) * 4;
      rgba[targetOffset] = current[sourceOffset];
      rgba[targetOffset + 1] = current[sourceOffset + 1];
      rgba[targetOffset + 2] = current[sourceOffset + 2];
      rgba[targetOffset + 3] = channels === 4 ? current[sourceOffset + 3] : 255;
    }

    current.copy(previous);
  }

  return { width, height, data: rgba };
}

async function loadTilesheet(filePath) {
  try {
    return { type: 'canvas', image: await loadImage(filePath) };
  } catch (error) {
    return { type: 'pixels', image: decodePngRgba(filePath) };
  }
}

function copyTilePixels(source, target, sourceRect, targetRect) {
  for (let y = 0; y < sourceRect.height; y += 1) {
    const sourceOffset = ((sourceRect.y + y) * source.width + sourceRect.x) * 4;
    const targetOffset = ((targetRect.y + y) * target.width + targetRect.x) * 4;
    target.data.set(source.data.subarray(sourceOffset, sourceOffset + sourceRect.width * 4), targetOffset);
  }
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

  const source = await loadTilesheet(inputImagePath);
  const columns = chooseColumns(usedGids.length, tileWidth, options.columns);
  const rows = Math.ceil(usedGids.length / columns);
  const outputWidth = columns * tileWidth;
  const outputHeight = rows * tileHeight;
  const canvas = createCanvas(outputWidth, outputHeight);
  const ctx = canvas.getContext('2d');
  const outputImage = source.type === 'pixels' ? ctx.createImageData(outputWidth, outputHeight) : null;
  const gidMap = new Map();

  usedGids.forEach((oldGid, index) => {
    const oldTile = oldGid - tileset.firstgid;
    const sx = (oldTile % sourceColumns) * tileWidth + (tileset.margin ?? 0);
    const sy = Math.floor(oldTile / sourceColumns) * tileHeight + (tileset.margin ?? 0);
    const dx = (index % columns) * tileWidth;
    const dy = Math.floor(index / columns) * tileHeight;
    if (source.type === 'pixels') {
      copyTilePixels(
        source.image,
        outputImage,
        { x: sx, y: sy, width: tileWidth, height: tileHeight },
        { x: dx, y: dy }
      );
    } else {
      ctx.drawImage(source.image, sx, sy, tileWidth, tileHeight, dx, dy, tileWidth, tileHeight);
    }
    gidMap.set(oldGid, tileset.firstgid + index);
  });

  if (outputImage) ctx.putImageData(outputImage, 0, 0);

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
    oldImage: `${source.image.width}x${source.image.height}`,
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
