"""One image file → a small webp. First frame only."""
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src)
im.seek(0)
if getattr(im, "is_animated", False):
    im.seek(0)
if im.mode not in ("RGB", "RGBA"):
    im = im.convert("RGBA")
im.thumbnail((480, 480), Image.Resampling.LANCZOS)
im.save(dst, "WEBP", quality=72, method=4)
