"""Decode the data URLs that sheets/export.html prints (via chromium --dump-dom) into PNG files.

python3 design/brand/export.py <dump.html>
"""
import base64
import html
import pathlib
import re
import sys

here = pathlib.Path(__file__).resolve().parent
text = html.unescape(pathlib.Path(sys.argv[1]).read_text())
n = 0
for rel, b64 in re.findall(r"([a-z0-9-]+/png/[a-z0-9-]+\.png) data:image/png;base64,([A-Za-z0-9+/=]+)", text):
    out = here / "logo" / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(base64.b64decode(b64))
    n += 1
print(n, "files")
