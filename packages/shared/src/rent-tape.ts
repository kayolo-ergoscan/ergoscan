/**
 * Home storage-rent tape: addresses whose boxes become due in the
 * remaining header epoch (not the years-overdue oldest pile).
 * Indexer probes a short soonest-box list, then aggregates those addresses.
 * GET never walks the full due history.
 */

export const HOME_RENT_TAPE = 15;
export const HOME_RENT_PROBE = 80;
/** Header epoch (difficulty / votes), not the emission epoch. */
export const ERGO_HEADER_EPOCH_LEN = 1024;
/** ~24h at 720 blocks/day. Gold clock; due is coral. */
export const RENT_TAPE_SOON_BLOCKS = 720;
/** Due + 7d window on the Home rail. Same as indexer RENT_7D. */
export const RENT_TAPE_WEEK_BLOCKS = 5040;
/** 720 blocks/day. */
export const RENT_TAPE_BLOCKS_PER_HOUR = 30;

export type RentTapeRow = {
  address: string;
  boxCount: number;
  oldestCreationHeight: number;
  blocksUntilRent: number;
  rentNano: string;
  valueNano: string;
};

export type RentTapeTone = "due" | "soon" | "later";

/** First unique addresses in oldest-first probe order, cap HOME_RENT_TAPE. */
export function pickRentTapeAddresses(
  rows: ReadonlyArray<{ address?: string | null }>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const a = typeof row.address === "string" ? row.address.trim() : "";
    if (!a || seen.has(a)) continue;
    seen.add(a);
    out.push(a);
    if (out.length >= HOME_RENT_TAPE) break;
  }
  return out;
}

export function rentTapeTone(blocksUntilRent: number): RentTapeTone {
  if (!Number.isFinite(blocksUntilRent) || blocksUntilRent <= 0) return "due";
  if (blocksUntilRent < RENT_TAPE_SOON_BLOCKS) return "soon";
  return "later";
}

/** 0 = collectable now. 1 = end of the 7d window. Kept for clocks, not crate placement. */
export function rentRailX(
  blocksUntilRent: number,
  weekBlocks = RENT_TAPE_WEEK_BLOCKS
): number {
  if (!Number.isFinite(blocksUntilRent) || blocksUntilRent <= 0) return 0;
  if (!Number.isFinite(weekBlocks) || weekBlocks <= 0) return 1;
  return Math.min(1, blocksUntilRent / weekBlocks);
}

export type RentRailPip = {
  address: string;
  t: number;
  /** 0 = floor terrace, 1 = top of the yard. Long tapes use three bands. */
  y: number;
  stack: number;
};

/** Front terrace (near the caption). */
export const RENT_YARD_FRONT = 0.08;
/** Middle terrace — third shelf when the tape is long. */
export const RENT_YARD_MID = 0.4;
/** Back terrace — miner climbs here last. */
export const RENT_YARD_BACK = 0.72;

function yardRowSizes(n: number, rows: number): number[] {
  const base = Math.floor(n / rows);
  const extra = n % rows;
  return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Yard in probe order. 1–3: one row. 4–6: two-row S-path.
 * 7+: three terraces, S-path L→R / R→L / L→R. Time stays on the caption.
 */
export function rentRailLayout(
  rows: ReadonlyArray<{ address: string; blocksUntilRent: number }>
): RentRailPip[] {
  const n = rows.length;
  if (!n) return [];
  if (n <= 3) {
    return rows.map((row, i) => ({
      address: row.address,
      t: (i + 0.5) / n,
      y: RENT_YARD_MID,
      stack: 0,
    }));
  }
  const bands =
    n <= 6
      ? [RENT_YARD_FRONT, RENT_YARD_BACK]
      : [RENT_YARD_FRONT, RENT_YARD_MID, RENT_YARD_BACK];
  const sizes = yardRowSizes(n, bands.length);
  const out: RentRailPip[] = [];
  let i = 0;
  for (let r = 0; r < bands.length; r++) {
    const len = sizes[r] ?? 0;
    const rtl = r % 2 === 1;
    for (let c = 0; c < len; c++) {
      const row = rows[i++];
      if (!row) break;
      const col = rtl ? len - 1 - c : c;
      out.push({
        address: row.address,
        t: (col + 0.5) / len,
        y: bands[r]!,
        stack: 0,
      });
    }
  }
  return out;
}

/** About two minutes a block. */
export const RENT_TAPE_MINUTES_PER_BLOCK = 2;
/** Hours up to two days, then days: "36h" says more than "2d". */
export const RENT_TAPE_HOURS_UNTIL = 1440;

export type RentClockUnit = "m" | "h" | "d";
export type RentClock = { due: true } | { due: false; n: number; unit: RentClockUnit; label: string };

/**
 * Cadence-like clock: due | 6m | 6h | 2d. Under an hour it counts minutes, so 1–29 blocks
 * never read as "1h". `label` is the compact English form; the UI localises `n` + `unit`.
 */
export function rentTapeClock(blocksUntilRent: number): RentClock {
  if (!Number.isFinite(blocksUntilRent) || blocksUntilRent <= 0) return { due: true };
  if (blocksUntilRent < RENT_TAPE_BLOCKS_PER_HOUR) {
    const n = Math.max(1, Math.round(blocksUntilRent * RENT_TAPE_MINUTES_PER_BLOCK));
    return { due: false, n, unit: "m", label: `${n}m` };
  }
  if (blocksUntilRent < RENT_TAPE_HOURS_UNTIL) {
    const n = Math.max(1, Math.round(blocksUntilRent / RENT_TAPE_BLOCKS_PER_HOUR));
    return { due: false, n, unit: "h", label: `${n}h` };
  }
  const n = Math.max(1, Math.round(blocksUntilRent / RENT_TAPE_SOON_BLOCKS));
  return { due: false, n, unit: "d", label: `${n}d` };
}

/**
 * `null` = field missing / not an array (keep previous on the client).
 * `[]` = known empty tape.
 */
export function parseRentTape(raw: unknown): RentTapeRow[] | null {
  if (!Array.isArray(raw)) return null;
  const out: RentTapeRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const address = typeof r.address === "string" ? r.address.trim() : "";
    if (!address) continue;
    const boxCount = Math.trunc(Number(r.boxCount));
    const oldestCreationHeight = Math.trunc(Number(r.oldestCreationHeight));
    const blocksUntilRent = Math.trunc(Number(r.blocksUntilRent));
    if (!Number.isFinite(boxCount) || boxCount < 1) continue;
    if (!Number.isFinite(oldestCreationHeight)) continue;
    if (!Number.isFinite(blocksUntilRent) || blocksUntilRent < 0) continue;
    out.push({
      address,
      boxCount,
      oldestCreationHeight,
      blocksUntilRent,
      rentNano: String(r.rentNano ?? "0"),
      valueNano: String(r.valueNano ?? "0"),
    });
    if (out.length >= HOME_RENT_TAPE) break;
  }
  return out;
}

export function headerEpochBlocksLeft(height: number): number {
  if (!Number.isFinite(height) || height < 0) return ERGO_HEADER_EPOCH_LEN;
  const slot = Math.trunc(height) % ERGO_HEADER_EPOCH_LEN;
  return ERGO_HEADER_EPOCH_LEN - slot;
}

/** Tape pack only — fallback when snapshot omits `thisEpoch`. */
export function epochTapeBoxes(
  rows: ReadonlyArray<{ boxCount: number; blocksUntilRent: number }>,
  blocksLeft: number
): number {
  let n = 0;
  for (const r of rows) {
    if (r.blocksUntilRent <= blocksLeft) n += r.boxCount;
  }
  return n;
}

export function parseRentEpochBoxes(raw: unknown): number | null {
  const v =
    raw && typeof raw === "object" && "boxCount" in raw
      ? (raw as { boxCount: unknown }).boxCount
      : raw;
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** `thisEpoch.rentNano` — estimated rent due before this header epoch ends. */
export function parseRentEpochNano(raw: unknown): string | null {
  const v =
    raw && typeof raw === "object" && "rentNano" in raw
      ? (raw as { rentNano: unknown }).rentNano
      : raw;
  if (v == null) return null;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return null;
  return s;
}
