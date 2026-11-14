/**
 * Protocol storage-rent claims, read from one transaction (node JSON). A box was collected only
 * when its spend has an empty proof and context extension 127 (the recreated output index,
 * zigzag). The rent is the input value minus that output. The collector is the P2PK that took the
 * box or kept the rent, not the block miner and not the fee script.
 *
 * The indexer's rent writer stores these rows; the gateway reads the same rule for the live
 * «rent collected in this block» moment. One rule, one place.
 */

export type RentClaim = {
  boxId: string;
  spentTxId: string;
  spentHeight: number;
  outIndex: number;
  valueNano: string;
  rentNano: string;
  collector: string | null;
};

export type RentNodeOut = { value?: number | string; address?: string; ergoTree?: string };
export type RentNodeIn = {
  boxId?: string;
  value?: number | string;
  address?: string;
  spendingProof?: { proofBytes?: string; extension?: Record<string, string> };
};
export type RentNodeTx = { id?: string; inputs?: RentNodeIn[]; outputs?: RentNodeOut[] };

/** Sigma constant: type byte 0x03/0x04, then unsigned VLQ, then zigzag. */
export function decodeRentOutIndex(hex: string | null | undefined): number | null {
  if (!hex) return null;
  const raw = hex.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(raw) || raw.length < 4 || raw.length % 2 !== 0) return null;
  const buf = new Uint8Array(raw.length / 2);
  for (let k = 0; k < buf.length; k++) buf[k] = parseInt(raw.slice(k * 2, k * 2 + 2), 16);
  if (buf[0] !== 0x03 && buf[0] !== 0x04) return null;
  let i = 1;
  let n = 0;
  let shift = 0;
  while (i < buf.length && shift <= 28) {
    const b = buf[i++]!;
    n |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      const mag = n >>> 1;
      return (n & 1) === 0 ? mag : -mag - 1;
    }
    shift += 7;
  }
  return null;
}

function nano(v: number | string | undefined): bigint | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

const MINERS_FEE =
  "2iHkR7CWvD1R4j1yZg5bkeDRQavjAaVPeTDFGGLZduHyfWMuYpmhHocX8GJoaieTx78FntzJbCBVL6rf96ocJoZdmWBL2fci7NqWgAirppPQmZ7fN9V6z13Ay6brPriBKYqLp1bT2Fk4FkFLCfdPpe";

function isMinerSide(out: RentNodeOut): boolean {
  const addr = out.address ?? "";
  const tree = out.ergoTree ?? "";
  if (addr.startsWith("88") || addr === MINERS_FEE) return true;
  if (tree.startsWith("0008d3")) return true;
  return false;
}

/** P2PK that received the rent. Skips the miner reward lock and the fee script. */
export function claimerAddress(tx: RentNodeTx): string | null {
  const outs = tx.outputs ?? [];
  const selfRenew = new Set<number>();
  for (const inp of tx.inputs ?? []) {
    const idx = decodeRentOutIndex(inp.spendingProof?.extension?.["127"]);
    if (idx == null || idx < 0) continue;
    const outAddr = outs[idx]?.address;
    if (outAddr && inp.address && outAddr === inp.address) selfRenew.add(idx);
  }
  let best: { addr: string; val: bigint } | null = null;
  for (const [i, out] of outs.entries()) {
    if (selfRenew.has(i) || isMinerSide(out)) continue;
    const addr = out.address ?? "";
    if (!addr.startsWith("9")) continue;
    const val = nano(out.value) ?? 0n;
    if (!best || val > best.val) best = { addr, val };
  }
  return best?.addr ?? null;
}

/**
 * Floor-divide `gap` across `values`. The shares sum to `gap`.
 * Remainder nanos go to the largest fractional parts.
 */
export function splitRentGap(values: bigint[], gap: bigint): bigint[] {
  const rents = values.map(() => 0n);
  if (gap <= 0n) return rents;
  const sum = values.reduce((acc, v) => acc + (v > 0n ? v : 0n), 0n);
  if (sum <= 0n) return rents;
  let assigned = 0n;
  const rank = values.map((v, i) => {
    const value = v > 0n ? v : 0n;
    const rent = (value * gap) / sum;
    rents[i] = rent;
    assigned += rent;
    return { i, rem: (value * gap) % sum };
  });
  rank.sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  let left = gap - assigned;
  for (const row of rank) {
    if (left <= 0n) break;
    rents[row.i] = (rents[row.i] ?? 0n) + 1n;
    left -= 1n;
  }
  return rents;
}

export function claimsFromTx(tx: RentNodeTx, spentHeight: number): RentClaim[] {
  const txId = tx.id?.trim();
  if (!txId) return [];
  const collector = claimerAddress(tx);
  const outs = tx.outputs ?? [];
  const groups = new Map<number, Array<{ boxId: string; value: bigint }>>();
  for (const inp of tx.inputs ?? []) {
    const boxId = inp.boxId?.trim();
    if (!boxId) continue;
    const proof = inp.spendingProof;
    const bytes = proof?.proofBytes ?? "";
    if (bytes !== "") continue;
    const outIndex = decodeRentOutIndex(proof?.extension?.["127"]);
    if (outIndex == null) continue;
    const inputNano = nano(inp.value);
    if (inputNano == null || inputNano <= 0n) continue;
    const list = groups.get(outIndex) ?? [];
    list.push({ boxId, value: inputNano });
    groups.set(outIndex, list);
  }

  const claims: RentClaim[] = [];
  for (const [outIndex, group] of groups) {
    let rents: bigint[];
    if (outIndex < 0) {
      rents = group.map((row) => row.value);
    } else {
      const outNano = nano(outs[outIndex]?.value);
      if (outNano == null) continue;
      const sum = group.reduce((acc, row) => acc + row.value, 0n);
      rents = splitRentGap(
        group.map((row) => row.value),
        sum - outNano
      );
    }
    group.forEach((row, i) => {
      const rent = rents[i] ?? 0n;
      if (rent <= 0n) return;
      claims.push({
        boxId: row.boxId,
        spentTxId: txId,
        spentHeight,
        outIndex,
        valueNano: row.value.toString(),
        rentNano: rent.toString(),
        collector,
      });
    });
  }
  return claims;
}

/** Inputs of one node tx that are protocol rent spends: empty proof + extension 127. */
export function isRentSpend(inp: RentNodeIn | null | undefined): boolean {
  const proof = inp?.spendingProof;
  if (!proof || (proof.proofBytes ?? "") !== "") return false;
  return decodeRentOutIndex(proof.extension?.["127"]) != null;
}

/**
 * Rent spends in a full block from `/blocks/{id}` (inputs carry the proof, not the value): how
 * many boxes, and the ids of the txs that hold them. Free: the seal already has this JSON.
 */
export function rentSpendsInBlock(txs: readonly RentNodeTx[] | null | undefined): {
  boxes: number;
  txIds: string[];
} {
  let boxes = 0;
  const txIds: string[] = [];
  for (const tx of txs ?? []) {
    let n = 0;
    for (const inp of tx?.inputs ?? []) if (isRentSpend(inp)) n += 1;
    if (!n) continue;
    boxes += n;
    if (typeof tx.id === "string" && tx.id) txIds.push(tx.id);
  }
  return { boxes, txIds };
}

/**
 * `rent.collected`: the rent miners took in one block, sent once per block that has rent spends,
 * a moment after `block.sealed`. `rentNano` and `collector` come from the node's tx index (input
 * values are not in the block JSON); null when it did not answer in time. `boxes` is always the
 * block's count.
 */
export type RentCollectedEvent = {
  blockId: string;
  height: number;
  boxes: number;
  rentNano: string | null;
  /** The P2PK that kept most of the rent in this block (claimerAddress), when known. */
  collector: string | null;
};

/**
 * Sums the claims of one block's rent txs. Collector: the one that kept the most rent.
 * `claims` null: the values are unknown, so the count of rent spends stands alone. Known claims
 * count only boxes that paid (a spend under the rule can recreate a box without taking anything).
 */
export function summarizeRentClaims(
  seal: { blockId: string; height: number; boxes: number },
  claims: readonly RentClaim[] | null
): RentCollectedEvent {
  if (!claims || !claims.length) {
    return { blockId: seal.blockId, height: seal.height, boxes: seal.boxes, rentNano: null, collector: null };
  }
  let total = 0n;
  const per = new Map<string, bigint>();
  for (const c of claims) {
    const r = BigInt(c.rentNano);
    total += r;
    if (c.collector) per.set(c.collector, (per.get(c.collector) ?? 0n) + r);
  }
  let collector: string | null = null;
  let best = -1n;
  for (const [addr, r] of per) {
    if (r > best) {
      best = r;
      collector = addr;
    }
  }
  return {
    blockId: seal.blockId,
    height: seal.height,
    boxes: claims.length,
    rentNano: total.toString(),
    collector,
  };
}

/** Strict parse of a `rent.collected` payload from the stream. */
export function parseRentCollected(v: unknown): RentCollectedEvent | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const height = Number(o.height);
  const boxes = Number(o.boxes);
  if (typeof o.blockId !== "string" || !o.blockId) return null;
  if (!Number.isInteger(height) || height < 1 || !Number.isInteger(boxes) || boxes < 1) return null;
  const rentNano = typeof o.rentNano === "string" && /^\d{1,24}$/.test(o.rentNano) ? o.rentNano : null;
  const collector = typeof o.collector === "string" && /^[1-9A-HJ-NP-Za-km-z]{30,120}$/.test(o.collector) ? o.collector : null;
  return { blockId: o.blockId, height, boxes, rentNano, collector };
}
