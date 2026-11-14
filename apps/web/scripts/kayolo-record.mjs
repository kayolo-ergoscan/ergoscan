#!/usr/bin/env node
/**
 * Records the live stream for Kayolo's replay test (design/brand/kayolo-life.md §9.9, §9.11).
 * Read-only: one WebSocket to the gateway, the same one a page opens; nothing is sent but the
 * connection itself. What is kept is what chain-sense reads, so 30 min fit in ≤ 60 KB:
 *
 *   block.sealed {height, txIds, txCount, size}, chain.tip {height}, mempool.add {txId, category},
 *   mempool.remove {id}, mempool.snapshot {count, ts} (only when the count changed),
 *   fees.histogram {p50, p90, eta} (only when it changed), node.info {headersHeight, fullHeight,
 *   peersCount} (only when it changed), hello {mock}, socket {open} (it reconnects in 2 s, as the
 *   site does). Times are ms from the start.
 *
 *   node apps/web/scripts/kayolo-record.mjs [--gateway ws://127.0.0.1:4400] [--min 30] [--out file.json]
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const require = createRequire(new URL("../../../package.json", import.meta.url));
const WebSocket = require("ws");

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? dflt : (args[i + 1] ?? dflt);
};
const GATEWAY = opt("gateway", "ws://127.0.0.1:4400");
const MIN = Number(opt("min", "30"));
const OUT = opt("out", "stream.json");

const t0 = Date.now();
const out = { recorded: new Date(t0).toISOString(), minutes: MIN, events: [] };
let lastCount = null;
let lastFees = "";
let lastNode = "";
const push = (type, data) => out.events.push([Date.now() - t0, type, data]);

let ws = null;
let opened = false;
const handle = (raw) => {
  let m;
  try {
    m = JSON.parse(String(raw));
  } catch {
    return;
  }
  const d = m.data ?? {};
  switch (m.type) {
    case "hello":
      push("hello", { mock: d.mock === true });
      break;
    case "block.sealed":
      push("block.sealed", { height: d.height, txIds: Array.isArray(d.txIds) ? d.txIds : [], txCount: d.txCount, size: d.size ?? null });
      break;
    case "chain.tip":
      push("chain.tip", { height: d.height });
      break;
    case "mempool.add":
      push("mempool.add", { txId: d.txId ?? d.id, category: d.category ?? "unknown" });
      break;
    case "mempool.remove":
      push("mempool.remove", { id: d.id });
      break;
    case "mempool.snapshot": {
      const count = Number.isFinite(d.count) ? d.count : Array.isArray(d.balls) ? d.balls.length : null;
      if (count !== lastCount) {
        lastCount = count;
        // Oracle balls matter to E15: their ids ride along (a handful at most).
        const oracle = Array.isArray(d.balls) ? d.balls.filter((b) => b.category === "oracle").map((b) => b.txId ?? b.id) : [];
        push("mempool.snapshot", oracle.length ? { count, ts: d.ts, oracle } : { count, ts: d.ts });
      }
      break;
    }
    case "fees.histogram": {
      const f = { p50: d.p50, p90: d.p90, eta: d.eta ? { avgIntervalMs: d.eta.avgIntervalMs, lastBlockTs: d.eta.lastBlockTs } : null };
      const k = JSON.stringify(f);
      if (k !== lastFees) {
        lastFees = k;
        push("fees.histogram", f);
      }
      break;
    }
    case "node.info": {
      const n = { headersHeight: d.headersHeight, fullHeight: d.fullHeight, peersCount: d.peersCount };
      const k = JSON.stringify(n);
      if (k !== lastNode) {
        lastNode = k;
        push("node.info", n);
      }
      break;
    }
  }
};
// Reconnects like PageSync (2 s); the socket's own open/close are kept, the replay reads them too.
let done = false;
const connect = () => {
  if (done) return;
  ws = new WebSocket(`${GATEWAY.replace(/\/$/, "")}/v1/stream`, { origin: "https://ergoscan.me" });
  ws.on("open", () => {
    opened = true;
    push("socket", { open: true });
  });
  ws.on("message", handle);
  ws.on("close", (code) => {
    if (opened) push("socket", { open: false, code });
    opened = false;
    lastCount = null;
    lastFees = "";
    lastNode = "";
    if (!done) setTimeout(connect, 2000);
  });
  ws.on("error", (e) => {
    console.error("stream error", e.message);
  });
};
connect();
const stop = () => {
  done = true;
  try {
    ws?.close();
  } catch {}
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`recorded ${out.events.length} events in ${Math.round((Date.now() - t0) / 1000)} s → ${OUT}`);
  process.exit(0);
};
setTimeout(stop, MIN * 60_000);
process.on("SIGINT", stop);
