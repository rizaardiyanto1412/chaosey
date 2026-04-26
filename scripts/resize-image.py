#!/usr/bin/env python3
import argparse
from pathlib import Path

from PIL import Image

RESAMPLING = {
    "nearest": Image.Resampling.NEAREST,
    "box": Image.Resampling.BOX,
    "bilinear": Image.Resampling.BILINEAR,
    "bicubic": Image.Resampling.BICUBIC,
    "lanczos": Image.Resampling.LANCZOS,
}


def parse_args():
    parser = argparse.ArgumentParser(description="Resize an image by a scale factor.")
    parser.add_argument("input", type=Path)
    parser.add_argument("-o", "--output", type=Path)
    parser.add_argument("--scale", type=float, default=2.0)
    parser.add_argument("--resample", choices=RESAMPLING.keys(), default="lanczos")
    return parser.parse_args()


def main():
    args = parse_args()
    image = Image.open(args.input)
    width, height = image.size
    new_size = (round(width * args.scale), round(height * args.scale))
    output = args.output or args.input.with_name(f"{args.input.stem}_{args.scale:g}x{args.input.suffix}")

    resized = image.resize(new_size, RESAMPLING[args.resample])
    resized.save(output)

    print(f"Input: {args.input}")
    print(f"Output: {output}")
    print(f"Original size: {width}x{height}")
    print(f"New size: {new_size[0]}x{new_size[1]}")
    print(f"Resample: {args.resample}")


if __name__ == "__main__":
    main()
