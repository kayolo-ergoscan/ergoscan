"""Boards for the seam research (Telegram PNGs). Run after gen.py shots + shoot.mjs."""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
D = "/root/snap/chromium/common/sticky"
DESK = [340, 0, 1690, 300]
SEAM = [340, 0, 1690, 175]
PHONE = [0, 0, 780, 720]
NAMES = {
    "a": "A «Кромка»",
    "b": "B «Причал»",
    "c": "C «Туман»",
}
NOTES = {
    "a": "Шапка и плашка — две плитки на чёрном, как всё в сетке. Чёрный воротник вокруг шапки: строки больше не видны над ней и между ними. Пока под плашкой едут строки, у неё снизу 2px в цвете раздела (блоки — жёлтый, токены — синий, адрес — розовый).",
    "b": "Плашка доезжает до шапки и пристыковывается: нижние углы шапки становятся прямыми, плашка расширяется до ширины шапки — один бар из двух строк с тонким швом. По низу бара 2px в цвете раздела растут по мере прокрутки дня.",
    "c": "Без линий. Чёрный воротник и зазор как в A; застрявшая плашка светлеет на один тон, а строки под ней растворяются в цвет карточки на 36px.",
}


def run(spec):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(spec, f)
    subprocess.run([sys.executable, os.path.join(HERE, "board.py"), f.name], check=True)
    os.unlink(f.name)


def main():
    run({
        "out": f"{D}/1-problem.png",
        "title": "Сейчас: список въезжает в шапку",
        "caption": "1 — над шапкой 10px зазора, в нём видны строки списка: список «сверху» шапки. "
        "2 — плашка дня того же цвета #1a1a1a, что и шапка, и заезжает под неё на 3px: шапка и плашка сливаются в одну Т-образную массу, границы нет. "
        "Телефон: 3 — шапка прозрачная с градиентом, между пилюлей и плашкой просвечивают строки; 4 — пилюля стеклянная (blur), сквозь неё видны цифры.",
        "width": 2400,
        "rows": [
            [{"src": f"{D}/0-now-blocks-desk.png", "crop": DESK, "label": "/blocks, верх страницы"},
             {"src": f"{D}/0-now-blocks-desk-scrolled.png", "crop": DESK, "label": "/blocks, прокрутка",
              "marks": [[12, 0, 1338, 11, "1"], [44, 62, 1300, 118, "2"]]}],
            [{"src": f"{D}/0-now-blocks-phone-scrolled.png", "crop": PHONE, "label": "телефон 390, /blocks",
              "marks": [[24, 112, 756, 166, "3"], [24, 14, 756, 104, "4"]]},
             {"src": f"{D}/0-now-tokens-phone-scrolled.png", "crop": PHONE, "label": "телефон 390, /tokens"},
             {"src": f"{D}/0-now-address-phone-scrolled.png", "crop": PHONE, "label": "телефон 390, адрес"},
             {"src": f"{D}/0-now-transactions-phone-scrolled.png", "crop": PHONE, "label": "телефон 390, /transactions"}],
        ],
    })
    for v in "abc":
        run({
            "out": f"{D}/2-{v}-desk.png",
            "title": f"{NAMES[v]} · 1771, до / после",
            "caption": NOTES[v],
            "width": 2400,
            "rows": [
                [{"src": f"{D}/0-now-{p}-desk-scrolled.png", "crop": DESK, "label": f"сейчас · {p}"},
                 {"src": f"{D}/{v}-{p}-desk.png", "crop": DESK, "label": f"{NAMES[v]} · {p}"}]
                for p in ("blocks", "tokens", "address")
            ],
        })
        run({
            "out": f"{D}/3-{v}-phone.png",
            "title": f"{NAMES[v]} · телефон 390, до / после",
            "caption": NOTES[v],
            "width": 2400,
            "rows": [
                [{"src": f"{D}/0-now-blocks-phone-scrolled.png", "crop": PHONE, "label": "сейчас · blocks"},
                 {"src": f"{D}/{v}-blocks-phone.png", "crop": PHONE, "label": f"{v.upper()} · blocks"},
                 {"src": f"{D}/0-now-tokens-phone-scrolled.png", "crop": PHONE, "label": "сейчас · tokens"},
                 {"src": f"{D}/{v}-tokens-phone.png", "crop": PHONE, "label": f"{v.upper()} · tokens"}],
            ],
        })
    run({
        "out": f"{D}/4-overview.png",
        "title": "Шов шапки и списка: сейчас и три варианта",
        "caption": "/blocks, середина списка. Сверху вниз: сейчас, A «Кромка», B «Причал», C «Туман». Справа — телефон 390.",
        "width": 2400,
        "rows": [
            [{"src": f"{D}/0-now-blocks-desk-scrolled.png", "crop": SEAM, "label": "сейчас"}],
            [{"src": f"{D}/a-blocks-desk.png", "crop": SEAM, "label": NAMES["a"]}],
            [{"src": f"{D}/b-blocks-desk.png", "crop": SEAM, "label": NAMES["b"]}],
            [{"src": f"{D}/c-blocks-desk.png", "crop": SEAM, "label": NAMES["c"]}],
            [{"src": f"{D}/0-now-blocks-phone-scrolled.png", "crop": [0, 0, 780, 560], "label": "сейчас"},
             {"src": f"{D}/a-blocks-phone.png", "crop": [0, 0, 780, 560], "label": "A"},
             {"src": f"{D}/b-blocks-phone.png", "crop": [0, 0, 780, 560], "label": "B"},
             {"src": f"{D}/c-blocks-phone.png", "crop": [0, 0, 780, 560], "label": "C"}],
        ],
    })


main()
