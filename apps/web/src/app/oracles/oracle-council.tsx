"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { motion, useReducedMotion } from "framer-motion";
import { lookupAddress } from "@/lib/address-book";
import {
  oracleCouncilMesh,
  oracleCouncilWalk,
  oracleOperatorMarkSrc,
  oracleOperatorSeed,
  uniqueOracleNames,
} from "@/lib/oracle-operator";
import {
  SCENE_BURST_EASE,
  SCENE_EASE,
  SCENE_FORM_EASE,
  SCENE_MS,
  sceneCluster,
  sceneCouncilCap,
  sceneFromRects,
  sceneGatherDelay,
  sceneGridSlots,
  scenePinchAt,
  type ScenePt,
} from "@/lib/oracle-scene";
import type { OracleOperator } from "@/lib/oracle-feed";

export type OracleLens = "live" | "silent";
type Phase =
  | "idle"
  | "flash"
  | "pinch"
  | "gather"
  | "beat"
  | "arm"
  | "burst"
  | "form"
  | "bind";

const MARK = 36;
const HALF = MARK / 2;
const HOP_MS = 900;

/** Start and end just outside the face, so the spark stays in the gap. */
function gapEnds(a: ScenePt, b: ScenePt, pad = 22): ScenePt[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const pull = Math.min(pad, len / 2 - 1);
  if (pull <= 0) return [a, b];
  const ux = (dx / len) * pull;
  const uy = (dy / len) * pull;
  return [
    { x: a.x + ux, y: a.y + uy },
    { x: b.x - ux, y: b.y - uy },
  ];
}

function colsFromGrid(el: Element | null): number {
  if (!el) return 4;
  const raw = getComputedStyle(el).gridTemplateColumns;
  const n = raw.split(" ").filter(Boolean).length;
  return n > 0 ? n : 4;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function readMarks(wrap: HTMLElement | null): { box: { w: number; h: number }; pts: ScenePt[] } {
  if (!wrap) return { box: { w: 0, h: 0 }, pts: [] };
  const wr = wrap.getBoundingClientRect();
  const marks = [...wrap.querySelectorAll<HTMLElement>("[data-oracle-mark]")];
  return sceneFromRects(
    wr,
    marks.map((el) => el.getBoundingClientRect()),
    { w: wrap.clientWidth, h: wrap.clientHeight }
  );
}

type Actor = {
  id: string;
  name: string;
  href: string;
  src: string;
  ok: boolean;
};

function actorsOf(ops: OracleOperator[]): Actor[] {
  const seeds = ops.map(oracleOperatorSeed);
  const names = uniqueOracleNames(seeds);
  return ops.map((op, i) => {
    const seed = seeds[i]!;
    const book = lookupAddress(op.address)?.name;
    return {
      id: op.id,
      name: book || names[i]!,
      href: op.address ? `/address/${op.address}` : `/box/${op.boxId}`,
      src: oracleOperatorMarkSrc(seed),
      ok: op.live === true,
    };
  });
}

export function OracleCouncil({
  title,
  live,
  silent,
  emptyHint,
  liveLabel,
  staleLabel,
  liveChip,
  silentChip,
  onSettled,
}: {
  title: string;
  live: OracleOperator[];
  silent: OracleOperator[];
  emptyHint: string;
  liveLabel: string;
  staleLabel: string;
  liveChip: string;
  silentChip: string;
  onSettled?: (lens: OracleLens) => void;
}) {
  const reduce = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const playing = useRef(false);
  const playGen = useRef(0);
  const armDone = useRef<(() => void) | null>(null);
  const [lens, setLens] = useState<OracleLens>("live");
  useEffect(() => {
    if (lens === "silent" && !silent.length) setLens("live");
  }, [lens, silent.length]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pts, setPts] = useState<ScenePt[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [cols, setCols] = useState(4);
  const [outActors, setOutActors] = useState<Actor[]>([]);
  const [inActors, setInActors] = useState<Actor[]>([]);
  const [fromPts, setFromPts] = useState<ScenePt[]>([]);
  const [toPts, setToPts] = useState<ScenePt[]>([]);
  const [pinch, setPinch] = useState<ScenePt>({ x: 0, y: 0 });
  const [hop, setHop] = useState(0);
  const boxRef = useRef(box);
  const colsRef = useRef(cols);
  boxRef.current = box;
  colsRef.current = cols;

  useEffect(() => {
    return () => {
      playGen.current += 1;
      playing.current = false;
      armDone.current?.();
      armDone.current = null;
    };
  }, []);

  const roster = lens === "live" ? live : silent;
  const cap = sceneCouncilCap(cols);
  const shown = roster.slice(0, cap);
  const ghosts = Math.max(0, cap - shown.length);
  const cinematic = phase !== "idle";
  const overlay: "out" | "in" | null =
    phase === "idle" || phase === "arm"
      ? null
      : phase === "burst" || phase === "form" || phase === "bind"
        ? "in"
        : "out";

  const seeds = useMemo(() => shown.map(oracleOperatorSeed), [shown]);
  const names = useMemo(() => uniqueOracleNames(seeds), [seeds]);
  const clusterR = Math.max(28, Math.min(box.w, box.h || box.w) * 0.28);
  const cluster = useMemo(
    () => sceneCluster(inActors.length, pinch, clusterR),
    [inActors.length, pinch, clusterR]
  );

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const grid = gridRef.current;
    if (!wrap || !grid) return;

    const measure = () => {
      setCols(colsFromGrid(grid));
      const next = readMarks(wrap);
      setBox(next.box);
      if (!playing.current) setPts(next.pts);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [shown.length, lens, cols]);

  useLayoutEffect(() => {
    if (phase !== "arm") return;
    const prev = boxRef.current;
    const next = readMarks(wrapRef.current);
    const fallback = sceneGridSlots(inActors.length, cols, {
      w: next.box.w || prev.w,
      h: next.box.h || prev.h,
    });
    setBox((b) => ({
      w: next.box.w || b.w,
      h: next.box.h || b.h,
    }));
    setToPts(next.pts.length ? next.pts : fallback);
    setPhase("burst");
    armDone.current?.();
    armDone.current = null;
  }, [phase, inActors.length, cols]);

  useLayoutEffect(() => {
    if (phase !== "idle") return;
    const next = readMarks(wrapRef.current);
    if (next.pts.length) setPts(next.pts);
    if (next.box.w) setBox((b) => (b.w === next.box.w && b.h === next.box.h ? b : next.box));
  }, [phase, shown.length, lens, cols]);

  const play = async (next: OracleLens) => {
    if (next === lens || playing.current) return;
    const width = colsRef.current;
    const seats = sceneCouncilCap(width);
    const incoming = (next === "silent" ? silent : live).slice(0, seats);
    if (!incoming.length && next === "silent") return;
    if (reduce) {
      setLens(next);
      onSettled?.(next);
      return;
    }
    const my = ++playGen.current;
    playing.current = true;
    const still = () => playGen.current === my;
    const measured = readMarks(wrapRef.current);
    const origin =
      measured.pts.length > 0
        ? measured.pts
        : pts.length > 0
          ? pts
          : [
              {
                x: (measured.box.w || box.w) / 2,
                y: Math.max(24, (measured.box.h || box.h) / 2),
              },
            ];
    const c = origin.length
      ? scenePinchAt(origin, origin.length, width)
      : {
          x: (measured.box.w || box.w) / 2,
          y: Math.max(24, (measured.box.h || box.h) / 2),
        };
    setFromPts(origin);
    setPinch(c);
    setOutActors(actorsOf(shown));
    setInActors(actorsOf(incoming));

    if (shown.length) {
      setPhase("flash");
      await sleep(SCENE_MS.flash);
      if (!still()) return;
      setPhase("pinch");
      await sleep(SCENE_MS.pinch);
      if (!still()) return;
      setPhase("gather");
      await sleep(SCENE_MS.gather);
      if (!still()) return;
      setPhase("beat");
      await sleep(SCENE_MS.beat);
      if (!still()) return;
    }

    if (!incoming.length) {
      setLens(next);
      setPhase("idle");
      playing.current = false;
      onSettled?.(next);
      return;
    }

    const armed = new Promise<void>((resolve) => {
      armDone.current = resolve;
    });
    setLens(next);
    setPhase("arm");
    const armWatch = window.setTimeout(() => {
      armDone.current?.();
      armDone.current = null;
    }, 120);
    await armed;
    window.clearTimeout(armWatch);
    if (!still()) return;
    await sleep(SCENE_MS.burst);
    if (!still()) return;
    setPhase("form");
    await sleep(SCENE_MS.form);
    if (!still()) return;
    setPhase("bind");
    onSettled?.(next);
    await sleep(SCENE_MS.bind);
    if (!still()) return;
    setPhase("idle");
    playing.current = false;
  };

  const lineSet = overlay === "out" ? fromPts : overlay === "in" ? toPts : pts;
  const lineEdges = oracleCouncilMesh(lineSet.length, cols);
  const walk = useMemo(() => oracleCouncilWalk(shown.length, cols), [shown.length, cols]);
  const step =
    phase === "idle" && !reduce && walk.length > 0 && pts.length >= shown.length
      ? walk[hop % walk.length]!
      : null;
  const spark = step ? gapEnds(pts[step.a] ?? pts[0]!, pts[step.b] ?? pts[0]!) : null;
  const sparkInk = lens === "silent" ? "#ff4d6d" : "var(--up)";

  useEffect(() => {
    if (reduce || phase !== "idle" || walk.length < 1) return;
    const id = window.setInterval(() => setHop((n) => n + 1), HOP_MS);
    return () => window.clearInterval(id);
  }, [reduce, phase, walk.length]);
  const flashStroke = lens === "silent" ? "#ff4d6d" : "var(--up)";
  const bindSilent = lens === "silent";
  const showLines =
    box.w > 0 &&
    lineSet.length > 1 &&
    (phase === "flash" || phase === "pinch" || phase === "bind");

  const empty = !live.length && !silent.length;
  const gathering = phase === "gather" || phase === "beat";
  const gone = phase === "beat";

  return (
    <div className="flex flex-col">
      <div className="mb-1 flex h-[22px] items-center justify-between gap-3">
        <h2 className="m-0 text-[17px] font-semibold leading-none tracking-tight">{title}</h2>
        <div className="inline-grid shrink-0 grid-cols-2 items-stretch gap-1">
          <LensChip
            pressed={lens === "live"}
            disabled={cinematic}
            label={liveChip}
            onClick={() => void play("live")}
          />
          <LensChip
            pressed={lens === "silent"}
            disabled={cinematic || !silent.length}
            label={silentChip}
            tone="silent"
            onClick={() => void play("silent")}
          />
        </div>
      </div>
      {empty ? (
        <p className="px-1 py-8 text-center text-[13px] text-[var(--muted)]">{emptyHint}</p>
      ) : (
        <div
          ref={wrapRef}
          className="relative mt-3 overflow-hidden pt-2"
          aria-busy={cinematic}
        >
          {showLines || spark ? (
            <svg
              className={clsx(
                "pointer-events-none absolute inset-0",
                spark ? "z-[2]" : "z-0"
              )}
              width={box.w}
              height={box.h}
              aria-hidden
            >
              {spark ? (
                <g key={hop}>
                  <motion.path
                    d={`M ${spark[0]!.x} ${spark[0]!.y} L ${spark[1]!.x} ${spark[1]!.y}`}
                    stroke={sparkInk}
                    strokeWidth={1.75}
                    strokeLinecap="round"
                    fill="none"
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: [0, 0.8, 0] }}
                    transition={{
                      duration: (HOP_MS - 80) / 1000,
                      ease: SCENE_EASE,
                      times: [0, 0.42, 1],
                    }}
                  />
                  <motion.circle
                    r={3.4}
                    fill={sparkInk}
                    initial={{ cx: spark[0]!.x, cy: spark[0]!.y, opacity: 0 }}
                    animate={{
                      cx: [spark[0]!.x, spark[1]!.x],
                      cy: [spark[0]!.y, spark[1]!.y],
                      opacity: [0, 1, 1, 0],
                    }}
                    transition={{
                      duration: (HOP_MS - 80) / 1000,
                      ease: SCENE_EASE,
                      times: [0, 0.12, 0.8, 1],
                    }}
                  />
                </g>
              ) : null}
              {showLines
                ? lineEdges.map((e) => {
                const a = lineSet[e.a];
                const b = lineSet[e.b];
                if (!a || !b) return null;
                if (phase === "bind") {
                  return (
                    <motion.path
                      key={`${e.a}-${e.b}-bind`}
                      d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`}
                      className={bindSilent ? "oracle-bond-silent" : "oracle-bond-live"}
                      fill="none"
                      initial={{ pathLength: 0, opacity: 0.15 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={{
                        duration: SCENE_MS.bind / 1000,
                        ease: SCENE_EASE,
                        delay: Math.min(e.a, e.b) * 0.018,
                      }}
                    />
                  );
                }
                return (
                  <motion.line
                    key={`${e.a}-${e.b}-fx`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={flashStroke}
                    strokeLinecap="round"
                    initial={false}
                    animate={
                      phase === "flash"
                        ? {
                            opacity: [0.45, 1, 0.18, 1],
                            strokeWidth: [1.1, 2.6, 1.15, 2.55],
                          }
                        : {
                            x1: pinch.x,
                            y1: pinch.y,
                            x2: pinch.x,
                            y2: pinch.y,
                            opacity: 0,
                            strokeWidth: 2.4,
                          }
                    }
                    transition={{
                      duration: (phase === "flash" ? SCENE_MS.flash : SCENE_MS.pinch) / 1000,
                      ease: SCENE_EASE,
                    }}
                  />
                );
              })
                : null}
            </svg>
          ) : null}

          <div
            ref={gridRef}
            {...(cinematic ? { inert: true } : {})}
            className={clsx(
              "relative z-[1] grid grid-cols-3 grid-rows-[repeat(3,auto)] gap-x-2 gap-y-4 sm:grid-cols-4",
              cinematic && "invisible"
            )}
          >
            {shown.map((op, i) => {
              const seed = seeds[i]!;
              const name = lookupAddress(op.address)?.name || names[i]!;
              const href = op.address ? `/address/${op.address}` : `/box/${op.boxId}`;
              const ok = op.live === true;
              return (
                <Link
                  prefetch={false}
                  key={op.id}
                  href={href}
                  title={`${name} · ${op.address || op.boxId}`}
                  aria-label={`${name}. ${ok ? liveLabel : staleLabel}`}
                  className="group flex min-w-0 flex-col items-center gap-1.5 rounded-lg px-0.5 py-0.5 outline-none transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--wash)] focus-visible:bg-[var(--wash)]"
                >
                  <span
                    className={clsx(
                      "relative inline-flex",
                      step?.b === i && (lens === "silent" ? "oracle-mark-speak is-silent" : "oracle-mark-speak")
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      data-oracle-mark
                      src={oracleOperatorMarkSrc(seed)}
                      alt=""
                      width={MARK}
                      height={MARK}
                      className="size-9 rounded-[6px]"
                    />
                    <span
                      className={clsx(
                        "absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-[var(--module)]",
                        ok ? "bg-[var(--up)]" : "bg-[var(--warning)]"
                      )}
                    />
                  </span>
                  <span className="w-full truncate text-center text-[11px] font-medium leading-tight tracking-tight text-[var(--text)] group-hover:text-accent">
                    {name}
                  </span>
                </Link>
              );
            })}
            {Array.from({ length: ghosts }, (_, i) => (
              <div
                key={`ghost-${i}`}
                className="invisible flex min-w-0 flex-col items-center gap-1.5 px-0.5 py-0.5"
                aria-hidden
              >
                <span className="size-9 rounded-[6px]" />
                <span className="w-full text-center text-[11px] leading-tight">&nbsp;</span>
              </div>
            ))}
          </div>

          {overlay === "out"
            ? outActors.map((op, i) => {
                const here = fromPts[i] ?? pinch;
                const delay = sceneGatherDelay(i, fromPts, pinch, 0.16);
                return (
                  <motion.div
                    key={`out-${op.id}`}
                    className="pointer-events-none absolute z-[2] flex w-9 flex-col items-center"
                    initial={false}
                    animate={{
                      x: (gathering ? pinch.x : here.x) - HALF,
                      y: (gathering ? pinch.y : here.y) - HALF,
                      scale: gone ? 0 : gathering ? 0.08 : 1,
                      rotate: gathering ? (i % 2 === 0 ? -8 : 8) : 0,
                      opacity: gone ? 0 : 1,
                    }}
                    transition={{
                      duration: gathering ? SCENE_MS.gather / 1000 : 0.2,
                      ease: SCENE_EASE,
                      delay: gathering ? delay : 0,
                    }}
                    style={{ left: 0, top: 0, transformOrigin: "18px 18px" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={op.src} alt="" width={MARK} height={MARK} className="size-9 rounded-[6px]" />
                    <motion.span
                      className="mt-1.5 w-[4.5rem] truncate text-center text-[11px] font-medium leading-tight tracking-tight text-[var(--text)]"
                      animate={{ opacity: phase === "flash" || phase === "pinch" ? 1 : 0 }}
                      transition={{ duration: 0.16, ease: SCENE_EASE }}
                    >
                      {op.name}
                    </motion.span>
                  </motion.div>
                );
              })
            : null}

          {overlay === "in"
            ? inActors.map((op, i) => {
                const pile = cluster[i] ?? pinch;
                const slot = toPts[i] ?? pile;
                const formed = phase === "form" || phase === "bind";
                return (
                  <motion.div
                    key={`in-${op.id}`}
                    className="pointer-events-none absolute z-[2] flex w-9 flex-col items-center"
                    initial={{
                      x: pinch.x - HALF,
                      y: pinch.y - HALF,
                      scale: 0.08,
                      rotate: i % 2 === 0 ? -18 : 18,
                      opacity: 0,
                    }}
                    animate={{
                      x: (formed ? slot.x : pile.x) - HALF,
                      y: (formed ? slot.y : pile.y) - HALF,
                      scale: 1,
                      rotate: 0,
                      opacity: 1,
                    }}
                    transition={{
                      duration: (formed ? SCENE_MS.form : SCENE_MS.burst) / 1000,
                      ease: formed ? SCENE_FORM_EASE : SCENE_BURST_EASE,
                      delay: formed ? i * 0.028 : i * 0.016,
                    }}
                    style={{ left: 0, top: 0, transformOrigin: "18px 18px" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={op.src} alt="" width={MARK} height={MARK} className="size-9 rounded-[6px]" />
                    <motion.span
                      className="mt-1.5 w-[4.5rem] truncate text-center text-[11px] font-medium leading-tight tracking-tight text-[var(--text)]"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: formed ? 1 : 0, y: formed ? 0 : 8 }}
                      transition={{
                        duration: 0.28,
                        ease: SCENE_EASE,
                        delay: formed ? 0.1 + i * 0.018 : 0,
                      }}
                    >
                      {op.name}
                    </motion.span>
                  </motion.div>
                );
              })
            : null}

          {phase === "pinch" || phase === "gather" || phase === "beat" || phase === "arm" ? (
            <motion.span
              className="pointer-events-none absolute z-[3] size-2 rounded-[3px] bg-[var(--text)]"
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{
                opacity: phase === "beat" || phase === "arm" ? [1, 0] : 1,
                scale: phase === "beat" || phase === "arm" ? [1, 0.15] : 1,
                x: pinch.x - 4,
                y: pinch.y - 4,
              }}
              transition={{
                duration:
                  phase === "beat" || phase === "arm" ? SCENE_MS.beat / 1000 : SCENE_MS.pinch / 1000,
                ease: SCENE_EASE,
              }}
              style={{ left: 0, top: 0 }}
              aria-hidden
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function LensChip({
  pressed,
  label,
  onClick,
  disabled,
  tone,
}: {
  pressed: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "silent";
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "chip-press inline-flex h-6 w-full items-center justify-center rounded-[9px] px-2.5 text-[12px] font-medium tabular-nums",
        "transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
        "disabled:pointer-events-none disabled:opacity-50",
        pressed
          ? tone === "silent"
            ? "is-pressed bg-[var(--panel-hover)] text-[#FF4D6D]"
            : "is-pressed bg-[var(--panel-hover)] text-[var(--text)]"
          : "text-[var(--muted)] hover:bg-[var(--wash)] hover:text-[var(--text)]"
      )}
    >
      {label}
    </button>
  );
}
