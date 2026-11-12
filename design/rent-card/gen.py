"""Shot specs for the rent tile research (feeds design/brand/shoot.mjs).

python3 design/rent-card/gen.py HOME.json OUT.json [variants]
HOME.json is a saved GET of the gateway /v1/page/home (read-only, no DB work).
Variants: now v1 v2 v3. Each gives a desk (1771 @2x) and a phone (390 @2x) shot,
plus a rect file with the tile position for cropping.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = "https://ergoscan.me/"
STAGE = "/root/snap/chromium/common/rent-card"
FIND = ("(()=>{const h=[...document.querySelectorAll('main h2')].find(e=>/Рента хранения|Рента этой эпохи|Storage rent/.test(e.textContent));"
        "return h&&h.closest('article').parentElement})()")
DEV = {
    "desk": {"w": 1771, "h": 891, "dpr": 2},
    "phone": {"w": 390, "h": 1040, "dpr": 2, "mobile": True},
}


def main():
    home = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    variants = sys.argv[3].split(",") if len(sys.argv) > 3 else ["now", "v1", "v2", "v3"]
    data = {
        "height": home["height"],
        "epochBoxes": home.get("rentEpochBoxes"),
        "epochNano": home.get("rentEpochNano"),
        "tape": home.get("rentTape") or [],
        "danger": home.get("rentDanger") or [],
    }
    src = open(os.path.join(HERE, "mock.js")).read()
    specs = []
    for v in variants:
        for dev, d in DEV.items():
            inject = "" if v == "now" else f"{src};window.__rentMock({json.dumps(v)},{json.dumps(data)});"
            block = "center" if dev == "desk" else "start"
            scroll = f"(()=>{{const s={FIND};s&&s.scrollIntoView({{block:'{block}'}});"
            if dev == "phone":
                scroll += "window.scrollBy(0,-84);"
            scroll += "return 1})()"
            rect = (f"(()=>{{const s={FIND};const r=s.getBoundingClientRect();"
                    "return btoa(JSON.stringify([r.left,r.top,r.width,r.height,scrollY]))})()")
            specs.append({
                "url": SITE,
                "out": f"{STAGE}/{v}-{dev}.png",
                **d,
                "ls": {"lumen-stage-locale": "ru"},
                "wait": 8000,
                "eval": f"(()=>{{{inject}return {scroll}}})()",
                "after": 3200,
                "saveEval": {"expr": rect, "out": os.path.join(os.environ.get("RECTS", STAGE), f"{v}-{dev}-rect.txt")},
            })
    json.dump(specs, open(out, "w"))
    print(out, len(specs))


main()
