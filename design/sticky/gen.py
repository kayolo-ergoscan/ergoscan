"""Build shoot.mjs / rec.mjs configs for the seam variants on the live site.

python3 design/sticky/gen.py shots OUT.json [variants] [pages] [devices]
python3 design/sticky/gen.py rec   OUT.json variant page device
The page code is only injected into the headless browser; nothing is sent anywhere.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SHIP = "/root/snap/chromium/common/sticky"
SITE = "https://ergoscan.me"
ADDR = "88dhgzEuTXaRQTX5KNdnaWTTX7fEZVEQRn6qP4MJotPuRnS3QpoJxYpSaXoU1y7SHp8ZXMp92TH22DBY"
PAGES = {"blocks": "/blocks", "transactions": "/transactions", "tokens": "/tokens", "address": f"/address/{ADDR}"}
DEV = {
    "desk": {"w": 1771, "h": 891, "dpr": 1, "mobile": False, "scroll": 700},
    "phone": {"w": 390, "h": 844, "dpr": 2, "mobile": True, "scroll": 900},
}
SEAM_JS = open(os.path.join(HERE, "seam.js")).read()


def inject(v):
    if v == "now":
        return ""
    css = open(os.path.join(HERE, f"seam-{v}.css")).read()
    return f"window.__seam={json.dumps(v)};window.__seamCss={json.dumps(css)};" + SEAM_JS


def shot(v, page, dev):
    d = DEV[dev]
    return {
        "url": SITE + PAGES[page],
        "out": f"{SHIP}/{v}-{page}-{dev}.png",
        "w": d["w"], "h": d["h"], "dpr": d["dpr"], "mobile": d["mobile"],
        "ls": {"lumen-stage-locale": "ru"},
        "wait": 6500,
        "eval": inject(v) + f";window.scrollTo({{top:{d['scroll']},behavior:'instant'}});",
        "after": 900,
    }


def main():
    mode, out = sys.argv[1], sys.argv[2]
    if mode == "shots":
        vs = (sys.argv[3] if len(sys.argv) > 3 else "a,b,c").split(",")
        ps = (sys.argv[4] if len(sys.argv) > 4 else "blocks,tokens,address").split(",")
        ds = (sys.argv[5] if len(sys.argv) > 5 else "desk,phone").split(",")
        cfg = [shot(v, p, d) for v in vs for p in ps for d in ds]
    else:
        v, page, dev = sys.argv[3], sys.argv[4], sys.argv[5]
        d = DEV[dev]
        cfg = {
            "url": SITE + PAGES[page],
            "out": f"{SHIP}/{v}-{page}-{dev}-scroll.mp4",
            "w": d["w"], "h": d["h"], "dpr": d["dpr"] if dev == "phone" else 1, "mobile": d["mobile"],
            "ls": {"lumen-stage-locale": "ru"},
            "wait": 6500,
            "inject": inject(v),
            # scroll keyframes: [ms from start, scrollY]; eased between, held at the end
            "path": [[0, 0], [600, 0], [2600, 420], [3600, 420], [5400, 800], [6800, 800]]
            if dev == "desk"
            else [[0, 0], [600, 0], [2600, 520], [3600, 520], [5400, 1100], [6800, 1100]],
        }
    json.dump(cfg, open(out, "w"), indent=1)
    print(out, len(cfg) if isinstance(cfg, list) else 1)


main()
