"""Before/after boards for the shipped rent tiles. Run after impl.py + shoot.mjs.

python3 design/rent-card/impl_boards.py RECTS_DIR [WIDTHS_DIR]
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
BOARD = os.path.join(HERE, "../sticky/board.py")
D = "/root/snap/chromium/common/rent-card"


def rect(rd, name):
    return json.load(open(os.path.join(rd, f"{name}-rect.txt")))


def desk(rd, name):
    l, t, w, h, _ = rect(rd, name)
    return [704, int((t - 74) * 2), 3344, int((t + h + 14) * 2)]


def run(spec):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(spec, f)
    subprocess.run([sys.executable, BOARD, f.name], check=True)
    os.unlink(f.name)


def main():
    rd = sys.argv[1]
    wd = sys.argv[2] if len(sys.argv) > 2 else None
    run({
        "out": f"{D}/impl-board-desk.png",
        "title": "Рента на главной: было / стало · 1771",
        "caption": "Две плитки в том же слоте сетки. «Рента этой эпохи»: сколько, со скольких боксов, сколько осталось; двор и Пиксель как были; "
        "подписанная строка «На очереди». «Токены под угрозой»: итог ≈ $, почему опасно, список по токенам (×N боксов), ≈ $ и «через», ссылка на /rent#danger.",
        "width": 2400,
        "rows": [
            [{"src": f"{D}/impl-before-ru-desk.png", "crop": desk(rd, "impl-before-ru-desk"), "label": "было · RU"}],
            [{"src": f"{D}/impl-after-ru-desk.png", "crop": desk(rd, "impl-after-ru-desk"), "label": "стало · RU"}],
            [{"src": f"{D}/impl-after-en-desk.png", "crop": desk(rd, "impl-after-en-desk"), "label": "стало · EN"}],
        ],
    })
    run({
        "out": f"{D}/impl-board-phone.png",
        "title": "Рента на главной: было / стало · телефон 390×844",
        "caption": "Плитки идут одна под другой. Список на телефоне — до 8 токенов, остальное по ссылке «Все N боксов».",
        "width": 2400,
        "rows": [
            [{"src": f"{D}/impl-before-ru-phone-rent.png", "label": "было · RU"},
             {"src": f"{D}/impl-after-ru-phone-rent.png", "label": "стало · RU, рента"},
             {"src": f"{D}/impl-after-ru-phone-danger.png", "label": "стало · RU, токены"}],
            [{"src": f"{D}/impl-before-en-phone-rent.png", "label": "было · EN"},
             {"src": f"{D}/impl-after-en-phone-rent.png", "label": "стало · EN, рента"},
             {"src": f"{D}/impl-after-en-phone-danger.png", "label": "стало · EN, токены"}],
        ],
    })
    if wd:
        rows = []
        for tag, dpr in (("1280", 1.5), ("1024", 1.0)):
            cells = []
            for when, prefix in (("было", "p"), ("стало", "w")):
                l, t, w, h, _ = json.load(open(os.path.join(wd, f"{prefix}{tag}-rect.txt")))
                cells.append({
                    "src": os.path.join(wd, f"{prefix}{tag}.png"),
                    "crop": [int(l * dpr) - 10, int(t * dpr) - 10, int((l + w) * dpr) + 10, int((t + h) * dpr) + 10],
                    "label": f"{when} · {tag}",
                })
            rows.append(cells)
        run({
            "out": f"{D}/impl-board-widths.png",
            "title": "Узкий слот: 1280 (минимальный ноутбук) и 1024",
            "caption": "Ниже 1280 плитки узкие: колонка ≈ $ уходит (итог сверху остаётся), число мельче. 1024 было тесным и раньше.",
            "width": 2400,
            "rows": rows,
        })


main()
