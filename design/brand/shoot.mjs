#!/usr/bin/env node
/**
 * Screenshots of a running preview through the DevTools protocol (no extra deps: `ws`
 * comes with the repo). Lets a shot set localStorage first (rail collapsed, ink) and
 * emulate a phone. The snap chromium only sees ~/snap/chromium/common, so its profile
 * lives there; the PNGs are written by node wherever `out` says.
 *
 *   node design/brand/shoot.mjs shots.json
 *
 * shots.json: [{ "url", "out", "w", "h", "dpr"?, "mobile"?, "ls"?: {k: v}, "wait"?: ms,
 *               "eval"?: "js run before the shot", "full"?: bool,
 *               "net"?: { latency, downloadThroughput } (throttle before `eval`) }]
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const PORT = 9333 + Math.floor(Math.random() * 400);
const PROFILE = `/root/snap/chromium/common/brand/cdp-profile-${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const shots = JSON.parse(readFileSync(process.argv[2], "utf8"));
  mkdirSync(PROFILE, { recursive: true });
  const chrome = spawn(
    "/usr/bin/chromium-browser",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--mute-audio",
      `--user-data-dir=${PROFILE}`,
      `--remote-debugging-port=${PORT}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  try {
    let ver = null;
    for (let i = 0; i < 60 && !ver; i++) {
      await sleep(250);
      ver = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => null);
    }
    if (!ver) throw new Error("chromium did not open its debug port");
    const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
    const page = targets.find((t) => t.type === "page");
    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
    await new Promise((res, rej) => {
      ws.once("open", res);
      ws.once("error", rej);
    });
    let seq = 0;
    const pending = new Map();
    ws.on("message", (buf) => {
      const msg = JSON.parse(buf.toString());
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    });
    const send = (method, params = {}) =>
      new Promise((res, rej) => {
        const id = ++seq;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
      });
    await send("Page.enable");
    await send("Runtime.enable");
    for (const s of shots) {
      const dpr = s.dpr ?? 1;
      await send("Emulation.setDeviceMetricsOverride", {
        width: s.w,
        height: s.h,
        deviceScaleFactor: dpr,
        mobile: !!s.mobile,
      });
      await send("Emulation.setTouchEmulationEnabled", { enabled: !!s.mobile });
      if (s.media) await send("Emulation.setEmulatedMedia", { features: s.media });
      const origin = new URL(s.url).origin;
      if (s.ls) {
        await send("Page.navigate", { url: `${origin}/robots.txt` });
        await sleep(400);
        const code = Object.entries(s.ls)
          .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
          .join("");
        await send("Runtime.evaluate", { expression: code });
      }
      await send("Page.navigate", { url: s.url });
      await sleep(s.wait ?? 4000);
      if (s.net) {
        // Slow the network after the page is in, so a click shows the wait chrome.
        await send("Network.enable");
        await send("Network.emulateNetworkConditions", { offline: false, uploadThroughput: -1, ...s.net });
      }
      if (s.eval) {
        await send("Runtime.evaluate", { expression: s.eval, awaitPromise: true });
        await sleep(s.after ?? 600);
      }
      const shot = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: !!s.full,
        ...(s.clip ? { clip: { ...s.clip, scale: 1 } } : {}),
      });
      mkdirSync(path.dirname(s.out), { recursive: true });
      writeFileSync(s.out, Buffer.from(shot.data, "base64"));
      console.log("shot", s.out);
      if (s.frames) {
        // A frame strip / clip: `frames` screenshots `every` ms apart, numbered out-000.png …
        for (let i = 0; i < s.frames; i++) {
          await sleep(s.every ?? 100);
          const f = await send("Page.captureScreenshot", { format: "png", ...(s.clip ? { clip: { ...s.clip, scale: 1 } } : {}) });
          writeFileSync(s.out.replace(/\.png$/, `-${String(i).padStart(3, "0")}.png`), Buffer.from(f.data, "base64"));
        }
      }
      if (s.saveEval) {
        const r = await send("Runtime.evaluate", { expression: s.saveEval.expr, awaitPromise: true, returnByValue: true });
        const v = r.result?.value;
        if (typeof v === "string") {
          writeFileSync(s.saveEval.out, Buffer.from(v, "base64"));
          console.log("saved", s.saveEval.out);
        } else {
          console.log("saveEval returned", JSON.stringify(r).slice(0, 300));
        }
      }
    }
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
