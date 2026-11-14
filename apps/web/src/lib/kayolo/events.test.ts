import assert from "node:assert/strict";
import { test } from "node:test";

// The bus needs a window; a stub with a path and a dispatcher is enough here.
const sent: unknown[] = [];
const win = { location: { pathname: "/address/9abc" }, dispatchEvent: (e: CustomEvent) => (sent.push(e.detail), true) };
(globalThis as unknown as { window: typeof win }).window = win;

test("page:* said before the engine starts wait for it once, this path only", async () => {
  const { say, takeEarly } = await import("./events");
  say({ k: "page:rent", address: "9abc", tone: "soon", blocks: 300 });
  say({ k: "chain:tip-wait", level: 1, sinceMs: 1 });
  win.location.pathname = "/tx/1";
  say({ k: "page:miss" });
  win.location.pathname = "/address/9abc";
  say({ k: "page:empty" });
  const early = takeEarly().map((e) => e.ev.k);
  assert.deepEqual(early, ["page:rent", "page:empty"]);
  // Every event still went out on the bus as it was said.
  assert.equal(sent.length, 4);
  // Taken once: from now on nothing is kept.
  say({ k: "page:miss" });
  assert.deepEqual(takeEarly(), []);
});
