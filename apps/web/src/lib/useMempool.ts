"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BallProps, FeeHistogram, MempoolSnapshot, NodeInfoLite, WsServerEvent } from "@ergoscan/shared";
import { getGateway, getWsUrl } from "./config";
import { usePageSync } from "./page-sync";

/** A tx that went into a block stays on the list this long (fill, block number, fold). */
export const MEMPOOL_LEAVE_MS = 1900;
/** Sealed ids are not taken back from a snapshot or poll that was older than the block. */
const SEALED_KEEP_MS = 60_000;
/** «Block N took K» under the count. */
const LAST_SEAL_MS = 30_000;

export type MempoolLeaving = { ball: BallProps; height: number; at: number };
export type MempoolLastSeal = { height: number; took: number; at: number };

export function useMempool(initialBalls?: BallProps[], initialP50?: number | null) {
  const { markSynced, bump } = usePageSync();
  const seenBump = useRef(bump);
  const [balls, setBalls] = useState<BallProps[]>(() =>
    Array.isArray(initialBalls) ? initialBalls : []
  );
  const [fees, setFees] = useState<FeeHistogram | null>(() =>
    initialP50 != null && Number.isFinite(initialP50)
      ? {
          ts: 0,
          buckets: [],
          p50: initialP50,
          p90: initialP50,
          recommend: { economy: initialP50, normal: initialP50, turbo: initialP50 },
        }
      : null
  );
  const [node, setNode] = useState<NodeInfoLite | null>(null);
  const [mock, setMock] = useState(true);
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<BallProps | null>(null);
  const [leaving, setLeaving] = useState<MempoolLeaving[]>([]);
  const [lastSeal, setLastSeal] = useState<MempoolLastSeal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ballsRef = useRef(balls);
  ballsRef.current = balls;
  const sealedRef = useRef<Map<string, number>>(new Map());

  const isSealed = useCallback((id: string) => {
    const at = sealedRef.current.get(id);
    return at != null && Date.now() - at < SEALED_KEEP_MS;
  }, []);

  const applySnapshot = useCallback((s: MempoolSnapshot) => {
    setBalls(s.balls.filter((b) => !isSealed(b.id)));
    markSynced();
  }, [markSynced, isSealed]);

  /** Block first: its txs leave the list as «in block N», not as a plain removal. */
  const applySeal = useCallback((height: number, txIds: readonly string[]) => {
    const now = Date.now();
    const sealed = sealedRef.current;
    for (const [id, at] of sealed) if (now - at > SEALED_KEEP_MS) sealed.delete(id);
    const ids = new Set(txIds);
    for (const id of ids) sealed.set(id, now);
    const going = ballsRef.current.filter((b) => ids.has(b.id));
    setLastSeal({ height, took: going.length, at: now });
    if (!going.length) return;
    setLeaving((prev) => [
      ...prev.filter((l) => !ids.has(l.ball.id)),
      ...going.map((ball) => ({ ball, height, at: now })),
    ]);
    setBalls((prev) => prev.filter((b) => !ids.has(b.id)));
    setSelected((cur) => (cur && ids.has(cur.id) ? null : cur));
  }, []);

  useEffect(() => {
    let dead = false;
    let retry: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (dead) return;
      try {
        const ws = new WebSocket(getWsUrl());
        wsRef.current = ws;
        ws.onopen = () => {
          setConnected(true);
          ws.send(JSON.stringify({ op: "subscribe", channels: ["mempool", "fees", "blocks"] }));
        };
        ws.onclose = () => {
          setConnected(false);
          retry = setTimeout(connect, 2000);
        };
        ws.onerror = () => ws.close();
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data)) as WsServerEvent;
            if (msg.type === "hello") setMock(msg.data.mock);
            if (msg.type === "mempool.snapshot") applySnapshot(msg.data);
            if (msg.type === "block.sealed" && Array.isArray(msg.data?.txIds)) {
              applySeal(msg.data.height, msg.data.txIds);
            }
            if (msg.type === "mempool.add") {
              if (isSealed(msg.data.id)) return;
              setBalls((prev) => {
                if (prev.some((b) => b.id === msg.data.id)) return prev;
                return [...prev, msg.data];
              });
            }
            if (msg.type === "mempool.remove") {
              // A sealed tx is already leaving with its block number.
              if (isSealed(msg.data.id)) return;
              setBalls((prev) => prev.filter((b) => b.id !== msg.data.id));
              setSelected((s) => (s?.id === msg.data.id ? null : s));
            }
            if (msg.type === "fees.histogram") setFees(msg.data);
            if (msg.type === "node.info") setNode(msg.data);
          } catch {
            /* ignore */
          }
        };
      } catch {
        retry = setTimeout(connect, 3000);
      }
    };

    const poll = () => {
      if (dead) return;
      void fetch(`${getGateway()}/v1/mempool`)
        .then((r) => r.json())
        .then((s: MempoolSnapshot) => {
          if (!dead && Array.isArray(s?.balls)) applySnapshot(s);
        })
        .catch(() => {});
      void fetch(`${getGateway()}/v1/fees/histogram`)
        .then((r) => r.json())
        .then((f: FeeHistogram) => {
          if (!dead) setFees(f);
        })
        .catch(() => {});
    };
    poll();
    const iv = window.setInterval(poll, 8000);
    void fetch(`${getGateway()}/v1/health`)
      .then((r) => r.json())
      .then((h: { mock?: boolean }) => setMock(Boolean(h.mock)))
      .catch(() => {});

    connect();
    return () => {
      dead = true;
      clearTimeout(retry);
      window.clearInterval(iv);
      wsRef.current?.close();
    };
  }, [applySnapshot, applySeal, isSealed]);

  useEffect(() => {
    if (!leaving.length) return;
    const oldest = Math.min(...leaving.map((l) => l.at));
    const wait = Math.max(0, oldest + MEMPOOL_LEAVE_MS - Date.now());
    const id = window.setTimeout(() => {
      const now = Date.now();
      setLeaving((prev) => prev.filter((l) => now - l.at < MEMPOOL_LEAVE_MS));
    }, wait + 20);
    return () => window.clearTimeout(id);
  }, [leaving]);

  useEffect(() => {
    if (!lastSeal) return;
    const id = window.setTimeout(() => setLastSeal(null), Math.max(0, lastSeal.at + LAST_SEAL_MS - Date.now()));
    return () => window.clearTimeout(id);
  }, [lastSeal]);

  useEffect(() => {
    if (bump === seenBump.current) return;
    seenBump.current = bump;
    if (bump === 0) return;
    void fetch(`${getGateway()}/v1/mempool`)
      .then((r) => r.json())
      .then((s: MempoolSnapshot) => {
        if (Array.isArray(s?.balls)) applySnapshot(s);
      })
      .catch(() => {});
    void fetch(`${getGateway()}/v1/fees/histogram`)
      .then((r) => r.json())
      .then((f: FeeHistogram) => setFees(f))
      .catch(() => {});
  }, [bump, applySnapshot]);

  return { balls, leaving, lastSeal, fees, node, mock, connected, selected, setSelected };
}
