#!/usr/bin/env python3
import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


def parse_args():
    parser = argparse.ArgumentParser(description="Remove a solid-color image background and save a transparent PNG.")
    parser.add_argument("input", type=Path)
    parser.add_argument("-o", "--output", type=Path)
    parser.add_argument("--tolerance", type=float, default=42.0)
    parser.add_argument("--max-channel-diff", type=int, default=36)
    parser.add_argument("--all-matching", action="store_true")
    return parser.parse_args()


def flood_fill_edge_mask(candidate):
    h, w = candidate.shape
    visited = np.zeros((h, w), dtype=bool)
    q = deque()

    for x in range(w):
        for y in (0, h - 1):
            if candidate[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((y, x))

    for y in range(h):
        for x in (0, w - 1):
            if candidate[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((y, x))

    while q:
        y, x = q.popleft()
        for ny in (y - 1, y, y + 1):
            for nx in (x - 1, x, x + 1):
                if ny == y and nx == x:
                    continue
                if 0 <= ny < h and 0 <= nx < w and candidate[ny, nx] and not visited[ny, nx]:
                    visited[ny, nx] = True
                    q.append((ny, nx))

    return visited


def main():
    args = parse_args()
    output = args.output or args.input.with_name(f"{args.input.stem}_transparent.png")

    image = Image.open(args.input).convert("RGBA")
    pixels = np.array(image)
    rgb = pixels[:, :, :3].astype(np.int32)

    edge = np.concatenate([rgb[0, :, :], rgb[-1, :, :], rgb[:, 0, :], rgb[:, -1, :]], axis=0)
    background = np.median(edge, axis=0).astype(np.int32)

    channel_diff = np.abs(rgb - background)
    distance = np.sqrt(((rgb - background) ** 2).sum(axis=2))
    candidate = (distance <= args.tolerance) & (channel_diff.max(axis=2) <= args.max_channel_diff)
    mask = candidate if args.all_matching else flood_fill_edge_mask(candidate)

    pixels[:, :, 3] = np.where(mask, 0, 255).astype(np.uint8)
    Image.fromarray(pixels).save(output)

    print(f"Input: {args.input}")
    print(f"Output: {output}")
    print(f"Sampled background RGB: {tuple(int(x) for x in background)}")
    print(f"Transparent pixels: {int(mask.sum())}")


if __name__ == "__main__":
    main()
