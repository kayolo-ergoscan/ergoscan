/**
 * Lithos protocol figures for the /lithos page header: the rollup rules, the estimates and the
 * snapshot shape the indexer writes into `snapshot_kv.lithos_protocol` (field `stats`).
 *
 * Rules mirror Lithos-Protocol/Lithos-Client (lithos-lib `LFSMHelpers`, `EmissionSchedule`,
 * rollups/Holding_Logic.ergo, Evaluation.ergo, Payout.ergo, stats/MiningHistory.scala).
 *
 * Rollup boxes keep one shape through all three phases:
 *   R5 Int    miners who posted a NISP
 *   R6 BigInt sum of their claimed scores
 *   R7 Coll[Long] (period start, block height, bond total) in holding and evaluation;
 *      payout rewrites it to (ERG reward, LIT reward, bond still owed).
 * A round's bank is the box value less the refundable bonds (holding/evaluation R7(2)).
 */
import { decodeSigmaCollLong, decodeSigmaLong, flattenRegisterHex } from "./registers.js";

/** Blocks a holding box collects NISPs (`HOLDING_PERIOD`, 12 h). */
export const LITHOS_HOLDING_PERIOD = 360;
/** Blocks an evaluation box stays open to fraud proofs (`EVAL_PERIOD`). */
export const LITHOS_EVAL_PERIOD = 360;
/** A NISP's super-shares must lie within this many blocks of the round's block (`NISP_WINDOW`). */
export const LITHOS_NISP_WINDOW = 60;
/** A super-share is this many times the miner's share score (`NISP_COEFFICIENT`). */
export const LITHOS_NISP_COEFFICIENT = 10_000;
/** Super-shares in one NISP. */
export const LITHOS_NISP_SHARES = 10;
/** Live collateral boxes allowed at once (`EmissionSchedule.MAX_ACTIVE`). */
export const LITHOS_MAX_ACTIVE = 100;
/** Ergo target block interval, seconds. */
export const ERGO_BLOCK_SECONDS = 120;
/** Hashrate window: 7 days, extended back until it holds this many Lithos blocks. */
export const LITHOS_HASH_WINDOW_MS = 7 * 86_400_000;
/** Below this many blocks the Lithos client marks its estimate «sparse». */
export const LITHOS_HASH_MIN_BLOCKS = 20;

export const DAY_MS = 86_400_000;

/**
 * `packed.addr.addr_md5` (md5 of the base58 address) of the Lithos contracts. The full addresses
 * are long P2S strings; they are in the names registry (lithos-protocol.json, lithos.json).
 */
export const LITHOS_ADDR_MD5 = {
  /** Lithos holding (WvonkGz7pj74…). */
  holding: "c94437c23eb5adbaee7d5d560c15b4ce",
  /** Lithos evaluation (4CXJ3oDs6zN1…). */
  evaluation: "b18a5eeb582a8f33ced648f31dbcbf72",
  /** Lithos payout (3VaP5ZZQFaC1…). */
  payout: "0752096a2d520782eb23f0aca57e3b56",
  /** Lithos miner data (6r333qYnughof…): one box per registered miner. */
  minerData: "c1d1718a4cf00112d2063deabe809b6b",
  /** Lithos emission gate (4bvZT5H4tkhh…): lender deposits waiting for a slot. */
  emissionGate: "84b2002eb9bcff983c2aefa28087feea",
  /** Lithos collateral (foqgf3Ys6E6J…): the active collateral boxes. */
  collateral: "1bf5a1acab7946f8b4c637b4f85a67e1",
  /** LithosDex ERG/LIT pool (5dvtLSZsZvnb…). */
  litPool: "fea629cf5d463a2a72a2d67a9578c831",
} as const;

export type LithosAddrRole = keyof typeof LITHOS_ADDR_MD5;

/** Singleton NFT of the LithosDex ERG/LIT pool. */
export const LITHOS_LIT_POOL_NFT =
  "c0b21ac51481a5d242809d9b1e189a8baf3803fe347ca01833c1aeb380e6eb29";

/** Sigma BigInt constant: `06` + VLQ length + big-endian two's complement bytes. */
export function decodeSigmaBigInt(hex: string | null | undefined): bigint | null {
  const raw = flattenRegisterHex(hex);
  if (!raw || raw.length < 6 || raw.length % 2) return null;
  const h = raw.toLowerCase();
  if (!h.startsWith("06")) return null;
  let at = 2;
  let len = 0;
  let shift = 0;
  for (;;) {
    if (at + 2 > h.length) return null;
    const b = parseInt(h.slice(at, at + 2), 16);
    at += 2;
    len |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift > 14) return null;
  }
  if (len < 1 || len > 64 || at + len * 2 !== h.length) return null;
  const body = h.slice(at);
  let n = BigInt(`0x${body}`);
  if (parseInt(body.slice(0, 2), 16) & 0x80) n -= 1n << BigInt(len * 8);
  return n;
}

export type LithosRollupRegs = {
  miners: number;
  score: bigint;
  /** R7(0): period start in holding/evaluation, ERG reward in payout. */
  s0: number;
  /** R7(1): the round's block height in holding/evaluation. */
  s1: number;
  /** R7(2): refundable bonds still held, nanoERG. */
  bond: number;
};

/** R5/R6/R7 of a holding, evaluation or payout box. Null when any is not that shape. */
export function lithosRollupRegs(
  r5: unknown,
  r6: unknown,
  r7: unknown
): LithosRollupRegs | null {
  const miners = decodeSigmaLong(flattenRegisterHex(r5));
  const score = decodeSigmaBigInt(flattenRegisterHex(r6));
  const state = decodeSigmaCollLong(flattenRegisterHex(r7));
  if (miners == null || score == null || !state || state.length !== 3) return null;
  if (miners < 0n || score < 0n) return null;
  const [s0, s1, bond] = state as [bigint, bigint, bigint];
  if (bond < 0n) return null;
  return {
    miners: Number(miners),
    score,
    s0: Number(s0),
    s1: Number(s1),
    bond: Number(bond),
  };
}

/**
 * Lower bound, on average, of the hashrate behind a round's NISPs: each NISP holds ten
 * super-shares at score × 10 000, all inside the 60-block (7 200 s) window before the block.
 * H/s ≥ Σscore × 10 × 10 000 / 7 200.
 */
export function lithosNispLowerBoundHs(scoreSum: bigint): number {
  if (scoreSum <= 0n) return 0;
  const work = scoreSum * BigInt(LITHOS_NISP_SHARES * LITHOS_NISP_COEFFICIENT);
  return Number(work) / (LITHOS_NISP_WINDOW * ERGO_BLOCK_SECONDS);
}

export type LithosBlockSample = { height: number; ts: number; diff: bigint };

export type LithosHashWindow = {
  /** Exclusive start, ms. */
  from: number;
  /** Inclusive end (the tip's timestamp), ms. */
  to: number;
  /** Lithos blocks inside the window. */
  n: number;
  /** Σ network difficulty of those blocks. */
  diff: bigint;
  /** Σ difficulty ÷ window seconds. */
  hs: number;
  /** ±1/√n, the Poisson sampling error the client reports. */
  err: number;
  /** True when 7 days held fewer than 20 blocks and the window reaches further back. */
  extended: boolean;
};

/**
 * The Lithos client's block-sampling estimate (`MiningHistory.hashrate`): Σ difficulty of Lithos
 * blocks ÷ seconds covered. The window is the last 7 days; with fewer than 20 blocks in it, it
 * starts at the 21st newest block instead (exclusive), so it holds exactly 20 and the rate stays
 * unbiased. With 20 or fewer blocks in all, it starts at the first one.
 */
export function lithosHashWindow(
  blocks: readonly LithosBlockSample[],
  tipTs: number
): LithosHashWindow | null {
  if (!Number.isFinite(tipTs) || !blocks.length) return null;
  const desc = blocks
    .filter((b) => Number.isFinite(b.ts) && b.ts <= tipTs)
    .sort((a, b) => b.ts - a.ts || b.height - a.height);
  if (!desc.length) return null;
  let from = tipTs - LITHOS_HASH_WINDOW_MS;
  let inside = desc.filter((b) => b.ts > from);
  let extended = false;
  if (inside.length < LITHOS_HASH_MIN_BLOCKS) {
    extended = true;
    if (desc.length > LITHOS_HASH_MIN_BLOCKS) {
      from = desc[LITHOS_HASH_MIN_BLOCKS]!.ts;
      inside = desc.filter((b) => b.ts > from);
    } else {
      const first = desc[desc.length - 1]!;
      from = first.ts;
      inside = desc.slice(0, -1);
    }
  }
  const seconds = (tipTs - from) / 1000;
  if (!inside.length || seconds <= 0) return null;
  const diff = inside.reduce((s, b) => s + b.diff, 0n);
  return {
    from,
    to: tipTs,
    n: inside.length,
    diff,
    hs: Number(diff) / seconds,
    err: 1 / Math.sqrt(inside.length),
    extended,
  };
}

export function utcDay(ts: number): number {
  return Math.floor(ts / DAY_MS);
}

/** One UTC day of the header chart. Difficulty sums in units of 1e9 (so ÷ seconds = GH/s). */
export type LithosDay = {
  /** UTC day number (ms / 86 400 000). */
  d: number;
  /** Lithos blocks. */
  lb: number;
  /** Σ difficulty of Lithos blocks ÷ 1e9. */
  lg: number;
  /** All Ergo blocks. */
  nb: number;
  /** Σ difficulty of all blocks ÷ 1e9. */
  ng: number;
  /** Seconds covered, only on the last (partial) day. */
  s?: number;
};

export type LithosRound = {
  /** The round's block height. */
  h: number;
  /** Period start of the current phase. */
  start: number;
  miners: number;
  /** Box value less bonds, nanoERG. */
  bank: number;
};

export type LithosProtocolStats = {
  v: 1;
  tip: { height: number; ts: number };
  /** Network now: tip difficulty ÷ 120 (as on the home page). */
  netHs: number | null;
  hash: {
    from: number;
    to: number;
    n: number;
    /** All Ergo blocks in the same window. */
    netN: number;
    hs: number;
    err: number;
    extended: boolean;
  } | null;
  /** NISP lower bound of the newest round that has NISPs. */
  nisp: { h: number; miners: number; hs: number } | null;
  blocks: { total: number; d1: number; d7: number; launch: number | null };
  miners: { round: number | null; registry: number | null };
  rounds: {
    holding: LithosRound[];
    evaluation: LithosRound[];
    payoutN: number;
    payoutNano: number;
  };
  collateral: {
    active: number;
    activeNano: number;
    max: number;
    queue: number;
    queueNano: number;
  } | null;
  bank: {
    /** ERG the newest genesis put into its holding box (the collateral, less fees). */
    genesisNano: number | null;
    /** Mean bank of the rounds whose block is in the hashrate window. */
    avgNano: number | null;
    avgN: number;
    /** Σ bank of every round that reached holding. */
    totalNano: number;
    totalN: number;
  };
  /** ERG per 1 LIT from the LithosDex ERG/LIT pool reserves. */
  litErg: number | null;
  series: LithosDay[];
};

function num(v: unknown): number | null {
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(x) ? x : null;
}

function nn(v: unknown): number {
  const x = num(v);
  return x != null && x >= 0 ? x : 0;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function parseRound(raw: unknown): LithosRound | null {
  const r = obj(raw);
  if (!r) return null;
  const h = num(r.h);
  if (h == null || h <= 0) return null;
  return { h, start: nn(r.start), miners: nn(r.miners), bank: nn(r.bank) };
}

function parseDay(raw: unknown): LithosDay | null {
  const r = obj(raw);
  if (!r) return null;
  const d = num(r.d);
  if (d == null || d <= 0) return null;
  const out: LithosDay = { d, lb: nn(r.lb), lg: nn(r.lg), nb: nn(r.nb), ng: nn(r.ng) };
  const s = num(r.s);
  if (s != null && s > 0 && s < 86_400) out.s = s;
  return out;
}

/** Defensive read of `payload.stats`. Null when absent or not v1; bad parts become null/empty. */
export function parseLithosStats(raw: unknown): LithosProtocolStats | null {
  const r = obj(raw);
  if (!r || r.v !== 1) return null;
  const tip = obj(r.tip);
  const tipHeight = num(tip?.height);
  const tipTs = num(tip?.ts);
  if (tipHeight == null || tipTs == null) return null;
  const hash = obj(r.hash);
  const hs = num(hash?.hs);
  const nisp = obj(r.nisp);
  const blocks = obj(r.blocks);
  const miners = obj(r.miners);
  const rounds = obj(r.rounds);
  const col = obj(r.collateral);
  const bank = obj(r.bank);
  const list = (v: unknown) =>
    Array.isArray(v) ? v.map(parseRound).filter((x): x is LithosRound => x != null) : [];
  const litErg = num(r.litErg);
  return {
    v: 1,
    tip: { height: tipHeight, ts: tipTs },
    netHs: num(r.netHs),
    hash:
      hash && hs != null && hs >= 0 && nn(hash.n) > 0
        ? {
            from: nn(hash.from),
            to: nn(hash.to),
            n: nn(hash.n),
            netN: nn(hash.netN),
            hs,
            err: nn(hash.err),
            extended: hash.extended === true,
          }
        : null,
    nisp:
      nisp && num(nisp.hs) != null && nn(nisp.h) > 0
        ? { h: nn(nisp.h), miners: nn(nisp.miners), hs: nn(nisp.hs) }
        : null,
    blocks: {
      total: nn(blocks?.total),
      d1: nn(blocks?.d1),
      d7: nn(blocks?.d7),
      launch: num(blocks?.launch),
    },
    miners: { round: num(miners?.round), registry: num(miners?.registry) },
    rounds: {
      holding: list(rounds?.holding),
      evaluation: list(rounds?.evaluation),
      payoutN: nn(rounds?.payoutN),
      payoutNano: nn(rounds?.payoutNano),
    },
    collateral: col
      ? {
          active: nn(col.active),
          activeNano: nn(col.activeNano),
          max: nn(col.max) || LITHOS_MAX_ACTIVE,
          queue: nn(col.queue),
          queueNano: nn(col.queueNano),
        }
      : null,
    bank: {
      genesisNano: num(bank?.genesisNano),
      avgNano: num(bank?.avgNano),
      avgN: nn(bank?.avgN),
      totalNano: nn(bank?.totalNano),
      totalN: nn(bank?.totalN),
    },
    litErg: litErg != null && litErg > 0 ? litErg : null,
    series: Array.isArray(r.series)
      ? r.series.map(parseDay).filter((x): x is LithosDay => x != null)
      : [],
  };
}
