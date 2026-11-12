/**
 * Address-tape kind from this address's net, not "appeared on both sides".
 * Intra = economically flat. Send+change is sent.
 * Not DEX: Spectrum is order tx then fill tx — kind is per-tx, not a swap label.
 * GET computes this. Not a column. Distinct from transactions.shape.
 */
import { MINERS_FEE_ADDRESS } from "./tx-shape.js";

export const ADDR_FLOW_RULES_VERSION = 2;

export type AddrFlowKind = "sent" | "received" | "intra";

const ADDR_FLOW_KIND_SET: ReadonlySet<string> = new Set([
  "sent",
  "received",
  "intra",
]);

export function asAddrFlowKind(s: unknown): AddrFlowKind | null {
  if (typeof s !== "string" || !ADDR_FLOW_KIND_SET.has(s)) return null;
  return s as AddrFlowKind;
}

export function parseNanoErg(v: unknown): bigint {
  if (v == null) return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return 0n;
    return BigInt(Math.trunc(v));
  }
  if (typeof v !== "string") return 0n;
  const s = String(v).trim();
  if (!s) return 0n;
  try {
    if (/[eE]/.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n)) return 0n;
      return BigInt(Math.trunc(n));
    }
    const intPart = s.split(".")[0] ?? "0";
    if (!/^-?\d+$/.test(intPart)) return 0n;
    return BigInt(intPart);
  } catch {
    return 0n;
  }
}

export type AddrFlowTokenNet = {
  amount: bigint;
  /** EIP-4 mint in this tx (tokenId = issuing box id). Subtracted only when net ERG is −fee. */
  mint?: bigint;
};

export type ClassifyAddrFlowInput = {
  /** outputs − inputs for this address, nanoERG */
  netErg: bigint;
  /** tx fee, nanoERG. 0 = unknown (consolidation then looks like sent). */
  fee: bigint;
  tokens?: Iterable<AddrFlowTokenNet>;
};

/**
 * Intra = net ERG is 0 or exactly −fee, and no directional token move.
 * Mint to self while paying fee is not "received".
 * When ERG moves, kind follows ERG; tokens stay on the peek line.
 * Do not label swap: Spectrum CFMM is two txs (order then fill).
 */
export function classifyAddrFlow(input: ClassifyAddrFlowInput): AddrFlowKind {
  const fee = input.fee < 0n ? 0n : input.fee;
  const paysFee = fee > 0n && input.netErg === -fee;
  const ergNeutral = input.netErg === 0n || paysFee;

  if (!ergNeutral) return input.netErg > 0n ? "received" : "sent";

  let tokPos = false;
  let tokNeg = false;
  for (const token of input.tokens ?? []) {
    let qty = token.amount;
    if (paysFee) qty -= token.mint ?? 0n;
    if (qty > 0n) tokPos = true;
    else if (qty < 0n) tokNeg = true;
  }
  if (tokNeg) return "sent";
  if (tokPos) return "received";
  return "intra";
}

export type Eip4MintBox = {
  boxId?: string | null;
  assets?: Array<{
    tokenId?: string | null;
    amount?: unknown;
  }>;
};

export type ValuePartyBox = {
  address?: string | null;
  value?: unknown;
  assets?: Array<{ tokenId?: string | null; amount?: unknown }>;
};

const PARTY_CAP = 8;

/**
 * From/To by who actually lost or gained. A box spent and recreated at the same
 * contract with the same assets is not a payment, so that contract is in neither list.
 * Change that returns to the payer (the only loss is the fee) keeps the payer on both sides.
 * The miners-fee contract is omitted; the fee is the amount column.
 */
export function netValueParties(
  inputs: ValuePartyBox[],
  outputs: ValuePartyBox[],
  feeNano: bigint
): { from: string[]; to: string[] } {
  type Acc = { erg: bigint; tok: Map<string, bigint>; back: boolean };
  const acc = new Map<string, Acc>();
  const order: string[] = [];
  const touch = (address: string): Acc => {
    const row = acc.get(address);
    if (row) return row;
    const fresh: Acc = { erg: 0n, tok: new Map(), back: false };
    acc.set(address, fresh);
    order.push(address);
    return fresh;
  };
  const leg = (boxes: ValuePartyBox[], sign: 1n | -1n) => {
    for (const box of boxes) {
      const address = box.address?.trim() ?? "";
      if (!address || address === MINERS_FEE_ADDRESS) continue;
      const row = touch(address);
      row.erg += sign * parseNanoErg(box.value);
      if (sign === 1n) row.back = true;
      for (const asset of box.assets ?? []) {
        const id = asset.tokenId?.trim().toLowerCase() ?? "";
        if (!id || /^0+$/.test(id)) continue;
        const qty = parseNanoErg(asset.amount);
        if (qty === 0n) continue;
        row.tok.set(id, (row.tok.get(id) ?? 0n) + sign * qty);
      }
    }
  };
  leg(inputs, -1n);
  leg(outputs, 1n);
  const fee = feeNano < 0n ? 0n : feeNano;
  const from: string[] = [];
  const to: string[] = [];
  for (const address of order) {
    const row = acc.get(address)!;
    let lost = row.erg < 0n;
    let gained = row.erg > 0n;
    let tokenMove = false;
    for (const qty of row.tok.values()) {
      if (qty < 0n) lost = true;
      else if (qty > 0n) gained = true;
      if (qty !== 0n) tokenMove = true;
    }
    const change = row.back && !tokenMove && fee > 0n && row.erg === -fee;
    if (lost && from.length < PARTY_CAP) from.push(address);
    if ((gained || change) && to.length < PARTY_CAP) to.push(address);
  }
  return { from, to };
}

/**
 * Ergo EIP-4: a new token's id is the box id of the tx's FIRST INPUT. A box is spent only once,
 * so a token whose id equals any input box id was minted by this tx, and the inputs need no
 * order (Postgres keeps none). Minted amount = what the given outputs hold.
 */
export function eip4MintOfOutputs(
  outputs: Eip4MintBox[],
  inputBoxIds: Iterable<string | null | undefined>
): Map<string, bigint> {
  const mint = new Map<string, bigint>();
  const spent = new Set<string>();
  for (const id of inputBoxIds) {
    const key = id?.trim().toLowerCase();
    if (key) spent.add(key);
  }
  if (!spent.size) return mint;
  for (const box of outputs) {
    for (const asset of box.assets ?? []) {
      const tokenId = asset.tokenId?.toLowerCase();
      if (!tokenId || !spent.has(tokenId)) continue;
      const amt = parseNanoErg(asset.amount);
      if (amt <= 0n) continue;
      mint.set(tokenId, (mint.get(tokenId) ?? 0n) + amt);
    }
  }
  return mint;
}
