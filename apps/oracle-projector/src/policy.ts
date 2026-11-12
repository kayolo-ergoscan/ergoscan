export type OracleMode = "idle" | "tip" | "history" | "tip_hold";

export type OraclePlan = {
  mode: OracleMode;
  run: boolean;
  includeSpent: boolean;
  fromHeight: number | null;
  nextCursor: number;
};

export function historyEnabled(raw: string | undefined): boolean {
  return raw === "1" || raw === "true";
}

export function enabledFromEnv(raw: string | undefined): boolean {
  return raw === "1" || raw === "true";
}

export function liveIndexerLag(
  tip: number,
  lastHeight: number | null,
  snapLag: number | null
): number | null {
  if (lastHeight != null && Number.isFinite(lastHeight)) {
    return Math.max(0, tip - lastHeight);
  }
  if (snapLag != null && Number.isFinite(snapLag)) return Math.max(0, snapLag);
  return null;
}

/** Tip detect only looks at recent unspent boxes. Token-first box_assets
 *  (29k pool NFT / 700k oracle token) nest-loops old boxes the gix writer locks.
 *  Operator seats do not use this floor: token_balances holders → unspent by address. */
export const DEFAULT_DETECT_LOOKBACK = 8_000;

export function detectLookback(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DETECT_LOOKBACK;
  return Math.floor(n);
}

export function unspentMinHeight(tip: number, lookback: number): number {
  if (!Number.isFinite(tip) || tip <= 0) return 0;
  const span = Number.isFinite(lookback) && lookback > 0 ? Math.floor(lookback) : DEFAULT_DETECT_LOOKBACK;
  return Math.max(0, Math.floor(tip) - span);
}

/** Cursor never moves backward. */
export function clampCursor(cursor: number, tip: number): number {
  if (!Number.isFinite(cursor) || cursor <= 0) return tip;
  if (!Number.isFinite(tip) || tip <= 0) return cursor;
  return Math.max(cursor, tip);
}

export function planOracleTick(input: {
  enabled: boolean;
  history: boolean;
  historyBlocks: number;
  cursor: number;
  tip: number;
  indexerLag: number | null;
  pauseAt: number;
}): OraclePlan {
  if (!input.enabled) {
    return {
      mode: "idle",
      run: false,
      includeSpent: false,
      fromHeight: null,
      nextCursor: input.cursor,
    };
  }
  const tip = Math.max(0, Math.floor(input.tip) || 0);
  const cursor = Math.max(0, Math.floor(input.cursor) || 0);
  const lag = input.indexerLag;
  if (lag != null && lag >= input.pauseAt) {
    return {
      mode: "tip_hold",
      run: false,
      includeSpent: false,
      fromHeight: null,
      nextCursor: cursor,
    };
  }
  const nextCursor = tip > 0 ? Math.max(cursor, tip) : cursor;
  if (input.history) {
    const span = Math.max(0, Math.floor(input.historyBlocks) || 0);
    const fromHeight = tip > 0 ? Math.max(0, tip - span) : 0;
    return {
      mode: "history",
      run: tip > 0,
      includeSpent: true,
      fromHeight,
      nextCursor,
    };
  }
  return {
    mode: "tip",
    run: tip > 0,
    includeSpent: false,
    fromHeight: null,
    nextCursor,
  };
}

export function tickSleepMs(pollMs: number, mode: OracleMode): number {
  const base = Number.isFinite(pollMs) && pollMs > 0 ? pollMs : 4_000;
  if (mode === "tip_hold" || mode === "idle") return base * 2;
  return base;
}

/** A tip pass re-runs at least this often even on the same block (safety net). */
export const SAME_TIP_RERUN_MS = 60_000;

/**
 * Skip a tip pass when the chain tip (height and block id) is the one the last pass saw
 * (12 Nov 2026 audit: detect ran every ~4.9 s without a new block, ≈25 k scans/s).
 * A fork at the same height changes the id, so it still runs. History always runs.
 */
export function sameTipSkip(input: {
  mode: OracleMode;
  tipKey: string;
  lastRunKey: string | null;
  lastRunAt: number;
  now: number;
}): boolean {
  if (input.mode !== "tip") return false;
  if (!input.lastRunKey || input.tipKey !== input.lastRunKey) return false;
  return input.now - input.lastRunAt < SAME_TIP_RERUN_MS;
}
