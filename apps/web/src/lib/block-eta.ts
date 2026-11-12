"use client";

import { useEffect, useState } from "react";

export type BlockEtaInfo = {
  lastBlockTs?: number;
  avgIntervalMs?: number;
  nextEtaSec?: number;
};

/**
 * Seconds left to the next block, counted down every second from the last block and the
 * average interval (the server's `nextEtaSec` is a one-off snapshot). 0 means the block is due.
 */
export function useNextBlockLeft(eta: BlockEtaInfo | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (eta && (eta.lastBlockTs ?? 0) > 0 && (eta.avgIntervalMs ?? 0) > 0) {
    return Math.max(0, (eta.lastBlockTs! + eta.avgIntervalMs! - now) / 1000);
  }
  const s = eta?.nextEtaSec;
  return s != null && Number.isFinite(s) ? Math.max(0, s) : null;
}

/** «1m 5s» / «42s»; null when unknown. Under a second counts as due. */
export function formatEtaLeft(sec: number | null): string | null {
  if (sec == null || sec < 1) return null;
  const s = Math.floor(sec);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
