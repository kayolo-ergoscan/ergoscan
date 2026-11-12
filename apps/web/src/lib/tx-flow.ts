import {
  classifyAddrFlow,
  eip4MintOfOutputs,
  netValueParties,
  type AddrFlowKind,
} from "@ergoscan/shared";
import { toBigIntAmt } from "./format";
import { isFeeAddress } from "./address-book";

export type { AddrFlowKind };

export type TxIo = {
  boxId: string | null;
  value: number | string | null;
  address?: string | null;
  assets?: { tokenId: string; amount: number | string }[];
  additionalRegisters?: Record<string, unknown> | null;
  creationHeight?: number | null;
  ergoTree?: string | null;
  index?: number | null;
};

export type AssetAmt = { tokenId: string; amount: bigint };

export type PartyBox = {
  boxId: string | null;
  value: bigint;
  assets: AssetAmt[];
  registers: Record<string, string>;
  creationHeight: number | null;
};

export type Party = {
  key: string;
  address: string | null;
  isFee: boolean;
  erg: bigint;
  tokens: Map<string, bigint>;
  boxes: PartyBox[];
};

export type SettleKind = "erg" | "pass" | "mint" | "burn" | "mismatch";

export type SettleLine = {
  tokenId: string | null;
  inAmt: bigint;
  outAmt: bigint;
  kind: SettleKind;
};

function normalizeRegs(r: unknown): Record<string, string> {
  if (!r || typeof r !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
    if (v == null || v === "") continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

function boxOf(io: TxIo): PartyBox {
  return {
    boxId: io.boxId,
    value: toBigIntAmt(io.value),
    assets: (io.assets ?? [])
      .filter((a) => a.tokenId)
      .map((a) => ({ tokenId: a.tokenId, amount: toBigIntAmt(a.amount) })),
    registers: normalizeRegs(io.additionalRegisters),
    creationHeight: io.creationHeight ?? null,
  };
}

/**
 * Miner fee: output to the protocol fee contract, or ERG-only value == tx.fee.
 * Fallback: smallest ERG-only output within 0.5×–2× of the reported fee.
 */
export function markFeeOutputIndexes(outputs: TxIo[], feeNano: bigint): Set<number> {
  const idxs = new Set<number>();
  outputs.forEach((o, i) => {
    if (isFeeAddress(o.address)) idxs.add(i);
  });
  if (feeNano > 0n) {
    outputs.forEach((o, i) => {
      if ((o.assets?.length ?? 0) > 0) return;
      if (toBigIntAmt(o.value) === feeNano) idxs.add(i);
    });
  }
  if (idxs.size) return idxs;
  if (feeNano <= 0n) return idxs;

  let best = -1;
  let bestV = 0n;
  const lo = feeNano / 2n;
  const hi = feeNano * 2n;
  outputs.forEach((o, i) => {
    if ((o.assets?.length ?? 0) > 0) return;
    const v = toBigIntAmt(o.value);
    if (v <= 0n || v < lo || v > hi) return;
    if (best < 0 || v < bestV) {
      best = i;
      bestV = v;
    }
  });
  if (best >= 0) idxs.add(best);
  return idxs;
}

export function groupParties(
  items: TxIo[],
  feeIdx: Set<number>,
  side: "in" | "out"
): Party[] {
  const map = new Map<string, Party>();
  items.forEach((io, i) => {
    const isFee = side === "out" && (feeIdx.has(i) || isFeeAddress(io.address));
    const key = isFee
      ? `fee:${io.address ?? i}`
      : io.address
        ? `addr:${io.address}`
        : `__box__${io.boxId ?? i}`;
    let p = map.get(key);
    if (!p) {
      p = {
        key,
        address: io.address ?? null,
        isFee,
        erg: 0n,
        tokens: new Map(),
        boxes: [],
      };
      map.set(key, p);
    }
    const box = boxOf(io);
    p.boxes.push(box);
    p.erg += box.value;
    for (const a of box.assets) {
      p.tokens.set(a.tokenId, (p.tokens.get(a.tokenId) ?? 0n) + a.amount);
    }
  });
  return [...map.values()].sort((a, b) => {
    if (a.isFee !== b.isFee) return a.isFee ? 1 : -1;
    if (a.erg === b.erg) return 0;
    return a.erg > b.erg ? -1 : 1;
  });
}

export function settlement(inputs: TxIo[], outputs: TxIo[]): SettleLine[] {
  const inErg = inputs.reduce((s, x) => s + toBigIntAmt(x.value), 0n);
  const outErg = outputs.reduce((s, x) => s + toBigIntAmt(x.value), 0n);
  const tokenIn = new Map<string, bigint>();
  const tokenOut = new Map<string, bigint>();
  for (const io of inputs) {
    for (const a of io.assets ?? []) {
      if (!a.tokenId) continue;
      tokenIn.set(a.tokenId, (tokenIn.get(a.tokenId) ?? 0n) + toBigIntAmt(a.amount));
    }
  }
  for (const io of outputs) {
    for (const a of io.assets ?? []) {
      if (!a.tokenId) continue;
      tokenOut.set(a.tokenId, (tokenOut.get(a.tokenId) ?? 0n) + toBigIntAmt(a.amount));
    }
  }
  const ids = [...new Set([...tokenIn.keys(), ...tokenOut.keys()])];
  const lines: SettleLine[] = [
    { tokenId: null, inAmt: inErg, outAmt: outErg, kind: "erg" },
  ];
  for (const id of ids) {
    const i = tokenIn.get(id) ?? 0n;
    const o = tokenOut.get(id) ?? 0n;
    let kind: SettleLine["kind"] = "pass";
    if (i === 0n && o > 0n) kind = "mint";
    else if (o === 0n && i > 0n) kind = "burn";
    else if (i !== o) kind = "mismatch";
    lines.push({ tokenId: id, inAmt: i, outAmt: o, kind });
  }
  return lines;
}

export function uniqueTokenIds(inputs: TxIo[], outputs: TxIo[]): string[] {
  const s = new Set<string>();
  for (const io of [...inputs, ...outputs]) {
    for (const a of io.assets ?? []) {
      const id = a.tokenId?.toLowerCase();
      if (id && !/^0+$/.test(id)) s.add(id);
    }
  }
  return [...s];
}

export function tokenEntries(tokens: Map<string, bigint>): [string, bigint][] {
  return [...tokens.entries()].sort((a, b) => (a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1));
}

export type AddrFlow = {
  kind: AddrFlowKind;
  /** Net ERG for this address: outputs − inputs. */
  erg: bigint;
  /** Net token amounts for this address (out − in). Zero nets omitted. */
  tokens: Map<string, bigint>;
  from: string[];
  to: string[];
};

/** Classify a tx from one address's point of view. No fetch — caller supplies I/O. */
export function addressFlow(
  address: string,
  inputs: TxIo[],
  outputs: TxIo[],
  feeNano: bigint = 0n
): AddrFlow | null {
  const hasIn = inputs.some((i) => i.address === address);
  const hasOut = outputs.some((o) => o.address === address);
  if (!hasIn && !hasOut) return null;

  let inErg = 0n;
  let outErg = 0n;
  const tokens = new Map<string, bigint>();
  const addTok = (id: string | undefined, d: bigint) => {
    if (!id || /^0+$/.test(id)) return;
    const k = id.toLowerCase();
    const next = (tokens.get(k) ?? 0n) + d;
    if (next === 0n) tokens.delete(k);
    else tokens.set(k, next);
  };

  for (const i of inputs) {
    if (i.address !== address) continue;
    inErg += toBigIntAmt(i.value);
    for (const a of i.assets ?? []) addTok(a.tokenId, -toBigIntAmt(a.amount));
  }
  for (const o of outputs) {
    if (o.address !== address) continue;
    outErg += toBigIntAmt(o.value);
    for (const a of o.assets ?? []) addTok(a.tokenId, toBigIntAmt(a.amount));
  }

  const mint = eip4MintOfOutputs(
    outputs.filter((o) => o.address === address).map((o) => ({
      boxId: o.boxId,
      assets: o.assets,
    })),
    inputs.map((i) => i.boxId)
  );
  const netErg = outErg - inErg;
  const kind = classifyAddrFlow({
    netErg,
    fee: feeNano,
    tokens: [...tokens.entries()].map(([id, amount]) => ({
      amount,
      mint: mint.get(id) ?? 0n,
    })),
  });
  const parties = netValueParties(inputs, outputs, feeNano);
  return { kind, erg: netErg, tokens, from: parties.from, to: parties.to };
}
