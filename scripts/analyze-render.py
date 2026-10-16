"""Measure whether the theme background actually reaches the screen.

The model cannot see images, so "does it look right" has to become a number. A
painted background is a smooth colour field: the pixel evidence is a *spatial
gradient* that a flat token fill cannot produce. So this script reports

  spread   -- per-region max-min across channels; a flat fill is ~0, artwork is not
  gradient -- difference between the left and right halves of a region, which is
              what a colour field that brightens toward the content side looks like

and a coarse colour grid, which doubles as a map of where things are on screen.

Usage: python scripts/analyze-render.py <png> [rows] [cols]
"""
import sys
from pathlib import Path

from PIL import Image


def region_stats(image, box):
    """Mean colour plus spread inside a box. Spread is the tell for real artwork."""
    crop = image.crop(box).convert('RGB')
    pixels = list(crop.getdata())
    count = len(pixels)
    mean = tuple(sum(p[i] for p in pixels) // count for i in range(3))
    spread = tuple(max(p[i] for p in pixels) - min(p[i] for p in pixels) for i in range(3))
    return mean, spread


def main():
    if len(sys.argv) < 2:
        print('usage: python scripts/analyze-render.py <png> [rows] [cols]')
        return 2
    path = Path(sys.argv[1])
    if not path.exists():
        print(f'missing {path}')
        return 2
    rows = int(sys.argv[2]) if len(sys.argv) > 2 else 6
    cols = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    with Image.open(path) as raw:
        image = raw.convert('RGB')
    width, height = image.size
    print(f'{path.name}  {width}x{height}')

    print('\n=== coarse colour grid (mean RGB per cell) ===')
    for row in range(rows):
        top = row * height // rows
        bottom = (row + 1) * height // rows
        cells = []
        for col in range(cols):
            left = col * width // cols
            right = (col + 1) * width // cols
            mean, _ = region_stats(image, (left, top, right, bottom))
            cells.append(f'{mean[0]:3d},{mean[1]:3d},{mean[2]:3d}')
        print(f'  y{top:4d}-{bottom:4d}  ' + ' | '.join(cells))

    print('\n=== named regions ===')
    regions = {
        'far-left strip (sidebar edge)': (0, height // 4, max(4, width // 40), 3 * height // 4),
        'left third': (0, 0, width // 3, height),
        'middle third': (width // 3, 0, 2 * width // 3, height),
        'right third': (2 * width // 3, 0, width, height),
        'top bar': (0, 0, width, max(4, height // 20)),
        'bottom strip': (0, height - max(4, height // 20), width, height),
    }
    for name, box in regions.items():
        mean, spread = region_stats(image, box)
        crop = image.crop(box).convert('RGB')
        half = crop.width // 2
        left_mean, _ = region_stats(crop, (0, 0, half, crop.height))
        right_mean, _ = region_stats(crop, (half, 0, crop.width, crop.height))
        lr = tuple(abs(right_mean[i] - left_mean[i]) for i in range(3))
        verdict = 'ARTWORK' if max(spread) > 24 else ('flat fill' if max(spread) < 8 else 'textured')
        print(f'  {name:32s} mean={mean} spread={spread} L->R={lr}  {verdict}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
