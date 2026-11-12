"""Before/after shots of the shipped rent tiles (feeds design/brand/shoot.mjs).

python3 design/rent-card/impl.py OUT.json BEFORE_URL AFTER_URL [RECTS_DIR]
Shots: impl-{before,after}-{ru,en}-{desk,phone-rent,phone-danger}.png in the stage folder.
"""
import json
import os
import sys

STAGE = "/root/snap/chromium/common/rent-card"
RENT = "/Рента хранения|Storage rent|Рента этой эпохи|Rent this epoch/"
DANGER = "/Опасная зона|Danger zone|Токены под угрозой|Tokens at risk/"


def find(rx, up):
    return (f"(()=>{{const h=[...document.querySelectorAll('main h2')].find(e=>{rx}.test(e.textContent));"
            f"return h&&h.closest('article'){'.parentElement' if up else ''}}})()")


def main():
    out, before, after = sys.argv[1], sys.argv[2], sys.argv[3]
    rects = sys.argv[4] if len(sys.argv) > 4 else STAGE
    specs = []
    for when, url in (("before", before), ("after", after)):
        for lang in ("ru", "en"):
            shots = [
                ("desk", {"w": 1771, "h": 891, "dpr": 2}, find(RENT, True), "center", 0),
                ("phone-rent", {"w": 390, "h": 844, "dpr": 2, "mobile": True}, find(RENT, False), "start", -84),
                ("phone-danger", {"w": 390, "h": 844, "dpr": 2, "mobile": True}, find(DANGER, False), "start", -84),
            ]
            for name, dev, el, block, nudge in shots:
                scroll = f"(()=>{{const s={el};s&&s.scrollIntoView({{block:'{block}'}});window.scrollBy(0,{nudge});return 1}})()"
                rect = (f"(()=>{{const s={el};const r=s.getBoundingClientRect();"
                        "return btoa(JSON.stringify([r.left,r.top,r.width,r.height,scrollY]))})()")
                specs.append({
                    "url": url,
                    "out": f"{STAGE}/impl-{when}-{lang}-{name}.png",
                    **dev,
                    "ls": {"lumen-stage-locale": lang},
                    "wait": 8000,
                    "eval": scroll,
                    "after": 3000,
                    "saveEval": {"expr": rect, "out": os.path.join(rects, f"impl-{when}-{lang}-{name}-rect.txt")},
                })
    json.dump(specs, open(out, "w"))
    print(out, len(specs))


main()
