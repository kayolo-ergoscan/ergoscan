"""Boards for the rent tile research (Telegram PNGs). Run after gen.py + shoot.mjs.

python3 design/rent-card/make_boards.py RECTS_DIR
RECTS_DIR holds the {v}-{desk,phone}-rect.txt files from gen.py.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
BOARD = os.path.join(HERE, "../sticky/board.py")
D = "/root/snap/chromium/common/rent-card"
NAMES = {
    "v1": "1 «Квитанция»",
    "v2": "2 «Шкала»",
    "v3": "3 «Две плитки»",
}
NOTES = {
    "v1": "Одна плитка, один ярлык, две подписанные половины. Слева: «до 135 ERG» с подписью, с каких боксов и до какого времени; ящики и Пиксель; под ними всегда видно, кто на очереди, через сколько, сколько боксов и какая рента (та же сумма, что всплывает над ящиком). "
          "Справа: таблица без прокрутки — токены сгруппированы (×6 = шесть боксов), колонки «Сколько · ≈ $ · Через», сортировка по времени, итог ≈ $ сверху и одна строка, почему это опасно.",
    "v2": "Одна плитка вокруг одной оси времени: сейчас → конец эпохи → 7 дней. Слева ящики и очередь, справа два числа: ERG этой эпохи и $ в токенах под угрозой. "
          "Внизу шкала: оранжевый отрезок — эта эпоха, значки токенов стоят там, когда их бокс можно забрать; самый дорогой подписан.",
    "v3": "Две плитки вместо одной: «Рента этой эпохи» (зелёный ярлык — боксы) и «Токены под угрозой» (синий ярлык — токены), как устроена вся сетка «Сигнала»: одна плитка — одна мысль. "
          "У каждой свой заголовок, своё число, своя ссылка.",
}


def rect(rd, v, dev):
    return json.load(open(os.path.join(rd, f"{v}-{dev}-rect.txt")))


def desk_ctx(rd, v):
    l, t, w, h, _ = rect(rd, v, "desk")
    return [704, int((t - 74) * 2), 3344, int((t + h + 14) * 2)]


def phone_card(rd, v):
    l, t, w, h, _ = rect(rd, v, "phone")
    return [0, int((t - 14) * 2), 780, int((t + h + 14) * 2)]


def run(spec):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(spec, f)
    subprocess.run([sys.executable, BOARD, f.name], check=True)
    os.unlink(f.name)


def main():
    rd = sys.argv[1]
    run({
        "out": f"{D}/1-problem.png",
        "title": "Сейчас: «Рента хранения» + «Опасная зона» — что непонятно",
        "caption": "1 — «135.4 ERG будет собрано в этой эпохе»: какой эпохе, когда она кончится, со скольких боксов (1 814 есть в данных, но не показано); «будет» — обещание, на деле это оценка «до». "
        "2 — строка над ящиками без подписи, появляется только при наведении; «1h» значит «через 1–4 блока», а не час. "
        "3 — «0.07 ERG» над ящиком без подписи и не связан с 135 ERG. "
        "4 — ящики: цвет = ранг ренты, размер = число боксов — легенды нет, читается как радуга. "
        "5 — «Опасная зона» тем же зелёным ярлыком, что и рента; что опасно и для кого — не сказано. "
        "6 — список сам едет по кругу, его нельзя прочитать; нет «когда»; один токен повторяется строками (это боксы); красные $ выглядят как убыток; EGIO показан как «00b1…ccf3». "
        "7 — «Все» — все что? Три окна времени (ближайшие минуты, эпоха, 7 дней) смешаны без слов.",
        "width": 2400,
        "rows": [
            [{"src": f"{D}/0-now-caption-frame.png", "label": "1771 · карточка (кадр, когда Пиксель стучит по ящику)",
              "marks": [[365, 22, 690, 108, "1"], [95, 122, 625, 165, "2"], [225, 248, 365, 285, "3"],
                        [120, 300, 610, 535, "4"], [750, 22, 955, 70, "5"], [755, 110, 1400, 610, "6"],
                        [30, 650, 100, 698, "7"]]}],
            [{"src": f"{D}/now-phone.png", "crop": phone_card(rd, "now"), "label": "телефон 390"}],
        ],
        "max_row_h": 1100,
    })
    for v in ("v1", "v2", "v3"):
        run({
            "out": f"{D}/2-{v}.png" if v == "v1" else f"{D}/{2 + int(v[1]) - 1}-{v}.png",
            "title": f"Вариант {NAMES[v]} · до / после",
            "caption": NOTES[v],
            "width": 2400,
            "max_row_h": 1500,
            "rows": [
                [{"src": f"{D}/now-desk.png", "crop": desk_ctx(rd, "now"), "label": "сейчас · 1771, плитка в сетке главной"}],
                [{"src": f"{D}/{v}-desk.png", "crop": desk_ctx(rd, v), "label": f"{NAMES[v]} · 1771"}],
                [{"src": f"{D}/now-phone.png", "crop": phone_card(rd, "now"), "label": "сейчас · 390"},
                 {"src": f"{D}/{v}-phone.png", "crop": phone_card(rd, v), "label": f"{NAMES[v]} · 390"}],
            ],
        })
    run({
        "out": f"{D}/5-overview.png",
        "title": "Плитка ренты: сейчас и три варианта (1771)",
        "caption": "Сверху вниз: сейчас, 1 «Квитанция», 2 «Шкала», 3 «Две плитки». Данные живые, из снимка главной; ящики и Пиксель — настоящие.",
        "width": 2400,
        "rows": [
            [{"src": f"{D}/now-desk.png", "crop": desk_ctx(rd, "now"), "label": "сейчас"},
             {"src": f"{D}/v1-desk.png", "crop": desk_ctx(rd, "v1"), "label": NAMES["v1"]}],
            [{"src": f"{D}/v2-desk.png", "crop": desk_ctx(rd, "v2"), "label": NAMES["v2"]},
             {"src": f"{D}/v3-desk.png", "crop": desk_ctx(rd, "v3"), "label": NAMES["v3"]}],
        ],
    })


main()
