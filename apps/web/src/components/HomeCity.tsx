"use client";

/**
 * Home live strip: «Живые блоки» as «Ночной город» and «Мемпул» as «Склад», one scene across two
 * cards (approved by the operator 13.11.2026). The painters live in lib/home-city; the
 * engine there draws on demand only, so at rest the cards ask for no frames. The cards keep their
 * headers, «All» links, footers, tips and links: a tower opens its block, a crate its tx, the wrap
 * and the empty lot the mempool.
 */
import { Component, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { useReducedMotion } from "framer-motion";
import type { SealEvent } from "@ergoscan/shared";
import { KpiNum } from "@/components/KpiGrid";
import { ReelText } from "@/components/ReelText";
import { TipHead, TipNote, TipRow, TipRows, useFloatTip, type TipRect } from "@/components/Tip";
import { HOME } from "@/lib/palette";
import { getGateway } from "@/lib/config";
import { SNAPSHOT_FETCH } from "@/lib/keyed-enter";
import { formatBytes, formatDottedDate, formatErgPrecise, formatH24 } from "@/lib/format";
import { lookInk } from "@/lib/look";
import { txChipCaption } from "@/lib/tx-lock";
import { ERGO_MAX_BLOCK_SIZE } from "@/lib/ergo-emission";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { onKayolo } from "@/lib/kayolo/events";
import type { CityBlock, CityTx, Fees, YardTx } from "@/lib/home-city/common";
import { feeLevels, feeZone } from "@/lib/home-city/load";
import { CityEngine } from "@/lib/home-city/engine";

/** A block on the tape, as the home snapshot and the seal give it. */
export type CityRow = {
  id: string;
  height: number;
  timestamp: number;
  txCount: number | null;
  size: number;
  lithos?: boolean;
  minerAddress?: string | null;
  minerName?: string | null;
  feeNano?: string | number | null;
};

export type CityBall = {
  id: string;
  size: number;
  fee: number;
  feeRate: number;
  color: string;
  firstSeen: number;
  category: string;
  platform: string | null;
  action: string | null;
  value: number;
};

/**
 * Per-block tx kinds, in block order: the `/v1/blocks/:id?limit=80&offset=0` read the home made for
 * its crate ink. The gateway gives at most 50 txs (getBlockCard), so storeys past the 50th stay grey.
 */
const READ_LIMIT = 80;
/** The seal comes from the node, the block read from the database 0.3–1.5 s later: the new block's
 * first read waits this long (± half a second, so viewers do not ask in lockstep). */
const SEAL_READ_MS = 1_500;
/** A fresh block's read that answered 404/503 or no txs is asked again after these (± 0.5 s), then
 * only when the tape next changes. Blocks older than READ_FRESH_MS are never retried: a database
 * stall must not multiply the load from every open home. */
const READ_RETRY_MS = [3_500, 10_000];
const READ_FRESH_MS = 60_000;

function jitter(ms: number): number {
  return Math.max(0, Math.round(ms + (Math.random() - 0.5) * 1000));
}

function tsMs(ts: number): number {
  return Number.isFinite(ts) && ts > 0 ? (ts > 1e12 ? ts : ts * 1000) : 0;
}

function finite(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function useBlockReads(blocks: readonly CityRow[], sealId: string | null): Record<string, CityTx[]> {
  const [reads, setReads] = useState<Record<string, CityTx[]>>({});
  const cache = useRef<Record<string, CityTx[]>>({});
  const asked = useRef(new Set<string>());
  const tries = useRef(new Map<string, number>());
  const timers = useRef(new Map<string, number>());
  const want = useRef<string[]>([]);
  const rows = useRef(blocks);
  rows.current = blocks;
  const sealRef = useRef(sealId);
  sealRef.current = sealId;
  const alive = useRef(true);
  const abort = useRef<AbortController | null>(null);
  const key = blocks.map((b) => b.id).join(",");
  useEffect(() => {
    alive.current = true;
    const ac = new AbortController();
    abort.current = ac;
    const pending = timers.current;
    const inFlight = asked.current;
    return () => {
      alive.current = false;
      ac.abort();
      for (const h of pending.values()) window.clearTimeout(h);
      pending.clear();
      inFlight.clear();
    };
  }, []);
  useEffect(() => {
    const ids = key.split(",").filter((id) => id.length >= 16 && !id.startsWith("seal-"));
    want.current = ids;
    // Paints what the newest tape wants, so a read that lands after the tape moved still shows.
    const paint = () => {
      if (!alive.current) return;
      const next: Record<string, CityTx[]> = {};
      for (const id of want.current) {
        const c = cache.current[id];
        if (c) next[id] = c;
      }
      setReads((prev) => {
        const a = Object.keys(prev);
        const b = Object.keys(next);
        return a.length === b.length && b.every((k) => prev[k] === next[k]) ? prev : next;
      });
    };
    const fresh = (id: string) => id === sealRef.current || Date.now() - tsMs(rows.current.find((b) => b.id === id)?.timestamp ?? 0) < READ_FRESH_MS;
    const wait = (id: string, ms: number) => {
      timers.current.set(
        id,
        window.setTimeout(() => {
          timers.current.delete(id);
          if (alive.current && want.current.includes(id) && !cache.current[id] && !asked.current.has(id)) ask(id);
        }, ms)
      );
    };
    const ask = (id: string) => {
      asked.current.add(id);
      void fetch(`${getGateway()}/v1/blocks/${encodeURIComponent(id)}?limit=${READ_LIMIT}&offset=0`, { ...SNAPSHOT_FETCH, signal: abort.current?.signal })
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          const j = (await r.json()) as { txs?: Array<{ category?: string; color?: string }> };
          const txs = Array.isArray(j.txs) ? j.txs : [];
          // Every block has its coinbase: no txs yet means the database has not written them.
          if (!txs.length && (rows.current.find((b) => b.id === id)?.txCount ?? 0) > 0) throw new Error("short");
          cache.current[id] = txs.map((t) => ({
            color: typeof t.color === "string" ? t.color : "",
            category: typeof t.category === "string" ? t.category : "",
          }));
          asked.current.delete(id);
          tries.current.delete(id);
          paint();
        })
        .catch(() => {
          asked.current.delete(id);
          if (!alive.current) return;
          const n = tries.current.get(id) ?? 0;
          if (n >= READ_RETRY_MS.length || !fresh(id)) return;
          tries.current.set(id, n + 1);
          wait(id, jitter(READ_RETRY_MS[n]!));
        });
    };
    const keep = new Set(ids);
    for (const id of Object.keys(cache.current)) if (!keep.has(id)) delete cache.current[id];
    for (const id of [...tries.current.keys()]) if (!keep.has(id)) tries.current.delete(id);
    for (const [id, h] of [...timers.current]) {
      if (keep.has(id)) continue;
      window.clearTimeout(h);
      timers.current.delete(id);
    }
    paint();
    for (const id of ids) {
      if (cache.current[id] || asked.current.has(id) || timers.current.has(id)) continue;
      // The block just sealed is not in the database yet: its first read waits a moment.
      if (id === sealRef.current && !tries.current.has(id)) {
        tries.current.set(id, 0);
        wait(id, jitter(SEAL_READ_MS));
      } else ask(id);
    }
  }, [key]);
  return reads;
}

function collectClock(ts: number, now: number): string {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }
  return `${m}:${String(r).padStart(2, "0")}`;
}

function FormingAge({ ts }: { ts: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ts == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ts]);
  if (ts == null) return <span className="tabular-nums">—</span>;
  return (
    <span suppressHydrationWarning className="tabular-nums">
      {collectClock(ts, now)}
    </span>
  );
}

export function fmtCreated(ts: number): string {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const date = formatDottedDate(ms);
  const time = formatH24(ms, undefined, false);
  if (date === "—" || time === "—") return "—";
  return `${date}, ${time}`;
}

function tipHash(id: string): string {
  if (!id || id.length <= 16) return id;
  return `${id.slice(0, 8)}..${id.slice(-6)}`;
}

/** One key per tip in the yard: a crate's tx, or the wrap with its count. */
function yardKey(hit: { id: string | null; n: number }): string {
  return hit.id ?? `+${hit.n}`;
}

/** The canvas a pointer is over, in its CSS px. */
function local(el: HTMLElement, ev: { clientX: number; clientY: number }) {
  const r = el.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top, r };
}

function HomeCityPairLive({
  blocks,
  balls,
  pool,
  totalSize,
  totalFees,
  streamFees,
  streamLive,
  seal,
  poolInk,
  avgBlockMs,
  title,
  mempoolTitle,
  all,
  txUnit,
  formingHeight,
  formingSince,
  enter,
}: {
  blocks: CityRow[];
  balls: CityBall[];
  pool: number;
  totalSize: number;
  totalFees: number;
  streamFees: { normal: number; turbo: number; avgBlockMs: number | null } | null;
  streamLive: boolean;
  seal: SealEvent | null;
  /** Miner address → its slice ink on the «Mining pools» donut. */
  poolInk: Record<string, string>;
  avgBlockMs: number | null;
  title: string;
  mempoolTitle: string;
  all: string;
  txUnit: string;
  formingHeight: number;
  formingSince: number | null;
  enter: [CSSProperties, CSSProperties];
}) {
  const { locale, t } = useI18n();
  const loc = locale === "ru" ? "ru-RU" : "en-US";
  const reduce = !!useReducedMotion();
  const router = useRouter();
  const hostRef = useRef<HTMLDivElement>(null);
  const cityRef = useRef<HTMLCanvasElement>(null);
  const yardRef = useRef<HTMLCanvasElement>(null);
  const flyRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<CityEngine | null>(null);
  const [built, setBuilt] = useState<{ id: string; height: number; built: number; ts: number } | null>(null);
  const [waiting, setWaiting] = useState<number | null>(null);
  const [committed, setCommitted] = useState<number | null>(null);
  const [hoverBlock, setHoverBlock] = useState<string | null>(null);
  const [wrapN, setWrapN] = useState(0);
  const reads = useBlockReads(blocks, seal && typeof seal.blockId === "string" && seal.blockId.length >= 16 ? seal.blockId : null);

  const fees: Fees | null = useMemo(() => {
    if (streamLive && streamFees) return { normal: streamFees.normal, turbo: streamFees.turbo };
    return feeLevels(balls.map((b) => b.feeRate));
  }, [balls, streamFees, streamLive]);
  const avg = streamFees?.avgBlockMs ?? avgBlockMs ?? 120_000;

  const cityBlocks: CityBlock[] = useMemo(
    () =>
      // A missing number from the tape must not turn a tower (and every one left of it) into NaN.
      blocks
        .filter((b) => Number.isFinite(b.height))
        .map((b) => ({
          id: b.id,
          height: b.height,
          ts: tsMs(b.timestamp),
          txCount: Number.isFinite(b.txCount) ? Math.max(0, b.txCount!) : (reads[b.id]?.length ?? 0),
          size: Math.max(0, finite(b.size)),
          flag: b.minerAddress ? (poolInk[b.minerAddress] ?? null) : null,
          lithos: b.lithos === true,
          txs: reads[b.id] ?? null,
        })),
    [blocks, poolInk, reads]
  );
  const yardTxs: YardTx[] = useMemo(
    () =>
      balls.map((b) => ({
        id: b.id,
        size: Math.max(0, finite(b.size)),
        fee: Math.max(0, finite(b.fee)),
        feeRate: Math.max(0, finite(b.feeRate)),
        color: b.color,
        category: b.category,
        firstSeen: finite(b.firstSeen),
      })),
    [balls]
  );
  const text = useMemo(
    () => ({
      turbo: t("fees.turbo"),
      normal: t("fees.normal"),
      more: (n: number) => t("mempool.more").replace("{n}", n.toLocaleString(loc)),
      tag: (n: number) => `${n.toLocaleString(loc)} ${txUnit}`,
    }),
    [loc, t, txUnit]
  );
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    const host = hostRef.current;
    const city = cityRef.current;
    const yard = yardRef.current;
    const fly = flyRef.current;
    if (!host || !city || !yard || !fly) return;
    const e = new CityEngine({
      city,
      yard,
      fly,
      host,
      reduce,
      text: textRef.current,
      cb: { onBuilt: setBuilt, onWaiting: setWaiting, onCommit: setCommitted, onWrap: setWrapN },
    });
    engineRef.current = e;
    const offRare = onKayolo((ev) => {
      if (ev.k === "chain:rare") e.rareHeight(ev.height);
    });
    return () => {
      offRare();
      e.destroy();
      engineRef.current = null;
    };
    // The engine lives as long as the cards; data, text and motion reach it below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => engineRef.current?.setReduce(reduce), [reduce]);
  useEffect(() => engineRef.current?.setText(text), [text]);
  useEffect(() => {
    engineRef.current?.setData({ blocks: cityBlocks, mem: { count: Math.max(pool, yardTxs.length), txs: yardTxs }, fees, avgBlockMs: avg, streamLive });
  }, [avg, cityBlocks, fees, pool, streamLive, yardTxs]);
  // A seal the stream already held when the cards mounted happened before this view: no replay.
  const mountSeal = useRef(seal);
  useEffect(() => {
    const s = seal;
    if (!s || !Number.isFinite(s.height) || typeof s.blockId !== "string" || s.blockId.length < 16) return;
    const quiet = s === mountSeal.current;
    mountSeal.current = null;
    engineRef.current?.seal({
      blockId: s.blockId,
      height: s.height,
      timestamp: s.timestamp || Date.now(),
      txIds: Array.isArray(s.txIds) ? s.txIds : [],
      txCount: s.txCount ?? (Array.isArray(s.txIds) ? s.txIds.length : 0),
      size: s.size ?? 0,
      quiet,
    });
  }, [seal]);

  /* ---------- the city card ---------- */
  const street = useMemo(() => (committed == null ? blocks : blocks.filter((b) => b.height <= committed)), [blocks, committed]);
  const rowOf = (id: string | null) => (id ? (blocks.find((b) => b.id === id) ?? null) : null);
  const hovered = rowOf(hoverBlock);
  const sealing = built ? (rowOf(built.id) ?? { id: built.id, height: built.height, timestamp: built.ts, txCount: null, size: 0 }) : null;
  const active = hovered ?? sealing ?? street[0] ?? null;
  const activeTxs = !hovered && built && active?.id === built.id ? built.built : (active?.txCount ?? 0);

  const cityTip = useFloatTip({ within: () => cityRef.current });
  const yardTip = useFloatTip({ within: () => yardRef.current });
  const tipOn = useRef<{ city: string | null; yard: string | null }>({ city: null, yard: null });
  const touch = useRef({ down: false, open: false });

  const blockTip = (id: string): ReactNode => {
    const row = rowOf(id);
    if (!row) return null;
    const txs = built && id === built.id ? built.built : row.txCount;
    const feeRaw = row.feeNano != null ? String(row.feeNano) : "";
    const fee = /^\d+$/.test(feeRaw) && feeRaw !== "0" ? feeRaw : null;
    return (
      <>
        <TipHead chip={t("tip.block")} ink="var(--c-block, #ffd23c)" mono>
          {row.height.toLocaleString(loc)}
        </TipHead>
        <TipRows>
          <TipRow label={t("tip.txs")}>{txs != null ? txs.toLocaleString(loc) : "—"}</TipRow>
          {row.size > 0 ? <TipRow label={t("tip.size")}>{formatBytes(row.size)}</TipRow> : null}
          {fee ? <TipRow label={t("tip.fees")}>{formatErgPrecise(fee, locale)}</TipRow> : null}
          {row.minerName ? (
            <TipRow label={t("tip.miner")} text>
              {row.minerName}
            </TipRow>
          ) : null}
          <TipRow label={t("tip.time")}>{fmtCreated(row.timestamp)}</TipRow>
        </TipRows>
        {row.lithos ? <TipNote>{t("block.chip.lithosHint")}</TipNote> : null}
      </>
    );
  };

  const pickTower = (ev: { clientX: number; clientY: number }): { id: string; rect: TipRect } | null => {
    const el = cityRef.current;
    const e = engineRef.current;
    if (!el || !e) return null;
    const p = local(el, ev);
    let best: { id: string; rect: TipRect } | null = null;
    let bestD = Infinity;
    for (const h of e.hits.city) {
      if (p.y < h.top || p.y > h.bottom || p.x < h.x0 - 4 || p.x > h.x1 + 4) continue;
      const d = Math.abs((h.x0 + h.x1) / 2 - p.x);
      if (d < bestD) {
        bestD = d;
        best = { id: h.id, rect: { left: p.r.left + h.x0, top: p.r.top + h.top, width: h.x1 - h.x0, height: h.bottom - h.top } };
      }
    }
    return best;
  };

  const showCityTip = (hit: { id: string; rect: TipRect } | null, tapped = false) => {
    if (!hit) {
      tipOn.current.city = null;
      cityTip.hide();
      return;
    }
    if (tipOn.current.city === hit.id && cityTip.isOpen()) {
      cityTip.move(hit.rect);
      return;
    }
    const body = blockTip(hit.id);
    if (!body) return;
    tipOn.current.city = hit.id;
    cityTip.show(hit.rect, body, { tapped });
  };

  const hoverCity = (id: string | null) => {
    setHoverBlock((cur) => (cur === id ? cur : id));
    engineRef.current?.setHover("city", id);
  };

  /* ---------- the yard card ---------- */
  const shown = waiting ?? pool;
  const fill = totalSize > 0 ? Math.min(100, Math.round((totalSize / ERGO_MAX_BLOCK_SIZE) * 100)) : 0;
  const foot =
    shown <= 0 && balls.length === 0
      ? t("mempool.empty")
      : [fill > 0 ? `${fill}%` : null, totalSize > 0 ? formatBytes(totalSize) : null, totalFees > 0 ? formatErgPrecise(totalFees, locale) : null]
          .filter(Boolean)
          .join(" · ") || t("mempool.kpiWaitSub");
  const ballById = useMemo(() => new Map(balls.map((b) => [b.id, b])), [balls]);

  const crateTip = (id: string | null, n = 0): ReactNode => {
    if (id == null) return t("home.yardMore").replace("{n}", n.toLocaleString(loc));
    const b = ballById.get(id);
    if (!b) return null;
    const cat = b.category ? txChipCaption(b.category, b.platform, b.action, t) : null;
    return (
      <>
        <TipHead chip={cat ?? undefined} ink={lookInk(b.color)} mono>
          {tipHash(b.id)}
        </TipHead>
        <TipRows>
          {b.value > 0 ? (
            <TipRow label={t("tip.value")} ink="var(--up)">
              {formatErgPrecise(b.value, locale)}
            </TipRow>
          ) : null}
          {b.fee > 0 ? <TipRow label={t("tip.fee")}>{formatErgPrecise(b.fee, locale)}</TipRow> : null}
          {b.size > 0 ? <TipRow label={t("tip.size")}>{formatBytes(b.size)}</TipRow> : null}
        </TipRows>
      </>
    );
  };
  const pickCrate = (ev: { clientX: number; clientY: number }): { id: string | null; n: number; rect: TipRect } | "empty" => {
    const el = yardRef.current;
    const e = engineRef.current;
    if (!el || !e) return "empty";
    const p = local(el, ev);
    for (let i = e.hits.yard.length - 1; i >= 0; i--) {
      const h = e.hits.yard[i]!;
      if (p.x >= h.x - 1 && p.x <= h.x + h.w + 1 && p.y >= h.y - 1 && p.y <= h.y + h.h + 1) {
        return { id: h.id, n: h.n ?? 0, rect: { left: p.r.left + h.x, top: p.r.top + h.y, width: h.w, height: h.h } };
      }
    }
    return "empty";
  };

  const showYardTip = (hit: { id: string | null; n: number; rect: TipRect } | null, tapped = false) => {
    if (!hit) {
      tipOn.current.yard = null;
      yardTip.hide();
      return;
    }
    const key = yardKey(hit);
    if (tipOn.current.yard === key && yardTip.isOpen()) {
      yardTip.move(hit.rect);
      return;
    }
    const body = crateTip(hit.id, hit.n);
    if (!body) return;
    tipOn.current.yard = key;
    yardTip.show(hit.rect, body, { tapped });
  };

  /* ---------- accessible summaries ---------- */
  const cityLabel = useMemo(() => {
    const top = street[0];
    if (!top) return title;
    return t("home.cityLabel")
      .replace("{h}", top.height.toLocaleString(loc))
      .replace("{tx}", (top.txCount ?? 0).toLocaleString(loc));
  }, [loc, street, t, title]);
  const yardLabel = useMemo(() => {
    let turbo = 0;
    let normal = 0;
    let below = 0;
    for (const b of balls) {
      const z = feeZone(b.feeRate, fees);
      if (z === 2) turbo++;
      else if (z === 1) normal++;
      else below++;
    }
    const base = t("home.yardLabel").replace("{n}", pool.toLocaleString(loc));
    if (!fees || !balls.length) return base;
    const levels = t("home.yardLevels")
      .replace("{t}", turbo.toLocaleString(loc))
      .replace("{m}", normal.toLocaleString(loc))
      .replace("{b}", below.toLocaleString(loc));
    // The wrap's count as drawn on it.
    return wrapN > 0 ? `${base}; ${levels}; ${t("home.yardMore").replace("{n}", wrapN.toLocaleString(loc))}` : `${base}; ${levels}`;
  }, [balls, fees, loc, pool, t, wrapN]);

  return (
    <div ref={hostRef} className="relative">
      <div className="grid grid-cols-1 items-stretch gap-2 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
        <section
          className="home-tile-enter mod h-full min-w-0 rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3 sm:px-5"
          style={enter[0]}
        >
          <div className="mb-2 flex h-[22px] items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 overflow-hidden">
              <h2 className="m-0 shrink-0 text-[13px] leading-none" style={{ color: HOME.forming }}>
                {title}
              </h2>
              {active ? (
                <>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums leading-none tracking-tight">
                    <ReelText text={active.height.toLocaleString(loc)} />
                  </span>
                  <span className="shrink-0 text-[12px] font-medium leading-none text-[var(--muted-2)]">
                    <ReelText text={(activeTxs ?? 0).toLocaleString(loc)} />
                    <span className="ml-0.5">{txUnit}</span>
                  </span>
                  <span key={active.timestamp} className="hover-stamp min-w-0 truncate text-[12px] font-medium leading-none tabular-nums text-[var(--muted)]">
                    {fmtCreated(active.timestamp)}
                  </span>
                </>
              ) : null}
            </div>
            <Link prefetch={false} href="/blocks" className="tap-44 shrink-0 text-[13px] leading-none text-[var(--muted)] hover:text-[var(--text)]">
              {all}
            </Link>
          </div>
          <div className="relative w-full" style={{ height: CITY_H }}>
            <canvas
              ref={cityRef}
              className="block h-full w-full select-none"
              role="img"
              aria-label={cityLabel}
              onPointerMove={(ev) => {
                if (ev.pointerType === "touch") return;
                const hit = pickTower(ev);
                ev.currentTarget.style.cursor = hit ? "pointer" : "default";
                hoverCity(hit?.id ?? null);
                showCityTip(hit);
              }}
              onPointerLeave={(ev) => {
                if (ev.pointerType === "touch") return;
                ev.currentTarget.style.cursor = "default";
                hoverCity(null);
                showCityTip(null);
              }}
              onPointerDown={(ev) => {
                const down = ev.pointerType === "touch";
                const hit = down ? pickTower(ev) : null;
                touch.current = { down, open: Boolean(down && hit && tipOn.current.city === hit.id && cityTip.isOpen()) };
                if (!down || touch.current.open) return;
                hoverCity(hit?.id ?? null);
                showCityTip(hit, true);
              }}
              onClick={(ev) => {
                const hit = pickTower(ev);
                if (!hit) return;
                if (touch.current.down && !touch.current.open) return;
                router.push(`/block/${encodeURIComponent(hit.id)}`);
              }}
            />
          </div>
          <div className="sr-only">
            {street.slice(0, 12).map((b) => (
              <Link prefetch={false} key={b.id} href={`/block/${encodeURIComponent(b.id)}`}>
                {b.height.toLocaleString(loc)}
              </Link>
            ))}
          </div>
        </section>

        <section
          className="home-tile-enter home-meet-right mod flex h-full min-w-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-3.5 py-3 sm:px-5"
          style={enter[1]}
        >
          <div className="mb-2 flex h-[22px] items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 overflow-hidden">
              <h2 className="m-0 shrink-0 text-[13px] leading-none" style={{ color: HOME.forming }}>
                {mempoolTitle}
              </h2>
              <span
                className={clsx("mb-px inline-block h-1.5 w-1.5 shrink-0 rounded-full", !reduce && "cadence-live-dot")}
                style={{ background: HOME.forming }}
              />
              <span className="min-w-0 truncate text-[13px] font-semibold tabular-nums leading-[1.15] tracking-tight text-[var(--text)]">
                <ReelText text={formingHeight > 1 ? formingHeight.toLocaleString(loc) : "—"} />
              </span>
              <KpiNum className="max-w-none shrink-0 text-[13px] font-semibold tabular-nums leading-none tracking-tight">
                <ReelText text={shown.toLocaleString(loc)} />
                <span className="ml-0.5 text-[12px] font-medium text-[var(--muted-2)]">{txUnit}</span>
              </KpiNum>
              <span className="shrink-0 text-[12px] leading-none text-[var(--muted)]">
                <FormingAge ts={formingSince} />
              </span>
            </div>
            <Link prefetch={false} href="/mempool" className="tap-44 text-[13px] leading-none text-[var(--muted)] hover:text-[var(--text)]">
              {all}
            </Link>
          </div>
          <div className="relative" style={{ height: CITY_H }}>
            <canvas
              ref={yardRef}
              className="block h-full w-full select-none"
              role="img"
              aria-label={yardLabel}
              onPointerMove={(ev) => {
                if (ev.pointerType === "touch") return;
                const hit = pickCrate(ev);
                const on = hit === "empty" ? null : hit;
                ev.currentTarget.style.cursor = "pointer";
                engineRef.current?.setHover("yard", on?.id ?? null);
                showYardTip(on);
              }}
              onPointerLeave={(ev) => {
                if (ev.pointerType === "touch") return;
                ev.currentTarget.style.cursor = "default";
                engineRef.current?.setHover("yard", null);
                showYardTip(null);
              }}
              onPointerDown={(ev) => {
                const down = ev.pointerType === "touch";
                touch.current = { down, open: false };
                if (!down) return;
                const hit = pickCrate(ev);
                if (hit === "empty") {
                  // A tap on the empty lot opens the mempool page, unless it only closes an open tip.
                  touch.current.open = !yardTip.isOpen();
                  if (!touch.current.open) {
                    showYardTip(null);
                    engineRef.current?.setHover("yard", null);
                  }
                  return;
                }
                touch.current.open = tipOn.current.yard === yardKey(hit) && yardTip.isOpen();
                if (touch.current.open) return;
                engineRef.current?.setHover("yard", hit.id);
                showYardTip(hit, true);
              }}
              onClick={(ev) => {
                const hit = pickCrate(ev);
                if (touch.current.down && !touch.current.open) return;
                if (hit === "empty" || hit.id == null) {
                  router.push("/mempool");
                  return;
                }
                router.push(`/tx/${encodeURIComponent(hit.id)}`);
              }}
            />
          </div>
          <p className="mt-1.5 truncate text-[12px] tabular-nums leading-[1.15] text-[var(--muted-2)]">{foot}</p>
        </section>
      </div>
      <canvas ref={flyRef} aria-hidden className="pointer-events-none absolute left-0 top-0 z-10" width={0} height={0} />
    </div>
  );
}

/** Both canvases: the old track (52) and its head room (64). */
const CITY_H = 116;

type PairProps = Parameters<typeof HomeCityPairLive>[0];

/** One throw in the scene must never take the home page with it: the cards stay, without their pictures. */
class CityGuard extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn("[home-city]", e);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The two cards as plain frames: titles, «All» links, the same height. */
function StaticPair({ title, mempoolTitle, all }: { title: string; mempoolTitle: string; all: string }) {
  const cards: [string, string][] = [
    [title, "/blocks"],
    [mempoolTitle, "/mempool"],
  ];
  return (
    <div className="grid grid-cols-1 items-stretch gap-2 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
      {cards.map(([name, href]) => (
        <section key={href} className="mod h-full min-w-0 rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3 sm:px-5">
          <div className="mb-2 flex h-[22px] items-center justify-between gap-3">
            <h2 className="m-0 shrink-0 text-[13px] leading-none" style={{ color: HOME.forming }}>
              {name}
            </h2>
            <Link prefetch={false} href={href} className="tap-44 shrink-0 text-[13px] leading-none text-[var(--muted)] hover:text-[var(--text)]">
              {all}
            </Link>
          </div>
          <div style={{ height: CITY_H }} />
        </section>
      ))}
    </div>
  );
}

export function HomeCityPair(props: PairProps) {
  return (
    <CityGuard fallback={<StaticPair title={props.title} mempoolTitle={props.mempoolTitle} all={props.all} />}>
      <HomeCityPairLive {...props} />
    </CityGuard>
  );
}
