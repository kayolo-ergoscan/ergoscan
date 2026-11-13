"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import {
  adoptPixelState,
  drawPixel,
  pixelColor,
  pixelInkForPath,
  pixelState,
  pixelWake,
  type PixelMood,
  type PixelPose,
} from "@/components/pixel";
import { INK_EVENT } from "@/lib/skin-ink";
import { onKayolo, say, type BodyWhere } from "@/lib/kayolo/events";
import {
  arrivalOf,
  bodyOwner,
  currentMode,
  endIntro,
  introPendingNow,
  onChoice,
  onSlotPlace,
  setKeeper,
  setOwner,
  slotPlace,
  type Keeper,
} from "@/lib/kayolo/body";
import { createScheduler, levelAt, type Level, type Prio } from "@/lib/kayolo/scheduler";
import { makeAct, step, type Act, type ActName, type PoseDelta, type Vec } from "@/lib/kayolo/acts";
import { gazeTo, nookPoint, pageKind, parkPoint, tipPoint, wideLayout } from "@/lib/kayolo/anchors";
import { pageMemory, readHome, welcomeFor, type Mode, type Welcome } from "@/lib/kayolo/memory";
import { COARSE_QUERY, REDUCE_QUERY, WIDE_QUERY } from "@/lib/kayolo/motion";
import * as K from "@/lib/kayolo/thresholds";

/**
 * Kayolo's engine (design/brand/kayolo-life.md §2, §8.3, §9.1, §9.4, §9.10), loaded after idle. It
 * holds the body whenever the header scout has parked it (M1, §9.8): in his window at home (the
 * niche on the desktop, the window in the pill on the phone), and in a fixed layer at the Addresses
 * door or a note. There he lives:
 * calm → reads → dozes → sleeps after 3 min without input, and wakes with «noticed»; he answers
 * every block by the §8.3 matrix and is poked from his window. One rAF and one timer at most; a frame
 * only while something has to change (an act, a blink, a level edge); none in the frozen sleep.
 */

/** Body canvas: 56×64 CSS px, ground point at (28, 58). */
const W = 56;
const H = 64;
const GX = 28;
const GY = 58;
const HAND_EASE_MS = 400;
const FADE_MS = 150;
/** «Спрятан» → back: the seed grows into him (§4.6). */
const GROW_MS = 420;
/** «С возвращением» waits for the first pause (§5). */
const WELCOME_PAUSE_MS = 1200;
/** Eyes on the content at home (§2.6: gy +0.4). */
const CONTENT_LIFT = -1.8;

type Hold = { where: BodyWhere; x: number; y: number; face: 1 | -1 };
type Running = { act: Act; at: number; key: string; prio: Prio; flip: boolean };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const smooth = (u: number) => {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
};

function local() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const SHADOW: Record<BodyWhere, { a: number; rx: number; ry: number }> = {
  nook: { a: 0.2, rx: 12, ry: 2.1 },
  park: { a: 0.2, rx: 12, ry: 2.1 },
  door: { a: 0.16, rx: 11, ry: 2 },
  note: { a: 0.18, rx: 12, ry: 2.1 },
};

const HOP_MOODS: ReadonlySet<PixelMood> = new Set<PixelMood>(["happy", "surprised"]);

function createEngine(layerBody: HTMLElement, layerCanvas: HTMLCanvasElement) {
  let path = window.location.pathname;
  let hold: Hold | null = null;
  let drawnOn: HTMLCanvasElement | null = null;
  let color = pixelColor(pixelInkForPath(path));
  let handed: { pose: Partial<PixelPose>; at: number } | null = null;
  let reduceSys = window.matchMedia(REDUCE_QUERY).matches;
  let mode: Mode = currentMode();
  const sched = createScheduler(performance.now());
  sched.mode(mode);
  let running: Running | null = null;
  let after: ActName | null = null;
  let pokeQueued: ActName | null = null;
  let pokeN = 0;
  let pokeAt = -1e9;
  /** A block or a rare height woke him from sleep: he is alert from here (input is not reset). */
  let wokeAt = -Infinity;
  let gaze: Vec | null = null;
  let gazeUntil = 0;
  let gazeAt = -1e9;
  let gazePt: Vec | null = null;
  let shy = false;
  let lastMove: Vec | null = null;
  let walk: { fromX: number; toX: number; y: number; fromY?: number; at: number; ms: number; roll0: number } | null = null;
  /** The seed grows back into him (from «Спрятан»). */
  let grow: number | null = null;
  /** «С возвращением», once per load (§5). */
  let welcome: Welcome = welcomeFor(pageMemory().lastBefore(), Date.now());
  /** The introduction runs (§5): input cuts it short. */
  let introRun = false;
  /** Phone: a plate docked under the pill; he sits lower and does not hop (§3.2). */
  let docked = false;
  let dockRaf = 0;
  let fade: { at: number; from: Vec; to: Hold } | null = null;
  let roll = 0;
  let raf = 0;
  let paintedAt = -Infinity;
  let timer = 0;
  let timerAt = Infinity;
  let hidden = document.visibilityState === "hidden";
  let hiddenAt = 0;
  let hiddenSince = 0;
  let boxAt = { x: NaN, y: NaN };
  let dead = false;

  /** Quiet motion: «Тихий», or the system asks for less and «Живой» was not chosen (§10). */
  const actReduce = () => mode === "calm" || (reduceSys && mode !== "live");
  const pixelReduce = () => reduceSys && mode !== "live";
  const phone = () => !wideLayout();

  /** The canvas in the window of the layout that is on (desktop niche or phone pill). */
  const slotCanvas = () =>
    slotPlace()?.el?.querySelector<HTMLCanvasElement>("canvas.kayolo-canvas") ??
    document.querySelector<HTMLCanvasElement>(".kayolo-slot canvas.kayolo-canvas");

  /** Where the body is drawn now: his window at home, the layer on a path or away. */
  const canvasFor = (h: Hold): HTMLCanvasElement | null => {
    const cv = h.where === "nook" && !walk && !fade ? (slotCanvas() ?? layerCanvas) : layerCanvas;
    // The perf script's «hidden» run cuts the canvas loose: then he is simply not drawn.
    return cv.parentElement ? cv : null;
  };

  const ctxOf = (cv: HTMLCanvasElement) => cv.getContext("2d");

  const size = (cv: HTMLCanvasElement) => {
    const dpr = Math.min(window.matchMedia(COARSE_QUERY).matches ? 1.5 : 2, window.devicePixelRatio || 1);
    const w = Math.round(W * dpr);
    const h = Math.round(H * dpr);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    return dpr;
  };

  const clear = (cv: HTMLCanvasElement | null) => {
    if (!cv) return;
    const ctx = ctxOf(cv);
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
  };

  /** The same face moves from canvas to canvas (§9.7): no jump at the switch. */
  const switchTo = (cv: HTMLCanvasElement) => {
    if (drawnOn === cv) return;
    const from = drawnOn ? ctxOf(drawnOn) : null;
    const st = from ? pixelState(from, "main") : null;
    clear(drawnOn);
    const to = ctxOf(cv);
    if (to && st) adoptPixelState(to, "main", st);
    drawnOn = cv;
  };

  const placeLayer = (x: number, y: number) => {
    const lx = Math.round((x - GX) * 2) / 2;
    const ly = Math.round((y - GY) * 2) / 2;
    if (lx === boxAt.x && ly === boxAt.y) return;
    boxAt = { x: lx, y: ly };
    layerBody.style.transform = `translate3d(${lx}px, ${ly}px, 0)`;
  };

  const bodyAt = (): Vec | null => {
    if (!hold) return null;
    if (hold.where === "nook" && !walk) {
      const s = slotPlace();
      return s ? { x: s.x, y: s.y - 11 } : null;
    }
    return { x: hold.x, y: hold.y - 11 };
  };

  const homeHold = (): Hold | null => {
    const s = slotPlace();
    if (s) return { where: "nook", x: s.x, y: s.y, face: s.face };
    if (phone()) {
      // No window in the pill (yet): the old park past the search word.
      const p = parkPoint();
      return p ? { where: "park", x: p.x, y: p.y, face: p.face } : null;
    }
    const n = nookPoint(readHome(local) ?? "r");
    return n ? { where: "nook", x: n.x, y: n.y, face: n.face } : null;
  };

  /* ---------------- the level and the resting pose ---------------- */

  const since = (now: number) => Math.min(sched.sinceInput(now), now - wokeAt);

  const levelNow = (now: number): { lv: Level; inLv: number } => {
    if (mode === "asleep") return { lv: 4, inLv: Infinity };
    const s = since(now);
    let lv = levelAt(s);
    const dense = pageKind(path) === "d";
    if (dense && lv < 2 && s >= 20_000) lv = 2;
    const edge = [0, K.A1_MS, dense ? Math.min(20_000, K.A2_MS) : K.A2_MS, K.A3_MS, K.A4_MS][lv];
    return { lv, inLv: s - edge };
  };

  /** A2: the eyes read the content, 4 sweeps of 2.4 s with pauses. */
  const SWEEP = 2400;
  const SWEEP_GAP = 2200;
  const reading = (inLv: number) => {
    const pass = Math.floor(inLv / (SWEEP + SWEEP_GAP));
    if (pass >= 4) return { look: 0, moving: false, next: Infinity };
    const tt = inLv - pass * (SWEEP + SWEEP_GAP);
    if (tt < SWEEP) return { look: -1.2 + 2.4 * smooth(tt / SWEEP), moving: true, next: 0 };
    return { look: 1.2, moving: false, next: (pass + 1) * (SWEEP + SWEEP_GAP) - inLv };
  };

  const restPose = (now: number, face: 1 | -1): Partial<PixelPose> => {
    const { lv, inLv } = levelNow(now);
    if (lv === 0) {
      return {
        mood: "idle",
        eyeLift: CONTENT_LIFT,
        gaze: now < gazeUntil ? gaze : null,
        head: shy ? -0.2 : 0,
      };
    }
    if (lv === 1) return { mood: "idle", eyeLift: CONTENT_LIFT, glanceGap: 1.6, glanceRange: 0.86 };
    if (lv === 2) {
      const r = reading(inLv);
      return { mood: "work", glances: false, look: face * r.look, eyeLift: -1 };
    }
    if (lv === 3) {
      return { mood: "sleepy", doze: 0.55 * smooth(inLv / 1200), nod: inLv < 4200 ? 1 : 0, breath: 0, zzz: false, glances: false };
    }
    const zzz = inLv < K.ZZZ_MS && mode !== "asleep";
    return { mood: "sleepy", doze: 0.92, nod: 0, breath: zzz ? 1 : 0, zzz: zzz ? true : "one", glances: false };
  };

  /* ---------------- acts ---------------- */

  const targetFor = (name: ActName): Vec | null => {
    const body = bodyAt();
    if (!body) return null;
    if (name === "poke1" || name === "notice" || name === "pleased" || name === "pet" || name === "wakeUp") return null;
    if (name === "intro" || name === "welcome3") {
      const t = document.querySelector('header [data-scout="title"]')?.getBoundingClientRect();
      if (t && t.width > 2) return gazeTo(body, { x: t.left + t.width / 2, y: t.top + t.height / 2 });
    }
    const tip = tipPoint();
    return tip ? gazeTo(body, tip) : null;
  };

  const startAct = (name: ActName, now: number, key: string, prio: Prio) => {
    if (!hold) return;
    const act = makeAct(name, { reduce: actReduce(), target: targetFor(name), rest: { x: 0, y: 0 }, face: hold.face, rnd: Math.random });
    running = { act, at: now, key, prio, flip: true };
  };

  /** A person's action (a poke, a notice): at once, through the attention window. */
  const human = (name: ActName, now: number, key: string) => {
    sched.offer({ key, prio: 1, ttlMs: 1000, ladder: [step(name)] }, now);
    const p = sched.next(now);
    if (p) startAct(name, now, key, 1);
  };

  const wakeFrom = (lv: Level, now: number) => {
    if (lv < 2) return;
    const name: ActName = lv === 2 ? "wakeSmall" : lv === 3 ? "wakeDoze" : "wakeSleep";
    // A person woke him (P2): the scheduler knows the act, so a block meanwhile is dropped (§2.8).
    sched.done();
    sched.offer({ key: "wake", prio: 2, ttlMs: 1000, ladder: [step(name)] }, now);
    sched.next(now);
    after = null;
    startAct(name, now, "wake", 2);
  };

  /** The introduction is over: the tour may follow (only if it ran to the end). */
  const finishIntro = (whole: boolean) => {
    if (!introRun) return;
    introRun = false;
    endIntro();
    say({ k: "kayolo:intro-done", tour: whole });
  };

  const startIntro = (now: number) => {
    introRun = true;
    sched.offer({ key: "intro", prio: 2, ttlMs: 1000, ladder: [step("intro")] }, now);
    sched.next(now);
    startAct("intro", now, "intro", 2);
  };

  /** Pull what the scheduler lets him do now. */
  const pump = (now: number) => {
    if (running && now - running.at >= running.act.ms) {
      if (running.act.name === "intro") finishIntro(true);
      running = null;
      if (after) {
        const next = after;
        after = null;
        startAct(next, now, "after", 4);
      }
    }
    if (pokeQueued && (!running || (running.key === "poke" && now - running.at >= K.POKE_NEXT_AT * running.act.ms))) {
      const name = pokeQueued;
      pokeQueued = null;
      human(name, now, "poke");
    }
    if (welcome !== "none" && hold && !running && !introRun && bodyOwner() === "kayolo" && sched.sinceInput(now) >= WELCOME_PAUSE_MS) {
      const name: ActName = welcome === "notice" ? "welcome1" : welcome === "hop" ? "welcome2" : "welcome3";
      welcome = "none";
      sched.offer({ key: "welcome", prio: 4, ttlMs: 8000, ladder: [step(name), step("welcome1")] }, now);
    }
    const play = running ? null : sched.next(now);
    if (play && hold) {
      const name = play.step.act as ActName;
      if (play.wake) {
        wokeAt = now;
        // Awake now for the scheduler too: the next block reads A0, not A4 (no second "wake").
        sched.inputAt(now);
        startAct("wake", now, play.key, play.prio);
        after = name;
      } else startAct(name, now, play.key, play.prio);
    }
  };

  const poseAt = (now: number, face: 1 | -1, ctx: CanvasRenderingContext2D): PixelPose => {
    const rest = restPose(now, face);
    const pose: PixelPose = { x: GX, y: GY, ...rest };
    if (handed) {
      const k = 1 - smooth((now - handed.at) / HAND_EASE_MS);
      if (k <= 0) handed = null;
      else {
        const h = handed.pose;
        pose.look = (pose.look ?? 0) * (1 - k) + (h.look ?? 0) * k;
        pose.head = (pose.head ?? 0) * (1 - k) + (h.head ?? 0) * k;
        pose.pick = (h.pick ?? 0) * k;
        pose.eyeLift = (pose.eyeLift ?? 0) * (1 - k) + (h.eyeLift ?? 0) * k;
        pose.eyeScale = 1 + ((h.eyeScale ?? 1) - 1) * k;
        pose.pupil = h.pupil;
        pose.pupilOrbit = (h.pupilOrbit ?? 0) * k;
        pose.eyesApart = (h.eyesApart ?? 0) * k;
      }
    }
    let flip = false;
    if (running) {
      const d: PoseDelta = running.act.at(now - running.at);
      if (d.mood) {
        let m = d.mood;
        // A hop comes with the switch to happy or surprised: from the same face, step out of it first.
        if (running.flip && HOP_MOODS.has(m) && pixelState(ctx, "main")?.mood === m) m = "pleased";
        pose.mood = m;
      }
      running.flip = false;
      if (d.gaze !== undefined) pose.gaze = d.gaze;
      if (d.head != null) pose.head = (pose.head ?? 0) + d.head;
      if (d.pick != null) pose.pick = d.pick;
      if (d.eyeScale != null) pose.eyeScale = d.eyeScale;
      if (d.eyeLift != null) pose.eyeLift = (pose.eyeLift ?? 0) + d.eyeLift;
      if (d.squash != null) pose.squash = d.squash;
      if (d.wink != null) pose.wink = d.wink;
      if (d.doze !== undefined) pose.doze = d.doze;
      if (d.zzz !== undefined) pose.zzz = d.zzz;
      flip = !!d.flip;
      if (d.mood && d.mood !== "sleepy") {
        pose.doze = d.doze;
        pose.nod = 0;
      }
    }
    pose.face = flip ? -face : face;
    return pose;
  };

  /* ---------------- frames ---------------- */

  const nextDue = (now: number, ctx: CanvasRenderingContext2D | null): number => {
    if (!hold || hidden) return Infinity;
    if (grow != null) return now;
    if (mode === "hidden") return Infinity;
    let due = sched.nextDue(now);
    if (running || after || pokeQueued || walk || fade) return now;
    if (handed) return now;
    if (gaze) due = Math.min(due, gazeUntil);
    const quietFor = sched.sinceInput(now);
    if (welcome !== "none" && quietFor < WELCOME_PAUSE_MS) due = Math.min(due, now + WELCOME_PAUSE_MS - quietFor);
    // Dense pages start reading at 20 s, before the scheduler's own A2 edge (§2.2).
    if (pageKind(path) === "d" && since(now) < 20_000) due = Math.min(due, now + 20_000 - since(now));
    const { lv, inLv } = levelNow(now);
    // Paced frames count from the last painted one, not from now: a timer that wakes early must
    // land on a frame, not push the frame forward again. Reading and dozing (A2–A3) are drawn at
    // 20 fps: ≤ 300 frames a minute (§9.10). The face eases by time, so the sweeps, blinks and the
    // sleepy nod keep their speed.
    const slow = paintedAt + 1000 / K.REST_FPS;
    if (lv === 2) {
      const r = reading(inLv);
      if (r.moving) return Math.max(paintedAt + 1000 / K.GAZE_FPS, slow);
      due = Math.min(due, now + r.next);
    } else if (lv === 3 && inLv < 4200) return slow;
    else if (lv === 4 && mode !== "asleep") {
      if (inLv < K.ZZZ_MS) return paintedAt + 1000 / K.ZZZ_FPS;
      if (inLv < K.ZZZ_MS + 500) return paintedAt + 100;
      return due;
    } else if (mode === "asleep") {
      // The eyes finish closing, then not a frame more (§4.6).
      return ctx ? Math.min(due, pixelWake(ctx, "main")) : due;
    }
    if (ctx) due = Math.min(due, pixelWake(ctx, "main"));
    return lv >= 2 ? Math.max(due, slow) : due;
  };

  const frame = () => {
    if (!raf && !dead && !hidden) raf = requestAnimationFrame(paint);
  };

  const schedule = (due: number, now: number) => {
    if (!Number.isFinite(due)) return;
    if (due - now <= 34) {
      frame();
      return;
    }
    if (timer && timerAt <= due) return;
    if (timer) window.clearTimeout(timer);
    timerAt = due;
    timer = window.setTimeout(() => {
      timer = 0;
      timerAt = Infinity;
      tick();
    }, Math.max(0, due - now - 16));
  };

  /** A timer fired: paint if something is due, else wait for the new due time. */
  const tick = () => {
    if (dead || hidden || !hold) return;
    const now = performance.now();
    const ctx = drawnOn ? ctxOf(drawnOn) : null;
    const due = nextDue(now, ctx);
    if (due - now <= 34) frame();
    else schedule(due, now);
  };

  const kick = () => {
    if (!hold || hidden) return;
    const now = performance.now();
    pump(now);
    schedule(nextDue(now, drawnOn ? ctxOf(drawnOn) : null), now);
  };

  function paint(now: number) {
    raf = 0;
    if (dead || !hold || hidden) return;
    paintedAt = now;
    pump(now);
    let x = hold.x;
    let y = hold.y;
    let face = hold.face;
    let alpha = 1;
    if (walk) {
      const u = Math.min(1, (now - walk.at) / walk.ms);
      x = walk.fromX + (walk.toX - walk.fromX) * smooth(u);
      y = walk.fromY == null ? walk.y : walk.fromY + (walk.y - walk.fromY) * smooth(u);
      roll = walk.roll0 + Math.abs(x - walk.fromX) * 0.55;
      face = walk.toX >= walk.fromX ? 1 : -1;
      if (u >= 1) walk = null;
    } else if (hold.where === "nook") {
      const s = slotPlace();
      if (s) {
        x = s.x;
        y = s.y;
      }
    }
    if (fade) {
      const u = (now - fade.at) / FADE_MS;
      if (u < 1) {
        alpha = 1 - smooth(u);
        x = fade.from.x;
        y = fade.from.y;
      } else {
        hold = fade.to;
        x = hold.x;
        y = hold.y;
        face = hold.face;
        alpha = smooth(u - 1);
        if (u >= 2) fade = null;
      }
    }
    const cv = canvasFor(hold);
    if (!cv) return;
    switchTo(cv);
    if (cv === layerCanvas) placeLayer(x, y);
    const dpr = size(cv);
    const ctx = ctxOf(cv);
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (mode === "hidden") {
      // «Спрятан»: a seed of his colour, no eyes, no frames.
      ctx.fillStyle = color;
      ctx.fillRect(GX - 4, GY - 8, 8, 8);
      return;
    }
    if (grow != null) {
      // Back from «Спрятан»: the seed grows into his square, then the eyes open (420 ms).
      const u = (now - grow) / GROW_MS;
      if (u < 1) {
        const side = 8 + (22.36 - 8) * smooth(u);
        ctx.fillStyle = color;
        ctx.fillRect(GX - side / 2, GY - side, side, side);
        frame();
        return;
      }
      grow = null;
    }
    const sh = SHADOW[hold.where];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = `rgba(0,0,0,${sh.a})`;
    ctx.beginPath();
    ctx.ellipse(GX, GY + 1, sh.rx, sh.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const pose = poseAt(now, face, ctx);
    if (gaze && now >= gazeUntil) {
      gaze = null;
      gazePt = null;
    }
    const calmHop = actReduce() || docked ? { hopScale: 0 } : phone() ? K.PHONE_HOP : {};
    if (docked && !actReduce()) pose.squash = (pose.squash ?? 0) - 0.06;
    drawPixel(ctx, {
      ...pose,
      ...calmHop,
      x: GX,
      y: GY,
      scale: K.BODY_SCALE,
      color,
      now,
      roll,
      alpha,
      reduce: pixelReduce(),
      id: "main",
    });
    schedule(nextDue(now, ctx), now);
  }

  /* ---------------- the hand-over (§9.8 M1) ---------------- */

  const drop = () => {
    clear(drawnOn);
    clear(slotCanvas());
    drawnOn = null;
    hold = null;
    running = null;
    after = null;
    walk = null;
    fade = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (timer) window.clearTimeout(timer);
    timer = 0;
    timerAt = Infinity;
  };

  const usable = () => mode !== "off" && path !== "/";

  /** Nobody draws him (no tour, reduced motion, back from home): he is simply at home. */
  const takeHome = () => {
    if (dead || hold || bodyOwner() !== "none" || !usable()) return;
    const h = homeHold();
    if (!h) return;
    const probe = canvasFor(h);
    if (!probe) return;
    hold = h;
    setOwner("kayolo");
    say({ k: "kayolo:took", where: h.where });
    const now = performance.now();
    // The very first visit: he wakes up in his window and meets the person before the tour (§5).
    if (introPendingNow() && arrivalOf(path)?.intro && mode === "live") startIntro(now);
    paint(now);
  };

  const keeper: Keeper = {
    take(p) {
      if (dead || !usable()) return false;
      const h: Hold = { where: p.where, x: p.x, y: p.y, face: p.face };
      const cv = canvasFor(h);
      if (!cv) return false;
      drop();
      hold = h;
      if (p.color) color = p.color;
      handed = p.pose ? { pose: p.pose, at: performance.now() } : null;
      const ctx = ctxOf(cv);
      if (ctx && p.state) adoptPixelState(ctx, "main", p.state);
      drawnOn = cv;
      if (h.where === "nook") {
        // His window stands where the scout parked him (on the phone a few px higher, in the pill).
        const s = slotPlace();
        if (s && (Math.abs(s.x - p.x) > 1.5 || Math.abs(s.y - p.y) > 0.5)) {
          const ms = Math.max(Math.abs(s.y - p.y) > 0.5 ? 220 : 0, (Math.abs(s.x - p.x) / K.STEP_PX_S) * 1000);
          walk = { fromX: p.x, toX: s.x, y: s.y, fromY: p.y, at: performance.now(), ms, roll0: roll };
          switchTo(layerCanvas);
        }
      }
      paint(performance.now());
      return true;
    },
    move(p) {
      if (!hold || hold.where === "nook") return;
      hold.x = p.x;
      hold.y = p.y;
      if (p.face) hold.face = p.face;
      if (drawnOn === layerCanvas && !walk && !fade) placeLayer(p.x, p.y);
    },
    give() {
      if (!hold) return null;
      const now = performance.now();
      const ctx = drawnOn ? ctxOf(drawnOn) : null;
      const state = ctx ? pixelState(ctx, "main") : null;
      let x = hold.x;
      let y = hold.y;
      if (hold.where === "nook") {
        const s = slotPlace();
        if (s) {
          x = s.x;
          y = s.y;
        }
      }
      if (walk) {
        const u = Math.min(1, (now - walk.at) / walk.ms);
        x = walk.fromX + (walk.toX - walk.fromX) * smooth(u);
        if (walk.fromY != null) y = walk.fromY + (walk.y - walk.fromY) * smooth(u);
      }
      if (introRun) finishIntro(false);
      const out = { x, y, face: hold.face, where: hold.where, state, color };
      drop();
      return out;
    },
    where() {
      return hold?.where ?? null;
    },
    home() {
      if (!hold) return;
      const h = homeHold();
      if (!h) {
        drop();
        setOwner("none");
        return;
      }
      if (h.where === hold.where && Math.abs(h.x - hold.x) < 2 && Math.abs(h.y - hold.y) < 2) return;
      running = null;
      after = null;
      let from: Vec = { x: hold.x, y: hold.y };
      let gone = false;
      if (hold.where === "nook") {
        // The window he leaves; after a layout change it is hidden (a zero rect): no fade-out there.
        const el = drawnOn?.closest(".kayolo-slot");
        const r = el?.getBoundingClientRect();
        if (r && r.width > 0) from = { x: r.left + r.width / 2, y: r.bottom - 6 };
        else gone = true;
      }
      const now = performance.now();
      fade = { at: gone ? now - FADE_MS : now, from, to: h };
      frame();
    },
  };

  /* ---------------- what he answers ---------------- */

  const onBlock = (height: number, kind: "empty" | "normal" | "big", now: number) => {
    const page = pageKind(path);
    let ladder: ActName[];
    let prio: Prio = 5;
    let ttl = K.TTL_E1;
    let wakes = false;
    if (kind === "empty") {
      ladder = ["shrug"];
      ttl = K.TTL_E2;
    } else if (kind === "big") {
      prio = 4;
      ttl = K.TTL_E3;
      wakes = true;
      ladder = page === "d" ? ["hopSurprised", "nod", "glance"] : ["bigBlock", "hopSurprised", "nod", "glance"];
    } else {
      ladder = page === "b" ? ["hopGlance", "nodGlance", "glance"] : page === "n" ? ["nodGlance", "glance"] : ["glance"];
    }
    sched.offer({ key: `h${height}`, prio, ttlMs: ttl, ladder: ladder.map(step), wakes, stir: step("stir") }, now);
  };

  const onPoke = (now: number) => {
    const gap = now - pokeAt;
    pokeAt = now;
    if (gap >= K.POKE_RESET_MS) pokeN = 1;
    else if (gap <= K.POKE_CHAIN_MS) pokeN += 1;
    else pokeN = Math.max(1, pokeN);
    const name: ActName = pokeN === 1 ? "poke1" : pokeN === 2 ? "poke2" : pokeN === 3 ? "poke3" : "blink2";
    pageMemory().poke();
    if (running && (running.key === "wake" || (running.key === "poke" && now - running.at < K.POKE_NEXT_AT * running.act.ms))) {
      pokeQueued = name;
      return;
    }
    after = null;
    human(name, now, "poke");
  };

  const offBus = onKayolo((ev) => {
    if (dead) return;
    const now = performance.now();
    if (ev.k === "chain:block") {
      if (!K.KAYOLO_CHAIN || !hold) return;
      onBlock(ev.height, ev.kind, now);
    } else if (ev.k === "chain:rare") {
      if (!hold) return;
      sched.offer({ key: `r${ev.height}`, prio: 4, ttlMs: K.TTL_RARE, ladder: (["rare", "nod", "glance"] as ActName[]).map(step), wakes: true, stir: step("stir") }, now);
    } else if (ev.k === "ui:poke") {
      if (!hold) return;
      // A click is input too: from a doze he wakes first, then the poke.
      onPoke(now);
    } else if (ev.k === "ui:notice") {
      if (!hold || !ev.on || running) return;
      human("notice", now, "notice");
    } else if (ev.k === "ui:pet") {
      if (!hold || mode === "asleep" || mode === "hidden") return;
      pageMemory().pet();
      if (running?.key === "wake") after = "pet";
      else {
        after = null;
        human("pet", now, "pet");
      }
    } else return;
    kick();
  });

  /* ---------------- input (§2.2) ---------------- */

  const editable = (t: EventTarget | null) =>
    t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

  const onInput = (e: Event) => {
    if (dead) return;
    const now = performance.now();
    if (e.type === "pointermove") {
      const pe = e as PointerEvent;
      const pt = { x: pe.clientX, y: pe.clientY };
      follow(pt, now, pe.pointerType);
      if (lastMove && Math.hypot(pt.x - lastMove.x, pt.y - lastMove.y) < K.MOVE_MIN_PX) return;
      lastMove = pt;
    } else if (e.type === "scroll" || e.type === "wheel") sched.busy(now + K.SCROLL_BUSY_MS);
    else if (e.type === "pointerdown" || e.type === "touchstart") sched.busy(now + K.PRESS_BUSY_MS);
    else if (e.type === "keydown" && editable(e.target)) sched.busy(now + K.TYPE_BUSY_MS);
    const was = levelNow(now).lv;
    sched.input(now);
    wokeAt = -Infinity;
    if (introRun && e.type !== "focusin") {
      // Any input cuts the introduction short (§5): he is simply awake, no tour.
      running = null;
      finishIntro(false);
      kick();
    }
    if (!hold || mode === "asleep" || mode === "hidden") return;
    if (was >= 2 && !(running && running.key === "wake")) {
      wakeFrom(was, now);
      kick();
    }
  };

  /** A0: the eyes jump after the pointer within 240 px, at most 20 frames a second (§2.6). */
  const follow = (pt: Vec, now: number, kind: string) => {
    if (!hold || kind === "touch" || phone() || running || reduceSys) return;
    if (levelNow(now).lv !== 0) return;
    const b = bodyAt();
    if (!b) return;
    const d = Math.hypot(pt.x - b.x, pt.y - b.y);
    const wasShy = shy;
    shy = d < K.SHY_PX;
    if (d > K.GAZE_RADIUS) {
      if (gaze && gazeUntil > now) {
        gazeUntil = now;
        frame();
      }
      if (wasShy !== shy) frame();
      return;
    }
    gazeUntil = now + 300;
    if ((!gazePt || Math.hypot(pt.x - gazePt.x, pt.y - gazePt.y) > K.GAZE_JUMP_PX) && now - gazeAt >= 1000 / K.GAZE_FPS) {
      gaze = gazeTo(b, pt);
      gazePt = pt;
      gazeAt = now;
      frame();
    } else if (wasShy !== shy) frame();
    else schedule(gazeUntil, now);
  };

  const inputs = ["pointermove", "pointerdown", "wheel", "keydown", "touchstart", "focusin"] as const;
  for (const n of inputs) window.addEventListener(n, onInput, { passive: true, capture: true });
  let parkRaf = 0;
  /** Phone: a plate docked under the pill (square corners) — he sits down, no hops (§3.2). */
  const checkDock = () => {
    dockRaf = 0;
    if (dead) return;
    const now = !wideLayout() && !!document.querySelector('.feed-plate[data-stuck="dock"]');
    if (now !== docked) {
      docked = now;
      if (hold) frame();
    }
  };
  const onScroll = (e: Event) => {
    onInput(e);
    if (!dockRaf) dockRaf = requestAnimationFrame(checkDock);
    // The phone park rides the sticky pill: follow it while the page scrolls, once per frame
    // (capture also sees inner scrollers; parkPoint reads layout).
    if (hold?.where === "park" && !fade && !walk && !parkRaf) {
      parkRaf = requestAnimationFrame(() => {
        parkRaf = 0;
        if (dead || hold?.where !== "park" || fade || walk) return;
        const p = parkPoint();
        if (p) keeper.move({ x: p.x, y: p.y });
      });
    }
  };
  document.addEventListener("scroll", onScroll, { passive: true, capture: true });

  const onVis = () => {
    const now = performance.now();
    if (document.visibilityState === "hidden") {
      hidden = true;
      hiddenAt = now;
      hiddenSince = sched.sinceInput(now);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (timer) window.clearTimeout(timer);
      timer = 0;
      timerAt = Infinity;
      return;
    }
    hidden = false;
    if (now - hiddenAt >= K.AWAY_WAKE_MS) {
      const was = levelAt(hiddenSince + (now - hiddenAt));
      sched.input(now);
      if (hold) wakeFrom(Math.max(2, was) as Level, now);
    } else sched.inputAt(now - hiddenSince);
    frame();
  };
  document.addEventListener("visibilitychange", onVis);

  const onInk = () => {
    color = pixelColor(pixelInkForPath(path));
    frame();
  };
  window.addEventListener(INK_EVENT, onInk);

  /** A choice changed (his panel, /settings, another tab, the system motion setting). */
  const refreshMode = () => {
    reduceSys = window.matchMedia(REDUCE_QUERY).matches;
    const was = mode;
    mode = currentMode();
    sched.mode(mode);
    if (!usable()) {
      if (hold) {
        drop();
        setOwner("none");
      }
      return;
    }
    if (!hold) {
      requestAnimationFrame(takeHome);
      return;
    }
    if (was === mode) {
      frame();
      return;
    }
    const now = performance.now();
    if (mode === "asleep" || mode === "hidden") {
      // Asleep or hidden: no act runs on, nothing waits.
      running = null;
      after = null;
      pokeQueued = null;
      grow = null;
      if (introRun) finishIntro(false);
    } else if (was === "hidden") {
      sched.input(now);
      wokeAt = -Infinity;
      grow = now;
    } else if (was === "asleep") {
      // Woken by a person (a click, the panel, Enter): 900 ms, then awake (§4.6).
      sched.input(now);
      wokeAt = -Infinity;
      sched.done();
      sched.offer({ key: "wake", prio: 2, ttlMs: 1000, ladder: [step("wakeUp")] }, now);
      sched.next(now);
      after = null;
      startAct("wakeUp", now, "wake", 2);
    }
    frame();
  };
  const offChoice = onChoice(refreshMode);
  const wide = window.matchMedia(WIDE_QUERY);
  const onWide = () => {
    // Crossing 1024 px: the one «teleport» is a fade to the home of the new layout (§3.4).
    if (hold) requestAnimationFrame(() => keeper.home());
  };
  wide.addEventListener("change", onWide);

  const offSlot = onSlotPlace((p, was) => {
    if (!hold) {
      // A window came up (the other layout's, after crossing 1024 px): he moves in if nobody has him.
      if (p && bodyOwner() === "none") requestAnimationFrame(takeHome);
      return;
    }
    if (hold.where !== "nook" || fade) return;
    if (!p) {
      drop();
      setOwner("none");
      return;
    }
    const now = performance.now();
    const phoneEl = (s: typeof p) => !!s?.el?.classList.contains("is-phone");
    if (was && phoneEl(p) !== phoneEl(was)) {
      // The other layout's window (crossing 1024 px): the one «teleport», a fade (§3.4).
      keeper.home();
      return;
    }
    if (was && Math.abs(p.x - was.x) > 60) {
      // A new home (/settings) or a far title edge: a fade, he does not walk under the title.
      fade = { at: now, from: { x: was.x, y: was.y }, to: { where: "nook", x: p.x, y: p.y, face: p.face } };
      frame();
      return;
    }
    if (was && Math.abs(p.x - was.x) >= 1 && !actReduce() && mode === "live" && !hidden) {
      // A new title edge: a step over, ≤ 60 px at 140 px/s (§3.1).
      const fromX = walk ? walk.fromX + (walk.toX - walk.fromX) * smooth((now - walk.at) / walk.ms) : was.x;
      walk = { fromX, toX: p.x, y: p.y, at: now, ms: Math.max(120, (Math.abs(p.x - fromX) / K.STEP_PX_S) * 1000), roll0: roll };
      paint(now);
      return;
    }
    if (!walk) frame();
  });

  return {
    keeper,
    arrive(next: string) {
      path = next;
      color = pixelColor(pixelInkForPath(next));
      const now = performance.now();
      sched.busy(now + K.NAV_BUSY_MS);
      if (next === "/") {
        if (hold) {
          drop();
          setOwner("none");
        }
        return;
      }
      if (hold) frame();
      // After the scout has decided for this page: nobody has him, so he is just at home.
      requestAnimationFrame(takeHome);
    },
    start() {
      requestAnimationFrame(takeHome);
    },
    stop() {
      dead = true;
      offBus();
      offSlot();
      for (const n of inputs) window.removeEventListener(n, onInput, { capture: true });
      document.removeEventListener("scroll", onScroll, { capture: true });
      if (parkRaf) cancelAnimationFrame(parkRaf);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener(INK_EVENT, onInk);
      offChoice();
      if (dockRaf) cancelAnimationFrame(dockRaf);
      wide.removeEventListener("change", onWide);
      const had = hold != null;
      drop();
      if (had) setOwner("none");
    },
    debug() {
      const now = performance.now();
      return { hold, level: levelNow(now).lv, running: running?.act.name ?? null, log: sched.log.slice(-20), mode, docked };
    },
  };
}

type Engine = ReturnType<typeof createEngine>;

export default function KayoloLayer() {
  const path = usePathname();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);

  useEffect(() => {
    setHost(document.body);
  }, []);

  useEffect(() => {
    const body = bodyRef.current;
    const canvas = canvasRef.current;
    if (!host || !body || !canvas || !K.KAYOLO_LAYER) return;
    let engine: Engine;
    try {
      engine = createEngine(body, canvas);
    } catch (e) {
      console.warn("[kayolo] engine", e);
      return;
    }
    engineRef.current = engine;
    setKeeper(engine.keeper);
    (window as Window & { __kayolo?: () => unknown }).__kayolo = engine.debug;
    engine.start();
    return () => {
      setKeeper(null);
      engine.stop();
      engineRef.current = null;
    };
  }, [host]);

  useEffect(() => {
    engineRef.current?.arrive(path);
  }, [path]);

  if (!host) return null;
  return createPortal(
    <div className="kayolo-layer" aria-hidden>
      <div ref={bodyRef} className="kayolo-body">
        <canvas ref={canvasRef} className="kayolo-canvas" width={0} height={0} />
      </div>
    </div>,
    host
  );
}
