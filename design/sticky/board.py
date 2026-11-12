"""Compose PNG boards for Telegram: a title, a caption, then rows of labelled crops.

python3 design/sticky/board.py spec.json
spec: {"out": path, "title": str, "caption": str, "width": px,
       "rows": [[{"src": path, "crop": [l, t, r, b] | null, "label": str,
                  "marks": [[l, t, r, b, "1"], ...]  # crop coords, before scaling
                 }, ...], ...]}
Each row's cells share the row height; cells scale to fit the board width.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

FONTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../apps/web/assets/og-fonts")
BG = (14, 14, 14)
INK = (255, 255, 255)
MUTED = (163, 163, 163)
MARK = (255, 84, 104)


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def wrap(draw, text, f, width):
    lines = []
    for para in text.split("\n"):
        cur = ""
        for word in para.split(" "):
            test = (cur + " " + word).strip()
            if draw.textlength(test, font=f) > width and cur:
                lines.append(cur)
                cur = word
            else:
                cur = test
        lines.append(cur)
    return lines


def main():
    spec = json.load(open(sys.argv[1]))
    W = spec.get("width", 2400)
    pad, gap = 48, 28
    title_f = font("IBMPlexSans-SemiBold.ttf", 44)
    cap_f = font("IBMPlexSans-Regular.ttf", 26)
    lab_f = font("IBMPlexSans-SemiBold.ttf", 26)
    num_f = font("IBMPlexMono-SemiBold.ttf", 22)
    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    cap_lines = wrap(probe, spec.get("caption", ""), cap_f, W - 2 * pad) if spec.get("caption") else []
    rows = []
    for row in spec["rows"]:
        cells = []
        for c in row:
            im = Image.open(c["src"]).convert("RGB")
            if c.get("crop"):
                im = im.crop(tuple(c["crop"]))
            cells.append((im, c))
        avail = W - 2 * pad - gap * (len(cells) - 1)
        # common height so that widths sum to avail
        ratio = sum(im.width / im.height for im, _ in cells)
        h = int(avail / ratio)
        if spec.get("max_row_h"):
            h = min(h, spec["max_row_h"])
        rows.append((cells, h))
    head = pad + 56 + len(cap_lines) * 36 + (20 if cap_lines else 0)
    total = head + sum(h + 46 + gap for _, h in rows) + pad
    board = Image.new("RGB", (W, total), BG)
    d = ImageDraw.Draw(board)
    d.text((pad, pad), spec.get("title", ""), font=title_f, fill=INK)
    y = pad + 66
    for line in cap_lines:
        d.text((pad, y), line, font=cap_f, fill=MUTED)
        y += 36
    y = head
    for cells, h in rows:
        x = pad
        for im, c in cells:
            w = int(im.width * h / im.height)
            k = h / im.height
            board.paste(im.resize((w, h), Image.LANCZOS), (x, y + 40))
            d.text((x, y), c.get("label", ""), font=lab_f, fill=INK)
            for l, t, r, b, n in c.get("marks", []):
                box = [x + l * k, y + 40 + t * k, x + r * k, y + 40 + b * k]
                d.rectangle(box, outline=MARK, width=3)
                tx, ty = box[0] + 4, box[1] + 4
                d.rectangle([tx - 2, ty - 2, tx + 30, ty + 28], fill=MARK)
                d.text((tx + 6, ty), n, font=num_f, fill=(14, 14, 14))
            x += w + gap
        y += h + 46 + gap
    board.save(spec["out"], optimize=True)
    print(spec["out"], board.size)


main()
