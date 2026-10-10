"""Serve /{cid}.webp from /var/nft-preview/{cid[:2]}/{cid}.webp on the private net."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os

ROOT = "/var/nft-preview"
HOST = "10.0.0.3"
PORT = 8790


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        name = self.path.split("?", 1)[0].strip("/")
        if "/" in name or not name.endswith(".webp"):
            self.send_error(404)
            return
        cid = name[: -len(".webp")]
        if not cid.isalnum() or len(cid) < 8 or len(cid) > 128:
            self.send_error(404)
            return
        path = os.path.join(ROOT, cid[:2], cid + ".webp")
        if not os.path.isfile(path):
            self.send_error(404)
            return
        with open(path, "rb") as fh:
            data = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", "image/webp")
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        return


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
