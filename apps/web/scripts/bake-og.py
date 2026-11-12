#!/usr/bin/env python3
"""Bake apps/web/public/og.png — the site-wide share card.

The card is drawn by the app itself (/og/site/card, same satori code and fonts as the
tx / address / token previews), so this only saves it. Start the app first, then:

  python3 apps/web/scripts/bake-og.py [base-url]     # default http://127.0.0.1:4441

Bump DEFAULT_OG_IMAGE (lib/page-meta.ts) and the two refs in app/layout.tsx after a
re-bake, so Telegram and X fetch the new file instead of their cached copy.
"""
from __future__ import annotations

import io
import sys
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "og.png"
W, H = 1200, 630


def main() -> None:
    base = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4441").rstrip("/")
    req = urllib.request.Request(f"{base}/og/site/card", headers={"Accept": "image/png"})
    with urllib.request.urlopen(req, timeout=30) as r:
        if r.headers.get_content_type() != "image/png":
            raise SystemExit(f"expected image/png, got {r.headers.get_content_type()} from {r.geturl()}")
        body = r.read()
    im = Image.open(io.BytesIO(body))
    if im.size != (W, H):
        raise SystemExit(f"expected {W}x{H}, got {im.size[0]}x{im.size[1]}")
    im.convert("RGB").save(OUT, optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
