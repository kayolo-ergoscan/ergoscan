import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { catchAsyncRoutes, jsonErrorHandler } from "./asyncRoutes.js";

async function withApp(
  setup: (app: express.Express) => void,
  run: (base: string) => Promise<void>
): Promise<void> {
  const app = express();
  catchAsyncRoutes(app);
  setup(app);
  app.use(jsonErrorHandler("test"));
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test("a rejected async handler answers 500 and the server keeps serving", async () => {
  await withApp(
    (app) => {
      app.get("/boom/:s", async (req, res) => {
        // The old bySymbol bug: Express already decoded %25 to "%".
        res.json({ s: decodeURIComponent(req.params.s) });
      });
      app.get("/ok", (_req, res) => {
        res.json({ ok: true });
      });
    },
    async (base) => {
      const bad = await fetch(`${base}/boom/%25`);
      assert.equal(bad.status, 500);
      assert.deepEqual(await bad.json(), { error: "internal" });
      const ok = await fetch(`${base}/ok`);
      assert.equal(ok.status, 200);
    }
  );
});

test("malformed escapes in a path stay a 400 from Express", async () => {
  await withApp(
    (app) => {
      app.get("/t/:s", (req, res) => {
        res.json({ s: req.params.s });
      });
    },
    async (base) => {
      const r = await fetch(`${base}/t/%E0%A4%A`);
      assert.equal(r.status, 400);
      const good = await fetch(`${base}/t/%25`);
      assert.deepEqual(await good.json(), { s: "%" });
    }
  );
});

test("settings getter still works after patching", () => {
  const app = express();
  catchAsyncRoutes(app);
  app.set("x-test", 7);
  assert.equal(app.get("x-test"), 7);
});
