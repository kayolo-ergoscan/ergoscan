"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { usePathname } from "next/navigation";
import type { SealEvent } from "@ergoscan/shared";
import { formatStamp } from "@/lib/format";
import { useT } from "@/lib/i18n/I18nProvider";
import { getWsUrl } from "./config";

/** Cap stored pit seeds so home does not hold a full mempool dump in React. */
const STREAM_BALL_CAP = 80;

export type StreamMempoolBall = {
  id: string;
  size: number;
  fee: number;
  feeRate: number;
  color: string;
  firstSeen: number;
  category: string;
  platform: string | null;
  action?: string | null;
  value: number;
};

export type ChainTip = {
  height: number;
  headerId: string;
  updatedAt?: string | null;
};

type PageSync = {
  bump: number;
  syncedAt: number | null;
  tip: ChainTip | null;
  markSynced: (at?: number | string | null) => void;
};

type StreamMempool = {
  mempoolCount: number | null;
  streamLive: boolean;
  balls: StreamMempoolBall[];
  totalSize: number | null;
  totalFees: number | null;
  seal: SealEvent | null;
};

const Ctx = createContext<PageSync>({
  bump: 0,
  syncedAt: null,
  tip: null,
  markSynced: () => {},
});

const MempoolCtx = createContext<StreamMempool>({
  mempoolCount: null,
  streamLive: false,
  balls: [],
  totalSize: null,
  totalFees: null,
  seal: null,
});

function parseSyncAt(at?: number | string | null): number {
  if (typeof at === "number" && Number.isFinite(at)) return at;
  if (typeof at === "string" && at.trim()) {
    const ms = Date.parse(at);
    if (Number.isFinite(ms)) return ms;
  }
  return Date.now();
}

function isChainTip(msg: unknown): msg is { type: "chain.tip"; data: ChainTip } {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as { type?: unknown; data?: { height?: unknown; headerId?: unknown } };
  return (
    m.type === "chain.tip" &&
    typeof m.data?.height === "number" &&
    Number.isFinite(m.data.height) &&
    typeof m.data.headerId === "string" &&
    m.data.headerId.length >= 16
  );
}

function parseStreamBall(raw: unknown): StreamMempoolBall | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const id = String(b.txId || b.id || "").trim();
  if (!id) return null;
  const size = Number(b.size) || 0;
  const fee = Number(b.fee) || 0;
  const feeRate =
    typeof b.feeRate === "number" && Number.isFinite(b.feeRate) && b.feeRate > 0
      ? b.feeRate
      : size > 0
        ? fee / size
        : 0;
  return {
    id,
    size,
    fee,
    feeRate,
    color: typeof b.color === "string" ? b.color : "",
    firstSeen: Number(b.firstSeen) || 0,
    category: typeof b.category === "string" && b.category ? b.category : "unknown",
    platform: typeof b.platform === "string" && b.platform ? b.platform : null,
    action: typeof b.action === "string" && b.action ? b.action : null,
    value: Number.isFinite(Number(b.value)) ? Number(b.value) : 0,
  };
}

function capStreamBalls(rows: StreamMempoolBall[]): StreamMempoolBall[] {
  if (rows.length <= STREAM_BALL_CAP) return rows;
  return [...rows].sort((a, b) => b.firstSeen - a.firstSeen).slice(0, STREAM_BALL_CAP);
}

const HELD_MS = 20_000;
const HELD_MAX = 240;

type HeldBall = { ball: StreamMempoolBall; at: number };

function rememberBall(held: Map<string, HeldBall>, ball: StreamMempoolBall | undefined, now: number) {
  if (!ball || held.has(ball.id)) return;
  held.set(ball.id, { ball, at: now });
}

function pruneHeld(held: Map<string, HeldBall>, now: number) {
  for (const [id, row] of held) {
    if (now - row.at > HELD_MS) held.delete(id);
  }
  if (held.size <= HELD_MAX) return;
  const oldest = [...held.entries()].sort((a, b) => a[1].at - b[1].at);
  const drop = held.size - HELD_MAX;
  for (let i = 0; i < drop; i++) held.delete(oldest[i][0]);
}

function recallHeld(held: Map<string, HeldBall>, ids: readonly string[]): StreamMempoolBall[] {
  const extra: StreamMempoolBall[] = [];
  for (const id of ids) {
    const row = held.get(id);
    if (row) extra.push(row.ball);
  }
  return extra;
}

function isSealEvent(raw: unknown): raw is SealEvent {
  if (!raw || typeof raw !== "object") return false;
  const s = raw as { height?: unknown; blockId?: unknown; txIds?: unknown };
  return (
    typeof s.height === "number" &&
    Number.isFinite(s.height) &&
    typeof s.blockId === "string" &&
    s.blockId.length >= 16 &&
    Array.isArray(s.txIds)
  );
}

type SealedBag = { until: number; ids: Set<string> };

const EMPTY_SEALED = new Set<string>();

type StreamSetters = {
  setTip: Dispatch<SetStateAction<ChainTip | null>>;
  setMempoolCount: Dispatch<SetStateAction<number | null>>;
  setBalls: Dispatch<SetStateAction<StreamMempoolBall[]>>;
  setTotalSize: Dispatch<SetStateAction<number | null>>;
  setTotalFees: Dispatch<SetStateAction<number | null>>;
  setSeal: Dispatch<SetStateAction<SealEvent | null>>;
  ballsRef: { current: StreamMempoolBall[] };
  heldRef: { current: Map<string, HeldBall> };
  sealedRef: { current: SealedBag };
  markSynced: (at?: number | string | null) => void;
};

function sealedIds(s: StreamSetters): Set<string> {
  const bag = s.sealedRef.current;
  if (Date.now() > bag.until) return EMPTY_SEALED;
  return bag.ids;
}

function applyStreamMessage(msg: unknown, s: StreamSetters) {
  if (isChainTip(msg)) {
    s.setTip(msg.data);
    if (msg.data.updatedAt) s.markSynced(msg.data.updatedAt);
    else s.markSynced();
    return;
  }
  if (!msg || typeof msg !== "object") return;
  const m = msg as { type?: unknown; data?: unknown };
  if (m.type === "mempool.snapshot") {
    const data = (m.data || {}) as {
      count?: unknown;
      totalSize?: unknown;
      totalFees?: unknown;
      balls?: unknown[];
    };
    const blocked = sealedIds(s);
    const parsed = capStreamBalls(
      (Array.isArray(data.balls) ? data.balls : [])
        .map(parseStreamBall)
        .filter((b): b is StreamMempoolBall => b != null && !blocked.has(b.id))
    );
    const now = Date.now();
    const parsedIds = new Set(parsed.map((p) => p.id));
    for (const prev of s.ballsRef.current) {
      if (!parsedIds.has(prev.id)) rememberBall(s.heldRef.current, prev, now);
    }
    for (const p of parsed) s.heldRef.current.delete(p.id);
    pruneHeld(s.heldRef.current, now);
    const n =
      typeof data.count === "number" && Number.isFinite(data.count) ? data.count : parsed.length;
    s.setMempoolCount(n);
    s.setBalls(parsed);
    s.setTotalSize(
      typeof data.totalSize === "number" && Number.isFinite(data.totalSize)
        ? data.totalSize
        : parsed.reduce((sum, row) => sum + row.size, 0)
    );
    s.setTotalFees(
      typeof data.totalFees === "number" && Number.isFinite(data.totalFees)
        ? data.totalFees
        : parsed.reduce((sum, row) => sum + row.fee, 0)
    );
    return;
  }
  if (m.type === "mempool.add") {
    const row = parseStreamBall(m.data);
    if (!row || sealedIds(s).has(row.id)) return;
    s.setMempoolCount((n) => (n == null ? 1 : n + 1));
    s.setBalls((prev) => (prev.some((b) => b.id === row.id) ? prev : capStreamBalls([...prev, row])));
    s.setTotalSize((n) => (n == null ? row.size : n + row.size));
    s.setTotalFees((n) => (n == null ? row.fee : n + row.fee));
    return;
  }
  if (m.type === "mempool.remove") {
    const id =
      m.data && typeof m.data === "object" && "id" in m.data
        ? String((m.data as { id?: unknown }).id || "")
        : "";
    if (!id) return;
    const gone = s.ballsRef.current.find((b) => b.id === id);
    rememberBall(s.heldRef.current, gone, Date.now());
    s.setMempoolCount((n) => (n == null ? 0 : Math.max(0, n - 1)));
    s.setBalls((prev) => prev.filter((b) => b.id !== id));
    if (gone) {
      s.setTotalSize((n) => (n == null ? 0 : Math.max(0, n - gone.size)));
      s.setTotalFees((n) => (n == null ? 0 : Math.max(0, n - gone.fee)));
    }
    return;
  }
  if (m.type === "block.sealed" && isSealEvent(m.data)) {
    s.sealedRef.current = { until: Date.now() + 30_000, ids: new Set(m.data.txIds) };
    s.setSeal(m.data);
    const extra = recallHeld(s.heldRef.current, m.data.txIds);
    if (extra.length) {
      s.setBalls((prev) => {
        const have = new Set(prev.map((b) => b.id));
        const add = extra.filter((b) => !have.has(b.id));
        return add.length ? [...prev, ...add] : prev;
      });
    }
  }
}

export function PageSyncProvider({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [bump, setBump] = useState(0);
  const [tip, setTip] = useState<ChainTip | null>(null);
  const [mempoolCount, setMempoolCount] = useState<number | null>(null);
  const [streamLive, setStreamLive] = useState(false);
  const [balls, setBalls] = useState<StreamMempoolBall[]>([]);
  const [totalSize, setTotalSize] = useState<number | null>(null);
  const [totalFees, setTotalFees] = useState<number | null>(null);
  const [seal, setSeal] = useState<SealEvent | null>(null);
  const ballsRef = useRef<StreamMempoolBall[]>([]);
  ballsRef.current = balls;
  const heldRef = useRef<Map<string, HeldBall>>(new Map());
  const sealedRef = useRef<SealedBag>({ until: 0, ids: new Set() });

  const markSynced = useCallback((at?: number | string | null) => {
    setSyncedAt(parseSyncAt(at));
  }, []);

  useEffect(() => {
    setBump(0);
  }, [path]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      setBump((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    let dead = false;
    let retry: ReturnType<typeof setTimeout>;
    let ws: WebSocket | null = null;

    const connect = () => {
      if (dead) return;
      try {
        ws = new WebSocket(getWsUrl());
        ws.onopen = () => {
          if (!dead) setStreamLive(true);
        };
        ws.onclose = () => {
          setStreamLive(false);
          if (!dead) retry = setTimeout(connect, 2000);
        };
        ws.onerror = () => ws?.close();
        ws.onmessage = (ev) => {
          try {
            const msg: unknown = JSON.parse(String(ev.data));
            applyStreamMessage(msg, {
              setTip,
              setMempoolCount,
              setBalls,
              setTotalSize,
              setTotalFees,
              setSeal,
              ballsRef,
              heldRef,
              sealedRef,
              markSynced,
            });
          } catch {
            /* ignore */
          }
        };
      } catch {
        retry = setTimeout(connect, 3000);
      }
    };

    connect();
    return () => {
      dead = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [markSynced]);

  const value = useMemo(
    () => ({ bump, syncedAt, tip, markSynced }),
    [bump, syncedAt, tip, markSynced]
  );
  const mempoolValue = useMemo(
    () => ({ mempoolCount, streamLive, balls, totalSize, totalFees, seal }),
    [mempoolCount, streamLive, balls, totalSize, totalFees, seal]
  );

  return (
    <Ctx.Provider value={value}>
      <MempoolCtx.Provider value={mempoolValue}>{children}</MempoolCtx.Provider>
    </Ctx.Provider>
  );
}

export function usePageSync(): PageSync {
  return useContext(Ctx);
}

export function useStreamMempool(): StreamMempool {
  return useContext(MempoolCtx);
}

/** First page of home/blocks/txs: reload snapshot when chain.tip moves. */
export function useChainTipRefresh(enabled: boolean, reload: () => void) {
  const { tip } = usePageSync();
  const seen = useRef<string | null>(null);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    if (!enabled) {
      seen.current = null;
      return;
    }
    if (!tip) return;
    const key = `${tip.height}:${tip.headerId}`;
    if (seen.current === null) {
      seen.current = key;
      return;
    }
    if (seen.current === key) return;
    seen.current = key;
    reloadRef.current();
  }, [enabled, tip]);
}

/** Silent refetch when the browser tab becomes visible again. */
export function useKeepFresh(reload: (silent: boolean) => void) {
  const { bump, markSynced } = usePageSync();
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const seen = useRef(bump);

  useEffect(() => {
    if (bump === seen.current) return;
    seen.current = bump;
    if (bump === 0) return;
    reloadRef.current(true);
  }, [bump]);

  return markSynced;
}

function ageParts(syncedAt: number, now: number): { n: string; unit: "s" | "m" | "h" | "d" | "now" } {
  const sec = Math.max(0, Math.floor((now - syncedAt) / 1000));
  if (sec < 2) return { n: "", unit: "now" };
  if (sec < 60) return { n: String(sec), unit: "s" };
  if (sec < 3600) return { n: String(Math.floor(sec / 60)), unit: "m" };
  if (sec < 86400) return { n: String(Math.floor(sec / 3600)), unit: "h" };
  return { n: String(Math.floor(sec / 86400)), unit: "d" };
}

export function SyncChip({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const { syncedAt, tip } = usePageSync();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const age = syncedAt != null ? ageParts(syncedAt, now) : null;
  const title = [
    t("sync.hint"),
    tip != null ? `tip ${tip.height}` : null,
    syncedAt ? formatStamp(syncedAt) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const ageText =
    age == null ? "—" : age.unit === "now" ? t("sync.justNow") : `${age.n}${age.unit}`;
  const showAgo = age != null && age.unit !== "now";

  return (
    <span
      className={
        compact
          ? "inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-[var(--muted-2)]"
          : "inline-flex h-8 items-center gap-1.5 text-[12px] text-[var(--muted)]"
      }
      title={title || undefined}
    >
      <SyncIcon />
      <span className="whitespace-nowrap">
        {t("sync.synced")}{" "}
        <span
          suppressHydrationWarning
          className={
            age == null
              ? "inline-block min-w-[4.5ch] tabular-nums text-[var(--muted)]"
              : "inline-block min-w-[4.5ch] font-semibold tabular-nums text-[var(--up)]"
          }
        >
          {ageText}
        </span>
        <span className="inline-block min-w-[3.25rem]">
          {showAgo ? ` ${t("sync.ago")}` : "\u00a0"}
        </span>
      </span>
    </span>
  );
}

function SyncIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 text-[var(--text)]">
      <circle
        cx="8"
        cy="8"
        r="6.2"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeDasharray="2.1 1.7"
      />
      <path
        d="M5.15 8.15 7.05 10.05 10.85 5.9"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
