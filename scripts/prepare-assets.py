"""One-time asset preparation for the built-in theme backgrounds.

The image generator returns large PNGs (1672x941, several MB each), which are far
too heavy to inline into a client bundle. This crops them to the target aspect,
resizes, and writes progressive JPEGs into `assets/`. The JPEGs are the canonical
committed assets; `scripts/embed-assets.mjs` turns them into `src/assets.js`.

Re-run only when the artwork changes:

    <bundled python> scripts/prepare-assets.py
"""
from pathlib import Path
import json
import sys

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets"
TARGET = (1600, 900)
# Smooth gradients are where JPEG shows banding, so quality is pushed well above the
# usual web setting. These images carry almost no high-frequency detail, so they
# still compress hard: the whole set lands far below a photographic equivalent.
QUALITY = 82

# Artwork from the image generator, one per theme *per colour scheme*. The file name
# is `<theme>-<scheme>.jpg`, which is the whole lookup key the runtime uses.
#
# Generation history, because it explains the shape of this table:
#
#   1. The first pass produced six photographic scenes (a misty forest with a moon,
#      bokeh, frost on branches). All rejected: a scene brings a focal point and
#      high-frequency detail, and a focal point competes with the interface on top.
#   2. The second pass replaced them with abstract colour fields, but only one image
#      per theme. That was the real design error: a theme's artwork was drawn for one
#      scheme and *washed* into the other with a scrim, so all four dark themes
#      collapsed into the same pale blue-grey wash under a light interface and every
#      theme lost its identity. A scrim can lift a dark image, but it cannot invent
#      structure that was never there.
#   3. This pass draws the missing counterpart for all six themes. Same composition
#      rule (quiet on the left where the sidebar is, luminous on the right where the
#      content is) and the same hue family, but a genuine high-key or low-key
#      composition rather than a veil over the other one. With a pair in place, the
#      automatic scrim computes zero for every built-in theme and goes back to being
#      what it was always meant to be: a safety net for a single image the user
#      supplied themselves.
SOURCES = {
    "abyss-dark": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-11371dc2.png",
    "abyss-light": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-7e4a2ff2.png",
    "ink-light": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-7a3da753.png",
    "ink-dark": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-18a31da6.png",
    "pine-dark": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-299453ad.png",
    "pine-light": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-0eaeed70.png",
    "aurora-dark": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-87c5e178.png",
    "aurora-light": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-5e012527.png",
    "ember-dark": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-3acbd534.png",
    "ember-light": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-ee72d8ab.png",
    "frost-light": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-ada411e9.png",
    "frost-dark": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-b268af9e.png",
    # The illustrated family. Same pairing rule, different art language: a soft
    # hand-painted watercolour scene rather than a pure colour field. A subject is
    # allowed here because the doctrine was never "no focal point" — it is "no large
    # high-contrast structure where the interface puts text". What decides legibility
    # is the *tail* of the lightness distribution, and a small subject, a few stars or
    # a handful of fireflies cannot move a 5th percentile. So each scene keeps the
    # subject in the lower-right third, leaves the left half and the centre as an
    # almost empty wash, and confines its bright or dark accents to well under 5% of
    # the frame. Day and night versions of the same scene, so the pair is a mood
    # change rather than a wash.
    "cat-light": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-577994c8.png",
    "cat-dark": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-8beb1af2.png",
    "hills-light": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-1c631a1f.png",
    "hills-dark": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-ec30beaf.png",
    "sea-light": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-c7584216.png",
    "sea-dark": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-5f3fc6f1.png",
    "bloom-light": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-49d4fc44.png",
    "bloom-dark": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-4b36b22e.png",
    "piano-light": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-4b4ea232.png",
    "piano-dark": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-9af9ddf2.png",
    "nebula-light": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-f629f60c.png",
    "nebula-dark": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-d4de5743.png",
    "reading-light": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-d551e364.png",
    "reading-dark": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-0c8523d8.png",
    "neon-light": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-3f7183e3.png",
    "neon-dark": r"D:\Jewei\workspace\dsh-create-workspace\dsh-image-gen\image-4beb5dfc.png",
}


def crop_to_aspect(image: Image.Image, target: tuple[int, int]) -> Image.Image:
    """Centre-crop to the target aspect ratio without distorting the artwork."""
    width, height = image.size
    wanted = target[0] / target[1]
    if width / height > wanted:
        keep = round(height * wanted)
        left = (width - keep) // 2
        return image.crop((left, 0, left + keep, height))
    keep = round(width / wanted)
    top = (height - keep) // 2
    return image.crop((0, top, width, top + keep))


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    measured = {}
    for name, source in SOURCES.items():
        path = Path(source)
        if not path.exists():
            print(f"MISSING {name}: {path}")
            return 1
        with Image.open(path) as image:
            prepared = crop_to_aspect(image.convert("RGB"), TARGET)
            prepared = prepared.resize(TARGET, Image.LANCZOS)
            target = OUT / f"{name}.jpg"
            prepared.save(target, "JPEG", quality=QUALITY, optimize=True, progressive=True)
            # Lightness of the artwork that actually ships, measured after the transform
            # above. The runtime cannot read a pixel of a `data:` URL, so this is the only
            # way it can know how a backdrop sits against each scheme's own text.
            #
            # The mean alone is not enough. Legibility is decided by the extreme the text
            # has to survive: under a light interface the label is near-black, so the
            # *darkest* region of the artwork is what can swallow it, and under a dark
            # interface the lightest region is. p05/p95 rather than min/max so that a
            # handful of stray pixels cannot fail a build, but the tail is still covered.
            grey = prepared.convert("L").resize((320, 180))
            hist = grey.histogram()
            count = sum(hist)

            def percentile(fraction: float) -> int:
                """Lightness at `fraction` of the distribution, walked off the histogram."""
                target_count = count * fraction
                running = 0
                for value, seen in enumerate(hist):
                    running += seen
                    if running >= target_count:
                        return value
                return 255

            measured[name] = {
                "mean": round(sum(value * seen for value, seen in enumerate(hist)) / count / 255, 4),
                "p05": round(percentile(0.05) / 255, 4),
                "p95": round(percentile(0.95) / 255, 4),
            }
        size = target.stat().st_size
        total += size
        stats = measured[name]
        print(
            f"{name:13s} {size / 1024:7.1f} KB  "
            f"mean {stats['mean']:.4f}  p05 {stats['p05']:.4f}  p95 {stats['p95']:.4f}  ->  {target.name}"
        )
    (OUT / "lightness.json").write_text(json.dumps(measured, indent=2) + "\n", encoding="utf-8")
    print(f"{'total':13s} {total / 1024:7.1f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
