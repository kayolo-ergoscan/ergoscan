#!/usr/bin/env node
/**
 * Kayolo at rest (design/brand/kayolo-life.md §9.10). Read-only: Chromium over CDP, no writes anywhere.
 *
 * 1. Cost: after the header pass has parked (--warm s), Performance.getMetrics over --idle s of rest,
 *    once with the header scout live and once with it switched off in the page (an init script makes
 *    his canvas report no parent, so HeaderScout never starts). Both run at the same time in two
 *    browsers, so they see the same blocks. live − hidden is his price; target LayoutCount ≤ 2.
 *    rAF, getBoundingClientRect, getComputedStyle and elementsFromPoint calls are counted page-wide.
 * 2. --clicks: ten clicks through his button (search, price, market cap, «Адреса», PriceSheet,
 *    PricesHit), each fired when his 52×56 button overlaps the target, plus the 9 points of his
 *    body at rest on the desktop.
 *
 * A production preview on a loopback origin reads /v1 from itself and has no /v1 rewrite, so the
 * script puts a small proxy in front: /v1 (HTTP and the stream) to the gateway, the rest to Next.
 *
 *   node apps/web/scripts/kayolo-perf.mjs --next http://127.0.0.1:4419 \
 *     [--gateway http://127.0.0.1:4400] [--pages /,/block/H,/address/A,/favorites] \
 *     [--vp 1771x891@1.5,390x844@3] [--warm 30] [--idle 60] [--clicks] [--out result.json] \
 *     [--shots DIR]   (one PNG per viewport and page after --warm s, at --idle 0 nothing is measured)
 *     [--tab]         (Э1b: Tab from the search goes to Kayolo's window, then to the price)
 *     [--bodies N]    (Э1b: N client-side transitions; every frame counts the bodies drawn: never 2)
 * Start the preview on a free port (not 4400/4401/4410) and stop it by its port PID only.
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const require = createRequire(new URL("../../../package.json", import.meta.url));
const WebSocket = require("ws");

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? dflt : (args[i + 1] ?? dflt);
};
const NEXT = new URL(opt("next", "http://127.0.0.1:4419"));
const GATEWAY = new URL(opt("gateway", "http://127.0.0.1:4400"));
const WARM = Number(opt("warm", "30")) * 1000;
const IDLE = Number(opt("idle", "60")) * 1000;
const OUT = opt("out", "");
const CHROME = opt("chrome", "/usr/bin/chromium-browser");
const CLICKS = args.includes("--clicks");
const TAB = args.includes("--tab");
const BODIES = Number(opt("bodies", "0"));
const SHOTS = opt("shots", "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- proxy: /v1 → gateway (the stream with the site origin), the rest → Next ---------- */

function startProxy() {
  const server = http.createServer((req, res) => {
    const to = req.url.startsWith("/v1/") ? GATEWAY : NEXT;
    const up = http.request(
      { host: to.hostname, port: to.port, path: req.url, method: req.method, headers: { ...req.headers, host: to.host } },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      }
    );
    up.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  });
  server.on("upgrade", (req, sock, head) => {
    const to = req.url.startsWith("/v1/") ? GATEWAY : NEXT;
    const up = net.connect(Number(to.port), to.hostname, () => {
      const headers = { ...req.headers, host: to.host };
      // The site gateway only takes the stream from its own pages.
      if (to === GATEWAY) headers.origin = "https://ergoscan.me";
      const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)];
      up.write(lines.join("\r\n") + "\r\n\r\n");
      if (head?.length) up.write(head);
      up.pipe(sock);
      sock.pipe(up);
    });
    up.on("error", () => sock.destroy());
    sock.on("error", () => up.destroy());
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/* ---------- CDP ---------- */

/** Profiles still on disk; removed on exit too, so a run that ends right after a close leaves nothing. */
const profiles = new Set();
process.on("exit", () => {
  // Chromium may still be writing the profile as it dies: retry, and never fail the run over it.
  for (const dir of profiles) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  }
});

async function browser() {
  // Snap Chromium may only write under ~/snap/chromium/common.
  const dir = mkdtempSync("/root/snap/chromium/common/kayolo-perf-");
  profiles.add(dir);
  // Port 0: Chromium takes a free port and names it in DevToolsActivePort, so browsers running side by side
  // never share one (a shared random port once had live and hidden measure the same page).
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      "--no-sandbox",
      "--hide-scrollbars",
      "--disable-gpu",
      "--mute-audio",
      `--user-data-dir=${dir}`,
      "--remote-debugging-port=0",
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  let port = 0;
  let targets = [];
  for (let i = 0; i < 80 && !targets.length; i++) {
    try {
      port ||= Number(readFileSync(`${dir}/DevToolsActivePort`, "utf8").split("\n")[0]) || 0;
      if (port) targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === "page");
    } catch {}
    if (!targets.length) await sleep(250);
  }
  if (!targets.length) {
    proc.kill("SIGKILL");
    throw new Error("chromium did not start");
  }
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  let seq = 0;
  const waiters = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.id && waiters.has(m.id)) {
      waiters.get(m.id)(m);
      waiters.delete(m.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      waiters.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluate failed");
    return r.result.value;
  };
  const close = () => {
    try {
      ws.close();
    } catch {}
    proc.kill("SIGKILL");
    setTimeout(() => {
      rmSync(dir, { recursive: true, force: true });
      profiles.delete(dir);
    }, 800);
  };
  return { send, evaluate, close };
}

function parseVp(s) {
  const m = /^(\d+)x(\d+)(?:@([\d.]+))?$/.exec(s.trim());
  if (!m) throw new Error(`bad viewport ${s}`);
  const width = Number(m[1]);
  return { name: s.trim(), width, height: Number(m[2]), dpr: Number(m[3] ?? 1), phone: width < 1024 };
}

const COUNTERS = (hidden) => `(() => {
  const c = { raf: 0, gbcr: 0, gcs: 0, efp: 0, loaf: 0, loafMax: 0 };
  Object.defineProperty(window, "__kperf", { value: c });
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { c.raf++; return raf(cb); };
  const gbcr = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () { c.gbcr++; return gbcr.call(this); };
  const gcs = window.getComputedStyle.bind(window);
  window.getComputedStyle = (el, p) => { c.gcs++; return gcs(el, p); };
  const efp = Document.prototype.elementsFromPoint;
  Document.prototype.elementsFromPoint = function (x, y) { c.efp++; return efp.call(this, x, y); };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { if (e.duration > 50) c.loaf++; c.loafMax = Math.max(c.loafMax, e.duration); }
    }).observe({ type: "long-animation-frame" });
  } catch {}
  ${
    hidden
      ? `const pe = Object.getOwnPropertyDescriptor(Node.prototype, "parentElement");
  Object.defineProperty(HTMLCanvasElement.prototype, "parentElement", { configurable: true,
    get() { return this.classList && (this.classList.contains("header-scout") || this.classList.contains("kayolo-canvas")) ? null : pe.get.call(this); } });`
      : ""
  }
})();`;

async function openPage(b, base, path, vp, hidden) {
  await b.send("Page.enable");
  await b.send("Runtime.enable");
  await b.send("Performance.enable");
  await b.send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.phone });
  if (vp.phone) await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await b.send("Page.addScriptToEvaluateOnNewDocument", { source: COUNTERS(hidden) });
  await b.send("Page.navigate", { url: new URL(path, base).href });
}

const METRICS = ["LayoutCount", "RecalcStyleCount", "LayoutDuration", "RecalcStyleDuration", "ScriptDuration", "TaskDuration"];

async function metrics(b) {
  const r = await b.send("Performance.getMetrics");
  const out = {};
  for (const m of r.metrics) if (METRICS.includes(m.name)) out[m.name] = m.value;
  const c = await b.evaluate("({ ...window.__kperf, beat: document.querySelector('canvas.header-scout')?.dataset.scoutBeat ?? null })");
  return { ...out, ...c };
}

function diff(a, b) {
  const out = {};
  for (const k of Object.keys(b)) {
    if (typeof b[k] === "number" && typeof a[k] === "number") {
      out[k] = /Duration$/.test(k) ? +((b[k] - a[k]) * 1000).toFixed(1) : b[k] - a[k];
    }
  }
  out.loafMax = b.loafMax;
  out.beat = `${a.beat ?? "-"}→${b.beat ?? "-"}`;
  return out;
}

async function idleRun(base, path, vp, hidden) {
  const b = await browser();
  try {
    await openPage(b, base, path, vp, hidden);
    await sleep(WARM);
    const m0 = await metrics(b);
    await sleep(IDLE);
    const m1 = await metrics(b);
    return diff(m0, m1);
  } finally {
    b.close();
  }
}

/* ---------- clicks ---------- */

const CLICK_PLAN = (pages) => {
  const block = pages.find((p) => p.startsWith("/block/")) ?? "/blocks";
  const address = pages.find((p) => p.startsWith("/address/")) ?? "/addresses";
  const desk = parseVp("1771x891@1.5");
  const phone = parseVp("390x844@3");
  return [
    // Э1b: the desktop tour ends in the niche, nowhere near the search; the click must still reach it.
    { vp: desk, path: block, name: "search", target: '[data-scout="search"]', any: true },
    { vp: desk, path: block, name: "price", target: 'a:has([data-scout="price"])', near: '[data-scout="price"]' },
    { vp: desk, path: block, name: "market cap", target: 'a:has([data-scout="mcap"])', near: '[data-scout="mcap"]' },
    { vp: desk, path: address, name: "«Адреса» by the door", target: '.nav-rail a:has([data-scout="addresses"]), .nav-rail [data-scout="addresses"]', beat: "home", any: true },
    { vp: desk, path: "/favorites", name: "search on /favorites", target: '[data-scout="search"]', any: true },
    { vp: phone, path: block, name: "PriceSheet", target: '.phone-toolbar button:has([data-scout="price"])', near: '.phone-toolbar [data-scout="price"]' },
    { vp: phone, path: block, name: "search, parked", target: '.phone-toolbar [data-scout="search"]', beat: "seek" },
    { vp: phone, path: address, name: "PriceSheet", target: '.phone-toolbar button:has([data-scout="price"])', near: '.phone-toolbar [data-scout="price"]' },
    { vp: phone, path: address, name: "search, parked", target: '.phone-toolbar [data-scout="search"]', beat: "seek" },
    { vp: phone, path: "/", name: "PricesHit", target: ".price-tape-hit", any: true },
  ];
};

/** Waits until his button overlaps the target (or `any`), then returns a point inside both. */
const AIM = (c) => `new Promise((resolve) => {
  const t0 = performance.now();
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 ? r : null; };
  const pick = () => [...document.querySelectorAll(${JSON.stringify(c.target)})].find(visible) ?? null;
  const tick = () => {
    const target = pick();
    const near = ${JSON.stringify(c.near ?? "")} ? [...document.querySelectorAll(${JSON.stringify(c.near ?? "")})].find(visible) : target;
    const hit = document.querySelector("button.header-scout");
    const beat = document.querySelector("canvas.header-scout")?.dataset.scoutBeat ?? null;
    const wait = performance.now() - t0;
    if (target && near) {
      const tr = near.getBoundingClientRect();
      const on = hit && hit.getAttribute("aria-hidden") === "false";
      const hr = on ? hit.getBoundingClientRect() : null;
      const ox = hr ? Math.min(tr.right, hr.right) - Math.max(tr.left, hr.left) : 0;
      const oy = hr ? Math.min(tr.bottom, hr.bottom) - Math.max(tr.top, hr.top) : 0;
      const beatOk = ${JSON.stringify(c.beat ?? "")} ? beat === ${JSON.stringify(c.beat ?? "")} : true;
      if (hr && ox > 8 && oy > 8 && beatOk && wait > 1500) {
        resolve({ over: true, beat, x: Math.max(tr.left, hr.left) + ox / 2, y: Math.max(tr.top, hr.top) + oy / 2 });
        return;
      }
      if (${c.any ? "true" : "false"} && wait > 12000 && beatOk || wait > 45000) {
        const r = target.getBoundingClientRect();
        resolve({ over: !!(hr && ox > 8 && oy > 8), beat, x: r.left + r.width / 2, y: r.top + r.height / 2 });
        return;
      }
    } else if (wait > 45000) { resolve(null); return; }
    setTimeout(tick, 16);
  };
  tick();
})`;

async function oneClick(base, c) {
  const b = await browser();
  try {
    await openPage(b, base, c.path, c.vp, false);
    await sleep(2500);
    const at = await b.evaluate(AIM(c));
    if (!at) return { ...c, vp: c.vp.name, ok: false, why: "target not found" };
    await b.evaluate(`window.__clicked = null; window.addEventListener("click", (e) => { window.__clicked = e.target; }, { capture: true, once: true }); true`);
    const under = await b.evaluate(`(() => { const el = document.elementFromPoint(${at.x}, ${at.y}); return el ? (el.className && typeof el.className === "string" ? el.tagName + "." + el.className.split(" ").slice(0, 2).join(".") : el.tagName) : null; })()`);
    if (c.vp.phone) {
      await b.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: at.x, y: at.y }] });
      await b.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
      await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", clickCount: 1 });
      await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", clickCount: 1 });
    }
    await sleep(400);
    const got = await b.evaluate(
      `(() => { const t = window.__clicked; if (!t) return { reached: false, scout: false }; return { reached: !!t.closest(${JSON.stringify(c.target)}), scout: !!t.closest(".header-scout") }; })()`
    );
    return { name: c.name, path: c.path, vp: c.vp.name, over: at.over, beat: at.beat, under, ok: got.reached && !got.scout, ...got };
  } finally {
    b.close();
  }
}

/** Desktop, parked: what the 9 points of his body hit. Only the header (or the search under him) is right. */
async function bodyPoints(base, path) {
  const b = await browser();
  try {
    const vp = parseVp("1771x891@1.5");
    await openPage(b, base, path, vp, false);
    await sleep(WARM);
    return await b.evaluate(`(() => {
      // Э1b: at rest he is in his window (a control of his own); the moving button is off. The 9
      // points must hit his window or the bare header, never the search, the price or a link.
      const slot = document.querySelector(".kayolo-slot");
      const hit = document.querySelector("button.header-scout");
      const on = hit && hit.getAttribute("aria-hidden") === "false";
      const box = slot ?? (on ? hit : null);
      if (!box) return { parked: false };
      const r = box.getBoundingClientRect();
      const names = [];
      for (const fy of [0.45, 0.65, 0.85]) for (const fx of [0.3, 0.5, 0.7]) {
        const el = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
        names.push(!el ? "-" : el.closest(".kayolo-slot") ? "slot" : el.closest(".header-scout") ? "scout" : el.closest("[data-scout=search]") ? "search" : el.closest("a,button") ? "control" : el.closest("header") ? "header" : el.tagName.toLowerCase());
      }
      return { parked: true, moving: !!on, beat: document.querySelector("canvas.header-scout")?.dataset.scoutBeat, holds: window.__kayolo?.()?.hold?.where ?? null, points: names };
    })()`);
  } finally {
    b.close();
  }
}

/* ---------- Э1b: Tab order and one body ---------- */

/** Desktop: focus the search, Tab twice. Kayolo's window must come between the search and the price. */
async function tabOrder(base, path) {
  const b = await browser();
  try {
    const vp = parseVp("1771x891@1.5");
    await openPage(b, base, path, vp, false);
    await sleep(4000);
    const name = `(() => { const el = document.activeElement; if (!el) return "-"; if (el.closest(".kayolo-slot")) return "kayolo"; if (el.closest('[data-scout="search"]')) return "search"; if (el.querySelector && el.querySelector('[data-scout="price"]')) return "price"; return (el.tagName + " " + (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)); })()`;
    await b.evaluate(`(() => { const s = [...document.querySelectorAll('[data-scout="search"]')].find((el) => el.getBoundingClientRect().width > 2); s?.focus(); return !!s; })()`);
    const seen = [await b.evaluate(name)];
    for (let i = 0; i < 2; i++) {
      await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await sleep(250);
      seen.push(await b.evaluate(name));
    }
    return { path, seen, ok: seen.join(" → ") === "search → kayolo → price" };
  } finally {
    b.close();
  }
}

/**
 * Counts bodies in every frame: a canvas of the scout or of Kayolo counts once it has a body-sized
 * fillRect since its last clear; his still frame counts while shown. Sampled at the start of each
 * frame, i.e. what the frame before put on screen.
 */
const BODY_PROBE = `(() => {
  const has = new WeakMap();
  const ours = (cv) => cv && cv.classList && (cv.classList.contains("header-scout") || cv.classList.contains("kayolo-canvas"));
  const P = CanvasRenderingContext2D.prototype;
  const fill = P.fillRect, clear = P.clearRect;
  P.fillRect = function (x, y, w, h) {
    if (ours(this.canvas) && Math.abs(w) >= 14 && Math.abs(h) >= 10) has.set(this.canvas, true);
    return fill.call(this, x, y, w, h);
  };
  P.clearRect = function (x, y, w, h) {
    if (ours(this.canvas)) has.set(this.canvas, false);
    return clear.call(this, x, y, w, h);
  };
  for (const k of ["width", "height"]) {
    const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, k);
    Object.defineProperty(HTMLCanvasElement.prototype, k, { configurable: true, get() { return d.get.call(this); },
      set(v) { if (ours(this)) has.set(this, false); d.set.call(this, v); } });
  }
  const seen = (el) => el.isConnected && (el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : el.getClientRects().length > 0);
  const out = { frames: 0, two: 0, zero: 0, max: 0, worst: [] };
  Object.defineProperty(window, "__bodies", { value: out });
  const tick = () => {
    let n = 0;
    const who = [];
    for (const cv of document.querySelectorAll("canvas.header-scout, canvas.kayolo-canvas")) {
      if (has.get(cv) && cv.width > 0 && seen(cv)) { n++; who.push(cv.classList.contains("header-scout") ? "scout" : cv.closest(".kayolo-slot") ? "slot" : "layer"); }
    }
    for (const st of document.querySelectorAll(".kayolo-slot[data-still] .kayolo-still")) if (seen(st)) { n++; who.push("still"); }
    if (location.pathname !== "/") {
      out.frames++;
      if (n === 0) out.zero++;
    }
    if (n >= 2) { out.two++; if (out.worst.length < 12) out.worst.push(location.pathname + " " + who.join("+")); }
    out.max = Math.max(out.max, n);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

async function oneBody(base, vp, n, pages) {
  const b = await browser();
  try {
    await b.send("Page.enable");
    await b.send("Runtime.enable");
    await b.send("Page.addScriptToEvaluateOnNewDocument", { source: BODY_PROBE });
    await openPage(b, base, "/blocks", vp, false);
    await sleep(6000);
    const trail = [];
    for (let i = 0; i < n; i++) {
      const to = pages[i % pages.length];
      // A client-side transition through the site's own links (the rail, the tab bar, a row).
      const how = await b.evaluate(`(() => {
        const want = ${JSON.stringify(to)};
        const links = [...document.querySelectorAll('a[href]')].filter((a) => {
          const r = a.getBoundingClientRect();
          return a.getAttribute("href") === want && r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight;
        });
        if (links.length) { links[0].click(); return "link"; }
        const a = document.createElement("a");
        a.href = want;
        a.style.position = "fixed"; a.style.left = "0"; a.style.top = "0"; a.style.width = "1px"; a.style.height = "1px";
        document.body.appendChild(a);
        a.click();
        a.remove();
        return "anchor";
      })()`);
      trail.push(`${to}(${how})`);
      // Short and long stays: mid-tour arrivals and arrivals at rest.
      await sleep(i % 3 === 0 ? 900 : i % 3 === 1 ? 2500 : 6000);
    }
    await sleep(3000);
    const r = await b.evaluate("({ ...window.__bodies, at: location.pathname })");
    return { vp: vp.name, transitions: n, trail, ...r };
  } finally {
    b.close();
  }
}

/* ---------- main ---------- */

const proxy = await startProxy();
const base = `http://127.0.0.1:${proxy.address().port}`;
const pages = opt("pages", "/,/blocks,/addresses,/favorites").split(",").map((s) => s.trim()).filter(Boolean);
const vps = opt("vp", "1771x891@1.5").split(",").map(parseVp);
const result = { next: NEXT.href, at: new Date().toISOString(), warmS: WARM / 1000, idleS: IDLE / 1000, idle: [], clicks: [], body: null };

try {
  if (IDLE > 0) {
    for (const vp of vps) {
      for (const path of pages) {
        const [live, hidden] = await Promise.all([idleRun(base, path, vp, false), idleRun(base, path, vp, true)]);
        const delta = {};
        for (const k of Object.keys(live)) if (typeof live[k] === "number" && typeof hidden[k] === "number") delta[k] = +(live[k] - hidden[k]).toFixed(1);
        const row = { vp: vp.name, path, live, hidden, delta };
        result.idle.push(row);
        console.log(
          `${vp.name} ${path}: ΔLayout ${delta.LayoutCount} ΔStyle ${delta.RecalcStyleCount} ΔrAF ${delta.raf} ΔgBCR ${delta.gbcr} Δscript ${delta.ScriptDuration} ms | live beat ${live.beat} loaf ${live.loaf}`
        );
      }
    }
  }
  if (SHOTS) {
    for (const vp of vps) {
      for (const path of pages) {
        const b = await browser();
        try {
          await openPage(b, base, path, vp, false);
          await sleep(WARM);
          const shot = await b.send("Page.captureScreenshot", { format: "png" });
          const file = `${SHOTS}/${vp.width}x${vp.height}${path.replace(/[^a-z0-9]+/gi, "_")}.png`;
          writeFileSync(file, Buffer.from(shot.data, "base64"));
          console.log(`shot ${file}`);
        } finally {
          b.close();
        }
      }
    }
  }
  if (CLICKS) {
    for (const c of CLICK_PLAN(pages)) {
      const r = await oneClick(base, c);
      result.clicks.push(r);
      console.log(`click ${r.vp} ${r.path} ${r.name}: ${r.ok ? "through" : "EATEN"} (over ${r.over}, beat ${r.beat}, under ${r.under})`);
    }
    const block = pages.find((p) => p.startsWith("/block/")) ?? "/blocks";
    result.body = await bodyPoints(base, block);
    console.log(`body points at rest on ${block}: ${JSON.stringify(result.body)}`);
    console.log(`clicks through: ${result.clicks.filter((c) => c.ok).length} of ${result.clicks.length}`);
  }
  if (TAB) {
    const block = pages.find((p) => p.startsWith("/block/")) ?? "/blocks";
    result.tab = await tabOrder(base, block);
    console.log(`tab on ${block}: ${result.tab.seen.join(" → ")} ${result.tab.ok ? "OK" : "WRONG"}`);
  }
  if (BODIES > 0) {
    const route = opt("route", "/transactions,/addresses,/tokens,/blocks,/favorites,/mempool,/,/blocks,/tokens,/addresses").split(",").map((s) => s.trim());
    result.bodies = [];
    for (const vp of vps) {
      const r = await oneBody(base, vp, BODIES, route);
      result.bodies.push(r);
      console.log(`bodies ${vp.name}: ${r.transitions} transitions, ${r.frames} frames, two-body frames ${r.two}, max ${r.max}, zero-body frames ${r.zero}${r.worst.length ? " " + JSON.stringify(r.worst) : ""}`);
    }
  }
} finally {
  proxy.close();
  if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 2));
}
process.exit(0);
