#!/usr/bin/env python3
"""Bake the «Трата» favicons and app icons into apps/web/public.

The mark is drawn on its own pixel grid (16 / 48) and scaled by whole pixels where
the size allows, so edges stay crisp. Raster icons sit on the site paper (#1c1b22)
because a PNG/ICO cannot follow the browser theme; favicon.svg does that itself.

    python3 design/brand/app-icons.py
"""
from __future__ import annotations

import io
import struct
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps" / "web" / "public"

PAPER = (0x1C, 0x1B, 0x22, 255)
INK = (255, 255, 255, 255)
NEW = (0xFF, 0x6A, 0x2B, 255)

# Grids: (spent outer, spent inner, new box), each as (x0, y0, x1, y1) in grid units.
GRID16 = ((1, 1, 10, 10), (3, 3, 8, 8), (7, 7, 15, 15))
GRID48 = ((4, 4, 30, 30), (9, 9, 25, 25), (20, 20, 44, 44))


def draw_mark(img: Image.Image, grid, unit: float, ox: float, oy: float) -> None:
    d = ImageDraw.Draw(img)
    (a, b, new) = grid

    def box(r, fill):
        x0, y0, x1, y1 = r
        d.rectangle(
            (round(ox + x0 * unit), round(oy + y0 * unit), round(ox + x1 * unit) - 1, round(oy + y1 * unit) - 1),
            fill=fill,
        )

    box(a, INK)
    box(b, PAPER)
    box(new, NEW)


def tile(size: int, grid, unit: float, mark_span: tuple[int, int], ss: int = 1) -> Image.Image:
    """Paper square with the mark centred. `ss` supersamples for non-integer units."""
    big = size * ss
    img = Image.new("RGBA", (big, big), PAPER)
    lo, hi = mark_span
    span = (hi - lo) * unit * ss
    off = (big - span) / 2 - lo * unit * ss
    draw_mark(img, grid, unit * ss, off, off)
    if ss > 1:
        img = img.resize((size, size), Image.LANCZOS)
    return img


def favicon(size: int) -> Image.Image:
    if size == 16:
        return tile(16, GRID16, 1, (1, 15))
    if size == 32:
        return tile(32, GRID16, 2, (1, 15))
    return tile(48, GRID48, 1, (4, 44))


def write_ico(path: Path, images: list[Image.Image]) -> None:
    """ICO with PNG payloads (every browser since 2010 reads these)."""
    blobs = []
    for im in images:
        buf = io.BytesIO()
        im.save(buf, "PNG", optimize=True)
        blobs.append(buf.getvalue())
    head = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = b""
    for im, blob in zip(images, blobs):
        w, h = im.size
        entries += struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
    path.write_bytes(head + entries + b"".join(blobs))


FAVICON_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">'
    "<style>.ink{fill:#1c1b22}@media (prefers-color-scheme: dark){.ink{fill:#ffffff}}</style>"
    '<path class="ink" fill-rule="evenodd" d="M1 1h9v9H1zM3 3v5h5V3z"/>'
    '<rect x="7" y="7" width="8" height="8" fill="#ff6a2b"/>'
    "</svg>\n"
)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "favicon.svg").write_text(FAVICON_SVG)
    write_ico(OUT / "favicon.ico", [favicon(16), favicon(32), favicon(48)])
    favicon(32).save(OUT / "icon.png", optimize=True)
    # Home screen: iOS rounds the corners itself, so the square stays full bleed.
    tile(180, GRID48, 2.5, (4, 44), ss=4).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
    # "any": 280 px mark. "maskable": 240 px, its corners stay inside the 80 % safe circle.
    tile(512, GRID48, 7, (4, 44)).save(OUT / "icon-512.png", optimize=True)
    tile(512, GRID48, 6, (4, 44)).save(OUT / "icon-512-maskable.png", optimize=True)
    tile(192, GRID48, 2.6, (4, 44), ss=4).save(OUT / "icon-192.png", optimize=True)
    for name in ("favicon.svg", "favicon.ico", "icon.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-512-maskable.png"):
        print(name, (OUT / name).stat().st_size, "bytes")


if __name__ == "__main__":
    main()
