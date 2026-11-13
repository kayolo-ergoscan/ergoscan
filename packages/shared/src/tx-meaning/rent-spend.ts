/**
 * Storage rent read off the tx itself. A mempool tx has no mark from the rent writer yet (it marks
 * a block after it lands), so its boxes are read the writer's way: an input spent with an empty
 * proof and context extension 127 (the index of the recreated output, a zigzag Int) was taken for
 * its rent. The collector is the P2PK that kept the rent; none means the box was renewed.
 * Same test, sums and collector as the writer (apps/indexer/src/rentClaim.ts), so a mark here
 * matches the one the block gets.
 */
import { MINERS_FEE_ADDRESS } from "../tx-shape.js";

export type RentSpendInput = {
  value?: number | string | null;
  address?: string | null;
  spendingProof?: { proofBytes?: string | null; extension?: Record<string, string> | null } | null;
};
export type RentSpendOutput = { value?: number | string | null; address?: string | null; ergoTree?: string | null };
/** A node tx (mempool dump): inputs carry `spendingProof`. */
export type RentSpendTx = {
  inputs?: ReadonlyArray<RentSpendInput> | null;
  outputs?: ReadonlyArray<RentSpendOutput> | null;
};

/** Sigma Short / Int constant (type byte 0x03 / 0x04), then VLQ, then zigzag. */
export function rentOutIndex(hex: string | null | undefined): number | null {
  if (!hex) return null;
  const raw = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(raw) || raw.length < 4 || raw.length % 2 !== 0) return null;
  const type = raw.slice(0, 2);
  if (type !== "03" && type !== "04") return null;
  let n = 0;
  let shift = 0;
  for (let at = 2; at < raw.length && shift <= 28; at += 2) {
    const b = parseInt(raw.slice(at, at + 2), 16);
    n |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      const mag = n >>> 1;
      return (n & 1) === 0 ? mag : -mag - 1;
    }
    shift += 7;
  }
  return null;
}

function nano(v: number | string | null | undefined): bigint | null {
  if (v == null) return null;
  const s = String(v).trim();
  return /^\d+$/.test(s) ? BigInt(s) : null;
}

function minerSide(out: RentSpendOutput): boolean {
  const addr = out.address ?? "";
  return addr.startsWith("88") || addr === MINERS_FEE_ADDRESS || (out.ergoTree ?? "").startsWith("0008d3");
}

/** The P2PK that kept the rent: the largest output that is not a box renewed to its owner nor the miner's. */
function collectorOf(tx: RentSpendTx): string | null {
  const outs = tx.outputs ?? [];
  const renewed = new Set<number>();
  for (const inp of tx.inputs ?? []) {
    const idx = rentOutIndex(inp.spendingProof?.extension?.["127"]);
    if (idx == null || idx < 0) continue;
    const to = outs[idx]?.address;
    if (to && inp.address && to === inp.address) renewed.add(idx);
  }
  let best: { addr: string; val: bigint } | null = null;
  outs.forEach((out, i) => {
    if (renewed.has(i) || minerSide(out)) return;
    const addr = out.address ?? "";
    if (!addr.startsWith("9")) return;
    const val = nano(out.value) ?? 0n;
    if (!best || val > best.val) best = { addr, val };
  });
  return (best as { addr: string } | null)?.addr ?? null;
}

/** "rent" (someone kept the rent), "rent-renew" (boxes renewed), or null: no box was spent for rent. */
export function rentMarkOf(tx: RentSpendTx): "rent" | "rent-renew" | null {
  const outs = tx.outputs ?? [];
  const groups = new Map<number, bigint>();
  for (const inp of tx.inputs ?? []) {
    const proof = inp.spendingProof;
    if (!proof || (proof.proofBytes ?? "") !== "") continue;
    const idx = rentOutIndex(proof.extension?.["127"]);
    if (idx == null) continue;
    const v = nano(inp.value);
    if (v == null || v <= 0n) continue;
    groups.set(idx, (groups.get(idx) ?? 0n) + v);
  }
  let rent = false;
  for (const [idx, sum] of groups) {
    if (idx < 0) rent = true;
    else {
      const out = nano(outs[idx]?.value);
      if (out != null && sum - out > 0n) rent = true;
    }
  }
  if (!rent) return null;
  return collectorOf(tx) ? "rent" : "rent-renew";
}
