import type { BallProps, TxCategory } from "./types.js";
import { classifyTxShape, minerFeeFromOutputs } from "./tx-shape.js";

const R_MIN = 6;
const R_MAX = 28;

/** Category → base hue (dark theme) */
export const CATEGORY_COLORS: Record<TxCategory, string> = {
  transfer: "#5B8CFF",
  token: "#2DD4BF",
  nft: "#A78BFA",
  defi: "#FBBF24",
  bridge: "#22D3EE",
  mixer: "#E879F9",
  oracle: "#34D399",
  agent: "#FB923C",
  stable: "#94A3B8",
  unknown: "#64748B",
  contract: "#A78BFA",
  coinbase: "#34D399",
  "fee-collect": "#4ADE80",
  "reward-unlock": "#A3E635",
  "script-pay": "#7DD3FC",
};

export function radiusFromSize(sizeBytes: number): number {
  const r = Math.sqrt(Math.max(sizeBytes, 100)) * 0.45;
  return Math.max(R_MIN, Math.min(R_MAX, r));
}

export function feeRate(fee: number, size: number): number {
  if (size <= 0) return 0;
  return fee / size;
}

export function colorForCategory(cat: TxCategory, rate: number, p90: number): string {
  const base = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.unknown;
  void rate;
  void p90;
  return base;
}

export interface RawAsset {
  tokenId: string;
  amount: number | string;
}

export interface RawOutput {
  boxId?: string;
  value?: number;
  assets?: RawAsset[];
  address?: string;
  ergoTree?: string;
  templateHash?: string | null;
  additionalRegisters?: Record<string, string>;
  creationHeight?: number;
  transactionId?: string;
  index?: number;
}

export interface RawInput {
  boxId?: string;
  value?: number;
  assets?: RawAsset[];
  ergoTree?: string;
  templateHash?: string | null;
  address?: string;
  additionalRegisters?: Record<string, string>;
  creationHeight?: number;
  transactionId?: string;
  index?: number;
}

export interface RawTx {
  id: string;
  size?: number;
  inputs?: RawInput[];
  dataInputs?: RawInput[];
  outputs?: RawOutput[];
  [k: string]: unknown;
}

function collectTokenIds(tx: RawTx): string[] {
  const ids = new Set<string>();
  for (const box of [...(tx.inputs ?? []), ...(tx.outputs ?? [])]) {
    for (const a of box.assets ?? []) {
      if (a.tokenId) ids.add(a.tokenId);
    }
  }
  return [...ids];
}

export function classifyTx(tx: RawTx): {
  category: TxCategory;
  platform?: string;
  tokenIds: string[];
  ruleId?: string;
} {
  const r = classifyTxShape({
    inputs: tx.inputs,
    outputs: tx.outputs,
  });
  return {
    category: r.category as TxCategory,
    platform: r.protocol ?? undefined,
    tokenIds: collectTokenIds(tx),
    ruleId: r.ruleId,
  };
}

/**
 * Fee in nanoERG. On Ergo the miners-fee box is an output, so Σin−Σout is ~0
 * when inputs are fully known. Prefer that box; in−out only if it is missing.
 */
export function estimateFee(tx: RawTx): number {
  const inputs = tx.inputs ?? [];
  const outputs = tx.outputs ?? [];
  const paid = minerFeeFromOutputs(outputs);
  if (paid > 0) return paid;

  const inSum = inputs.reduce((s, i) => s + (Number(i.value) || 0), 0);
  const outSum = outputs.reduce((s, o) => s + (Number(o.value) || 0), 0);
  if (inSum > 0 && outSum >= 0 && inSum > outSum) {
    return Math.max(0, inSum - outSum);
  }
  if (inputs.length === 0) return 0;
  return 0;
}

/** Map raw mempool/confirmed tx → LoomThread (Parallel Box Loom). */
export function txToLoomThread(
  tx: RawTx,
  firstSeen = Date.now(),
  p90FeeRate = 0
): BallProps {
  const size = Number(tx.size) || estimateSize(tx);
  const fee = estimateFee(tx);
  const rate = feeRate(fee, size);
  const { category, platform, tokenIds } = classifyTx(tx);
  const value = (tx.outputs ?? []).reduce((s, o) => s + (Number(o.value) || 0), 0);

  const addrSet = new Set<string>();
  const inputBoxIds: string[] = [];
  for (const box of tx.inputs ?? []) {
    if (box.boxId) inputBoxIds.push(box.boxId);
    const a = (box as { address?: string }).address;
    if (a) addrSet.add(a);
  }
  for (const box of tx.outputs ?? []) {
    const a = (box as { address?: string }).address;
    if (a) addrSet.add(a);
  }

  return {
    id: tx.id,
    txId: tx.id,
    r: radiusFromSize(size),
    size,
    fee,
    feeRate: rate,
    category,
    color: colorForCategory(category, rate, p90FeeRate),
    label: category,
    tokenIds,
    addresses: addrSet.size ? [...addrSet] : undefined,
    inputBoxIds: inputBoxIds.length ? inputBoxIds : undefined,
    outputCount: tx.outputs?.length ?? 0,
    inputCount: tx.inputs?.length ?? 0,
    value,
    platform,
    firstSeen,
  };
}

/** @deprecated use txToLoomThread */
export function txToBall(tx: RawTx, firstSeen = Date.now(), p90FeeRate = 0): BallProps {
  return txToLoomThread(tx, firstSeen, p90FeeRate);
}

function estimateSize(tx: RawTx): number {
  const base = 100;
  const perIn = 150 * (tx.inputs?.length ?? 1);
  const perOut = 100 * (tx.outputs?.length ?? 1);
  return base + perIn + perOut;
}

export function buildFeeHistogram(balls: BallProps[]): {
  buckets: { feeRate: number; count: number; size: number }[];
  p50: number;
  p90: number;
  recommend: { economy: number; normal: number; turbo: number };
} {
  if (balls.length === 0) {
    return {
      buckets: [],
      p50: 1000,
      p90: 5000,
      recommend: { economy: 500, normal: 1000, turbo: 5000 },
    };
  }
  const rates = balls.map((b) => b.feeRate).sort((a, b) => a - b);
  const p50 = rates[Math.floor(rates.length * 0.5)] ?? 1000;
  const p90 = rates[Math.floor(rates.length * 0.9)] ?? p50 * 2;

  const bucketCount = 12;
  const max = Math.max(rates[rates.length - 1] ?? 1, 1);
  const buckets: { feeRate: number; count: number; size: number }[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const lo = (max / bucketCount) * i;
    const hi = (max / bucketCount) * (i + 1);
    const inB = balls.filter((b) => b.feeRate >= lo && b.feeRate < hi + (i === bucketCount - 1 ? 1 : 0));
    buckets.push({
      feeRate: (lo + hi) / 2,
      count: inB.length,
      size: inB.reduce((s, b) => s + b.size, 0),
    });
  }

  return {
    buckets,
    p50,
    p90,
    recommend: {
      economy: Math.max(100, Math.floor(p50 * 0.5)),
      normal: Math.floor(p50),
      turbo: Math.floor(p90),
    },
  };
}
