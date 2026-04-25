#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LEVELS_DIR="$REPO_ROOT/apps/client/public/maps/levels"

printf 'Target level number (1-20): '
IFS= read -r LEVEL_NUMBER

LEVEL_NUMBER="${LEVEL_NUMBER//[[:space:]]/}"
LEVEL_NUMBER="${LEVEL_NUMBER#level-}"
LEVEL_NUMBER="${LEVEL_NUMBER#level}"

if [[ ! "$LEVEL_NUMBER" =~ ^[0-9]+$ ]]; then
  echo 'Level must be a number from 1 to 20.' >&2
  exit 1
fi

LEVEL_INT=$((10#$LEVEL_NUMBER))
if (( LEVEL_INT < 1 || LEVEL_INT > 20 )); then
  echo 'Level must be between 1 and 20.' >&2
  exit 1
fi

LEVEL_ID="$(printf 'level-%02d' "$LEVEL_INT")"
OUTPUT_DIR="$LEVELS_DIR/$LEVEL_ID"

printf 'SpriteFusion export folder path: '
IFS= read -r INPUT_DIR

# Allow users to drag a folder into Terminal, which may wrap the path in quotes.
INPUT_DIR="${INPUT_DIR%\"}"
INPUT_DIR="${INPUT_DIR#\"}"
INPUT_DIR="${INPUT_DIR%\'}"
INPUT_DIR="${INPUT_DIR#\'}"

if [[ -z "$INPUT_DIR" ]]; then
  echo 'No path entered.' >&2
  exit 1
fi

if [[ ! -d "$INPUT_DIR" ]]; then
  echo "Folder does not exist: $INPUT_DIR" >&2
  exit 1
fi

if [[ ! -f "$INPUT_DIR/map.json" ]]; then
  echo "Missing map.json in: $INPUT_DIR" >&2
  exit 1
fi

if [[ ! -f "$INPUT_DIR/spritesheet.png" ]]; then
  echo "Missing spritesheet.png in: $INPUT_DIR" >&2
  exit 1
fi

echo "Writing compacted map to: $OUTPUT_DIR"
node "$SCRIPT_DIR/compact-spritefusion-map.js" "$INPUT_DIR" "$OUTPUT_DIR" --pretty

echo "$LEVEL_ID updated."
