#!/usr/bin/env node
/**
 * Scroll video of a page: DevTools screencast frames while a scripted scroll runs,
 * then a second page (enc.html) replays them into a canvas and MediaRecorder writes mp4.
 * No ffmpeg needed. The snap chromium only sees ~/snap/chromium/common.
 *
 *   node design/sticky/rec.mjs rec.json      (config from gen.py rec …)
 */
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAGE = "/root/snap/chromium/common/sticky";
const PORT = 9333 + Math.floor(Math.random() * 400);
const PROFILE = `${STAGE}/cdp-profile-${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cfg = JSON.parse(readFileSync(process.argv[2], "utf8"));
  mkdirSync(PROFILE, { recursive: true });
  copyFileSync(path.join(HERE, "enc.html"), `${STAGE}/enc.html`);
  const chrome = spawn(
    "/usr/bin/chromium-browser",
    ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--mute-audio",
      `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, "about:blank"],
    { stdio: "ignore" }
  );
  try {
    let ver = null;
    for (let i = 0; i < 60 && !ver; i++) {
      await sleep(250);
      ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null);
    }
    if (!ver) throw new Error("chromium did not open its debug port");
    const page = (await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())).find((t) => t.type === "page");
    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 1024 * 1024 * 1024 });
    await new Promise((res, rej) => {
      ws.once("open", res);
      ws.once("error", rej);
    });
    let seq = 0;
    const pending = new Map();
    const frames = [];
    let recording = false;
    const send = (method, params = {}) =>
      new Promise((res, rej) => {
        const id = ++seq;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
      });
    ws.on("message", (buf) => {
      const msg = JSON.parse(buf.toString());
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      } else if (msg.method === "Page.screencastFrame") {
        const p = msg.params;
        if (recording) frames.push([p.metadata.timestamp, p.data]);
        send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
      }
    });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: cfg.w, height: cfg.h, deviceScaleFactor: cfg.dpr ?? 1, mobile: !!cfg.mobile,
    });
    await send("Emulation.setTouchEmulationEnabled", { enabled: !!cfg.mobile });
    const origin = new URL(cfg.url).origin;
    if (cfg.ls) {
      await send("Page.navigate", { url: `${origin}/robots.txt` });
      await sleep(400);
      const code = Object.entries(cfg.ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("");
      await send("Runtime.evaluate", { expression: code });
    }
    await send("Page.navigate", { url: cfg.url });
    await sleep(cfg.wait ?? 5000);
    if (cfg.inject) await send("Runtime.evaluate", { expression: cfg.inject });
    await send("Runtime.evaluate", { expression: "window.scrollTo({top:0,behavior:'instant'})" });
    await sleep(600);
    const runner = `new Promise((res) => {
      const P = ${JSON.stringify(cfg.path)};
      const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
      const t0 = performance.now();
      const step = () => {
        const t = performance.now() - t0;
        let i = 0;
        while (i < P.length - 1 && t > P[i + 1][0]) i++;
        if (i >= P.length - 1) { window.scrollTo(0, P[P.length - 1][1]); res(1); return; }
        const [ta, ya] = P[i], [tb, yb] = P[i + 1];
        const u = Math.min(1, (t - ta) / Math.max(1, tb - ta));
        window.scrollTo(0, ya + (yb - ya) * ease(u));
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    })`;
    recording = true;
    await send("Page.startScreencast", {
      format: "jpeg", quality: 85, everyNthFrame: 1,
      maxWidth: Math.round(cfg.w * (cfg.dpr ?? 1)), maxHeight: Math.round(cfg.h * (cfg.dpr ?? 1)),
    });
    await send("Runtime.evaluate", { expression: runner, awaitPromise: true });
    await sleep(300);
    await send("Page.stopScreencast");
    recording = false;
    console.log("frames", frames.length, "span", frames.length ? (frames.at(-1)[0] - frames[0][0]).toFixed(2) : 0);
    if (frames.length < 2) throw new Error("no frames");

    // Encode.
    const dims = await (async () => {
      await send("Page.navigate", { url: `file://${STAGE}/enc.html` });
      await sleep(800);
      const r = await send("Runtime.evaluate", {
        expression: `createImageBitmap(new Blob([Uint8Array.from(atob(${JSON.stringify(frames[0][1])}), c => c.charCodeAt(0))], {type:'image/jpeg'})).then(b => [b.width, b.height])`,
        awaitPromise: true, returnByValue: true,
      });
      return r.result.value;
    })();
    for (const [t, d] of frames) await send("Runtime.evaluate", { expression: `window.__f.push([${t}, ${JSON.stringify(d)}])` });
    const w = dims[0] - (dims[0] % 2);
    const h = dims[1] - (dims[1] % 2);
    const out = await send("Runtime.evaluate", {
      expression: `encode('video/mp4;codecs=avc1', ${w}, ${h})`, awaitPromise: true, returnByValue: true,
    });
    const b64 = out.result?.value;
    if (typeof b64 !== "string") throw new Error("encode failed: " + JSON.stringify(out).slice(0, 300));
    writeFileSync(cfg.out, Buffer.from(b64, "base64"));
    console.log("saved", cfg.out, w, "x", h);
    ws.close();
  } finally {
    chrome.kill("SIGTERM");
    await sleep(500);
    rmSync(PROFILE, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
