"use strict";
var PixelKit = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // apps/web/src/components/pixel.ts
  var pixel_exports = {};
  __export(pixel_exports, {
    PIXEL_ORANGE: () => PIXEL_ORANGE,
    drawPixel: () => drawPixel,
    pixelColor: () => pixelColor,
    pixelInkForPath: () => pixelInkForPath
  });
  var PIXEL_ORANGE = "#ff6a2b";
  var EYE_INK = "#121116";
  var BODY = 26;
  var BASE = { w: 4.2, h: 8.4, dx: 5, dy: -2.2, gx: 0, gy: 0, lid: 0, slant: 0, smile: 0, hL: 1, hR: 1, squash: 0, tilt: 0 };
  var MOODS = {
    idle: {},
    look: { w: 4.6, h: 8.8 },
    happy: { smile: 1, w: 5, dy: -2, squash: 0.04 },
    think: { w: 4.2, h: 7.6, gx: 0.45, gy: -0.75, hL: 0.45, hR: 1.05 },
    surprised: { w: 5.8, h: 11, dy: -3, squash: 0.1 },
    sleepy: { w: 5, h: 7, lid: 0.84, dy: -1, gy: 0.6 },
    sad: { w: 4.4, h: 6.6, lid: 0.14, slant: 0.42, dy: -1, gy: 0.85, squash: -0.07 },
    curious: { w: 4.6, h: 8.6, hL: 0.7, hR: 1.25, gx: 0.8, gy: -0.25, tilt: 0.09 },
    work: { w: 5, h: 4.2, slant: -0.18, gx: 0.6, gy: 0.6 }
  };
  var states = /* @__PURE__ */ new WeakMap();
  function seeded(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) % 1e5 / 1e5;
    };
  }
  function stateOf(ctx, id, now, mood) {
    let m = states.get(ctx.canvas);
    if (!m) {
      m = /* @__PURE__ */ new Map();
      states.set(ctx.canvas, m);
    }
    let s = m.get(id);
    if (!s) {
      const rnd = seeded(Math.floor(now * 1e3) ^ id.length * 7919);
      s = {
        t: now,
        mood,
        moodAt: now,
        f: { ...BASE, ...MOODS[mood] },
        rnd,
        blinkAt: -1e9,
        blinkNext: now + 900 + rnd() * 2400,
        blinkTwice: false,
        glance: { x: 0, y: 0 },
        glanceTo: { x: 0, y: 0 },
        glanceNext: now + 600 + rnd() * 1500,
        smear: 0,
        hopAt: -1e9,
        hopKind: null,
        lastRoll: 0,
        speed: 0,
        wob: rnd() * 1e3
      };
      m.set(id, s);
    }
    return s;
  }
  var clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function blinkCurve(ms, len) {
    if (ms < 0 || ms > len) return 0;
    const u = ms / len;
    return u < 0.4 ? u / 0.4 : 1 - (u - 0.4) / 0.6;
  }
  function hop(ms, kind) {
    const len = kind === "surprised" ? 640 : 560;
    const u = ms / len;
    if (u < 0 || u >= 1) return { y: 0, sq: 0 };
    const high = kind === "surprised" ? 11 : 8;
    if (u < 0.16) return { y: 0, sq: -0.2 * Math.sin(u / 0.16 * (Math.PI / 2)) };
    if (u < 0.72) {
      const a = (u - 0.16) / 0.56;
      return { y: high * Math.sin(a * Math.PI), sq: 0.14 * Math.cos(a * Math.PI) * (a < 0.5 ? 1 : 0.6) };
    }
    if (u < 0.86) return { y: 0, sq: -0.16 * Math.sin((u - 0.72) / 0.14 * Math.PI) };
    return { y: 0, sq: 0.03 * Math.sin((u - 0.86) / 0.14 * Math.PI) };
  }
  function drawPixel(ctx, pose) {
    const now = pose.now ?? performance.now();
    const mood = pose.mood ?? "idle";
    const id = pose.id ?? "main";
    const s = stateOf(ctx, id, now, mood);
    const reduce = !!pose.reduce;
    const dt = clamp(now - s.t, 0, 80);
    s.t = now;
    const rnd = s.rnd;
    const face = (pose.face ?? -1) < 0 ? -1 : 1;
    const scale = pose.scale ?? 1;
    if (mood !== s.mood) {
      if (!reduce && (mood === "happy" || mood === "surprised")) {
        s.hopAt = now;
        s.hopKind = mood;
      }
      if (mood === "surprised") s.blinkNext = now + 1400 + rnd() * 900;
      s.mood = mood;
      s.moodAt = now;
    }
    const target = { ...BASE, ...MOODS[mood] };
    const k = (tau) => reduce ? 1 : 1 - Math.exp(-dt / tau);
    const f = s.f;
    for (const key of Object.keys(target)) {
      const tau = key === "smile" ? 70 : key === "w" || key === "h" ? 90 : key === "lid" || key === "slant" ? 130 : 160;
      f[key] += (target[key] - f[key]) * k(tau);
      if (Math.abs(target[key] - f[key]) < 4e-3) f[key] = target[key];
    }
    const roll = pose.roll ?? 0;
    const v = dt > 0 ? Math.abs(roll - s.lastRoll) / dt * 1e3 : 0;
    s.lastRoll = roll;
    s.speed += (v - s.speed) * (1 - Math.exp(-dt / 120));
    const walking = !reduce && s.speed > 15;
    if (now >= s.blinkNext) {
      s.blinkAt = now;
      s.blinkTwice = rnd() < 0.2;
      const calm = mood === "think" ? 0.6 : mood === "sleepy" ? 1.6 : 1;
      s.blinkNext = now + (1800 + rnd() * 3600) * calm;
    }
    const blinkLen = mood === "sleepy" ? 420 : 150;
    let blink = blinkCurve(now - s.blinkAt, blinkLen);
    if (s.blinkTwice) blink = Math.max(blink, blinkCurve(now - s.blinkAt - blinkLen - 70, blinkLen));
    if (f.smile > 0.6) blink = 0;
    if (!reduce && now >= s.glanceNext) {
      const dart = mood === "think";
      const range = mood === "sleepy" ? 0.25 : dart ? 1 : 0.7;
      s.glanceTo = { x: (rnd() * 2 - 1) * range, y: (rnd() * 2 - 1) * range * (dart ? 0.5 : 0.45) };
      if (mood === "curious" || mood === "work") s.glanceTo.x *= 0.35;
      s.glanceNext = now + (dart ? 260 + rnd() * 520 : mood === "sleepy" ? 2600 + rnd() * 2400 : 900 + rnd() * 2600);
    }
    const gk = 1 - Math.exp(-dt / (mood === "sleepy" ? 380 : 45));
    const gdx = (s.glanceTo.x - s.glance.x) * gk;
    const gdy = (s.glanceTo.y - s.glance.y) * gk;
    s.glance.x += gdx;
    s.glance.y += gdy;
    const gv = dt > 0 ? Math.hypot(gdx, gdy) / dt : 0;
    s.smear += (clamp(gv * 60, 0, 0.42) - s.smear) * (1 - Math.exp(-dt / 40));
    let gx = f.gx * face + face * 0.3;
    let gy = f.gy;
    if (pose.gaze) {
      gx += pose.gaze.x;
      gy += pose.gaze.y;
    } else if (!reduce) {
      gx += s.glance.x;
      gy += s.glance.y;
    }
    if (pose.look) gx += face * clamp(pose.look, -2.2, 2.2) / 2.4;
    if (pose.pupilOrbit) {
      gx += Math.cos(pose.pupil ?? 0) * pose.pupilOrbit * face / 1.9;
      gy += Math.sin(pose.pupil ?? 0) * pose.pupilOrbit / 2.6;
    }
    const apart = clamp(pose.eyesApart ?? 0, 0, 1);
    gy -= apart * 0.9 + (pose.eyeLift ?? 0) * 0.22;
    gx = clamp(gx, -1.4, 1.4);
    gy = clamp(gy, -1.2, 1.2);
    const hp = s.hopKind && !reduce ? hop(now - s.hopAt, s.hopKind) : { y: 0, sq: 0 };
    if (s.hopKind && now - s.hopAt > 700) s.hopKind = null;
    const pick = clamp(pose.pick ?? 0, 0, 1);
    let sq = f.squash + hp.sq - pick * 0.12 - apart * 0.32;
    let lift = hp.y * scale;
    if (walking) {
      const ph = roll * 0.42;
      lift += Math.abs(Math.sin(ph)) * 2.2 * scale;
      sq += 0.07 * Math.abs(Math.sin(ph)) - 0.05;
    }
    if (!reduce && mood === "sleepy") sq += 0.035 * Math.sin(now / 900);
    else if (!reduce) sq += 0.012 * Math.sin(now / 640 + s.wob);
    let tilt = f.tilt * face + face * (pose.head ?? 0) * 0.2 + face * pick * 0.16;
    if (!reduce && mood === "think") tilt += 0.05 * Math.sin((now + s.wob) / 260) + 0.02 * Math.sin(now / 97);
    if (!reduce && mood === "sleepy") {
      const nod = (now + s.wob * 7) % 4200 / 4200;
      tilt += face * (nod < 0.85 ? 0.07 * (nod / 0.85) : 0.07 * (1 - (nod - 0.85) / 0.15));
    }
    if (reduce) tilt = f.tilt * face;
    const sy = clamp(1 + sq, 0.5, 1.4);
    const sx = 1 / Math.sqrt(sy);
    const bw = BODY * scale * sx;
    const bh = BODY * scale * sy;
    const u = bw / 24;
    const vu = bh / 24;
    const color = pose.color || PIXEL_ORANGE;
    ctx.save();
    ctx.translate(pose.x + face * pick * 2 * scale, pose.y - lift);
    ctx.rotate(tilt);
    ctx.fillStyle = color;
    ctx.fillRect(-bw / 2, -bh, bw, bh);
    const es = pose.eyeScale ?? 1;
    const smear = reduce ? 0 : s.smear;
    const ew = f.w * (es > 1 ? Math.sqrt(es) : 1) * (1 + apart * 0.15) * (1 + smear);
    const ehBase = f.h * es * (1 - apart * 0.35) * (1 - smear * 0.45);
    const cy0 = -bh / 2 + f.dy * vu + gy * 1.9 * vu;
    for (const side of [-1, 1]) {
      const cx = side * f.dx * u + gx * 2.3 * u;
      const hMul = side === -face ? f.hL : f.hR;
      const eh = Math.max(1.1, ehBase * hMul * (1 - blink * 0.9));
      const w = ew * u;
      const h = eh * vu;
      const left = clamp(cx - w / 2, -bw / 2 + 1.6 * u, bw / 2 - 1.6 * u - w);
      const bottom = clamp(cy0 + ehBase * hMul * vu / 2, -bh + 2 * vu + h, -1.6 * vu);
      const top = bottom - h;
      const open = 1 - clamp(f.smile, 0, 1);
      if (open > 0.04) {
        ctx.globalAlpha = open;
        ctx.fillStyle = EYE_INK;
        ctx.fillRect(left, top, w, h);
        const lid = clamp(f.lid, 0, 1);
        if (lid > 0.01 || Math.abs(f.slant) > 0.01) {
          const outer = clamp(lid + f.slant * 0.5, 0, 1) * h;
          const inner = clamp(lid - f.slant * 0.5, 0, 1) * h;
          const lCut = side < 0 ? outer : inner;
          const rCut = side < 0 ? inner : outer;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(left - 0.5, top - 0.5);
          ctx.lineTo(left + w + 0.5, top - 0.5);
          ctx.lineTo(left + w + 0.5, top + rCut);
          ctx.lineTo(left - 0.5, top + lCut);
          ctx.closePath();
          ctx.fill();
        }
      }
      if (f.smile > 0.04) {
        ctx.globalAlpha = clamp(f.smile, 0, 1);
        ctx.strokeStyle = EYE_INK;
        ctx.lineWidth = 2.4 * u;
        ctx.lineCap = "butt";
        ctx.lineJoin = "miter";
        const r = ew * 0.62 * u;
        const ay = cy0 + 0.6 * vu;
        ctx.beginPath();
        ctx.moveTo(cx - r, ay + r * 0.62);
        ctx.lineTo(cx, ay - r * 0.5);
        ctx.lineTo(cx + r, ay + r * 0.62);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (mood === "sad" && f.lid > 0.12 && !reduce) {
      const cyc = 3200;
      const t = (now - s.moodAt + 2760) % cyc / cyc;
      if (t < 0.55) {
        const tx = face * f.dx * u + gx * 2.3 * u;
        const ty = cy0 + (f.h * 0.5 + 0.6) * vu + t / 0.55 * (bh * 0.42);
        const ts = 1.8 * u;
        ctx.globalAlpha = t < 0.45 ? 1 : 1 - (t - 0.45) / 0.1;
        ctx.fillStyle = "#5b8dff";
        ctx.fillRect(tx - ts / 2, Math.min(ty, -ts - 0.5 * vu), ts, ts * 1.3);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
    if (mood === "sleepy" && f.lid > 0.5) {
      ctx.save();
      ctx.fillStyle = color;
      for (let i = 0; i < 3; i++) {
        const cyc = 2600;
        const t = reduce ? 0.35 + i * 0.22 : (now + i * (cyc / 3)) % cyc / cyc;
        const a = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
        const size = (1.6 + t * 1.6) * scale * 1.3;
        const px = pose.x + face * (bw * 0.42 + t * 9 * scale) + Math.sin(t * 6 + i) * 2 * scale;
        const py = pose.y - lift - bh - 2 * scale - t * 16 * scale;
        ctx.globalAlpha = clamp(a, 0, 1) * 0.85;
        ctx.fillRect(px - size / 2, py - size / 2, size, size);
      }
      ctx.restore();
    }
  }
  function pixelInkForPath(path) {
    if (/^\/(block|blocks)(\/|$)/.test(path)) return "block";
    if (/^\/(tx|transactions|mempool)(\/|$)/.test(path)) return "tx";
    if (/^\/(address|addresses|names|favorites|richlist)(\/|$)/.test(path)) return "addr";
    if (/^\/(token|tokens|nfts|defi)(\/|$)/.test(path)) return "token";
    if (/^\/(box|rent)(\/|$)/.test(path)) return "box";
    return "brand";
  }
  function pixelColor(ink) {
    if (typeof document === "undefined") return PIXEL_ORANGE;
    const name = ink === "brand" ? "--brand-new" : `--ent-${ink}`;
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || PIXEL_ORANGE;
  }
  return __toCommonJS(pixel_exports);
})();
