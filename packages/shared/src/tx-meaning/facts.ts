/**
 * Chain facts for one tx, order-free: balance per address and asset, the fee and who paid it,
 * the role of every spent / created box, minted and burned tokens, pool reserve moves.
 */
import { MINERS_FEE_ADDRESS, MINERS_FEE_TREE } from "../tx-shape.js";
import { roleOf, type RoleEntry } from "./registry.js";
import type { MeaningBox, MeaningTx } from "./types.js";

/** Asset key: "" is ERG, else the 64-hex token id. */
export type AssetKey = string;
export const ERG: AssetKey = "";

export type Bag = Map<AssetKey, bigint>;

export type FBox = {
  boxId: string | null;
  address: string;
  tree: string;
  value: bigint;
  assets: Bag;
  tokenIds: string[];
  role: RoleEntry | null;
  fee: boolean;
  /** A key-only wallet: P2PK or a k-of-n signature box. Not a contract. */
  wallet: boolean;
  multisig: { k: number; n: number } | null;
  raw: MeaningBox;
};

export function big(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return Number.isFinite(v) ? BigInt(Math.trunc(v)) : 0n;
  const s = String(v ?? "").trim().split(".")[0] ?? "";
  if (!/^-?\d+$/.test(s)) return 0n;
  return BigInt(s);
}

function normTree(tree?: string | null): string {
  return (tree ?? "").trim().toLowerCase().replace(/^0x/, "");
}

function readVlq(hex: string, at: number): { n: number; at: number } | null {
  let n = 0;
  let shift = 0;
  for (let i = 0; i < 5; i++) {
    const b = parseInt(hex.slice(at, at + 2), 16);
    if (!Number.isFinite(b)) return null;
    at += 2;
    n |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { n, at };
    shift += 7;
  }
  return null;
}

/**
 * `atLeast(k, Coll(pk1..pkn))` with segregated constants: a shared wallet (k-of-n keys), not a
 * contract. Constants: Int k, then n group elements; body: 98 7300 83 n 08 7301..730n.
 */
export function multisigOf(tree: string | null | undefined): { k: number; n: number } | null {
  const t = normTree(tree);
  if (t.length < 80) return null;
  const header = parseInt(t.slice(0, 2), 16);
  if (!Number.isFinite(header) || (header & 0x10) === 0) return null;
  let at = 2;
  if (header & 0x08) {
    const size = readVlq(t, at);
    if (!size) return null;
    at = size.at;
  }
  const count = readVlq(t, at);
  if (!count || count.n < 2) return null;
  at = count.at;
  if (t.slice(at, at + 2) !== "04") return null;
  const kz = readVlq(t, at + 2);
  if (!kz) return null;
  at = kz.at;
  const k = (kz.n >>> 1) ^ -(kz.n & 1);
  const n = count.n - 1;
  for (let i = 0; i < n; i++) {
    if (t.slice(at, at + 4) !== "08cd") return null;
    at += 4 + 66;
  }
  let body = "98730083" + n.toString(16).padStart(2, "0") + "08";
  for (let i = 1; i <= n; i++) body += "73" + i.toString(16).padStart(2, "0");
  if (t.slice(at) !== body) return null;
  if (k < 1 || k > n) return null;
  return { k, n };
}

function isP2pk(address: string, tree: string): boolean {
  if (tree.startsWith("0008cd")) return true;
  if (tree.length > 0) return false;
  return address.startsWith("9") && address.length >= 50 && address.length < 70;
}

export function shortAddr(a: string | null | undefined): string {
  if (!a) return "?";
  if (a.length <= 10) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function toBox(b: MeaningBox): FBox {
  const address = (b.address ?? "").trim();
  const tree = normTree(b.ergoTree);
  const assets: Bag = new Map();
  for (const a of b.assets ?? []) {
    const id = String(a.tokenId ?? "").trim().toLowerCase();
    if (id.length !== 64) continue;
    assets.set(id, (assets.get(id) ?? 0n) + big(a.amount));
  }
  const tokenIds = [...assets.keys()];
  const fee = address === MINERS_FEE_ADDRESS || (tree.length > 0 && tree === MINERS_FEE_TREE);
  const p2pk = !fee && isP2pk(address, tree);
  // A wallet never takes a role from a token it happens to hold; a known script stays a contract.
  const role = fee || p2pk ? null : roleOf({ templateHash: b.templateHash, address, tokenIds });
  const multisig = fee || p2pk || role ? null : multisigOf(tree);
  return {
    boxId: b.boxId ? String(b.boxId).toLowerCase() : null,
    address: address || (tree ? `tree:${tree.slice(0, 24)}` : "?"),
    tree,
    value: big(b.value),
    assets,
    tokenIds,
    role,
    fee,
    wallet: p2pk || multisig != null,
    multisig,
    raw: b,
  };
}

export type Facts = {
  tx: MeaningTx;
  ins: FBox[];
  outs: FBox[];
  data: FBox[];
  /** Net per address (outputs minus inputs), fee boxes left out. Zero entries dropped. */
  net: Map<string, Bag>;
  feeNano: bigint;
  /** Wallet input with the largest ERG loss; else the first wallet input. */
  payer: string | null;
  inputIds: Set<string>;
  /** EIP-4: a token whose id equals ANY spent input id was born here. */
  minted: Bag;
  /** Spent minus created, per token (not minted ones). */
  burned: Bag;
  truncated: boolean;
};

function addTo(bag: Bag, key: AssetKey, v: bigint) {
  const next = (bag.get(key) ?? 0n) + v;
  if (next === 0n) bag.delete(key);
  else bag.set(key, next);
}

export function bagOf(box: FBox): Bag {
  const bag: Bag = new Map();
  if (box.value) bag.set(ERG, box.value);
  for (const [id, amt] of box.assets) if (amt) bag.set(id, amt);
  return bag;
}

export function readFacts(tx: MeaningTx): Facts {
  const ins = (tx.inputs ?? []).map(toBox);
  const outs = (tx.outputs ?? []).map(toBox);
  const data = (tx.dataInputs ?? []).map(toBox);
  const net = new Map<string, Bag>();
  const touch = (addr: string) => {
    let bag = net.get(addr);
    if (!bag) {
      bag = new Map();
      net.set(addr, bag);
    }
    return bag;
  };
  for (const b of ins) {
    if (b.fee) continue;
    const bag = touch(b.address);
    addTo(bag, ERG, -b.value);
    for (const [id, amt] of b.assets) addTo(bag, id, -amt);
  }
  for (const b of outs) {
    if (b.fee) continue;
    const bag = touch(b.address);
    addTo(bag, ERG, b.value);
    for (const [id, amt] of b.assets) addTo(bag, id, amt);
  }
  for (const [addr, bag] of net) if (!bag.size) net.delete(addr);

  let feeNano = 0n;
  for (const b of outs) if (b.fee) feeNano += b.value;

  let payer: string | null = null;
  let loss = 0n;
  for (const b of ins) {
    if (!b.wallet) continue;
    const l = -(net.get(b.address)?.get(ERG) ?? 0n);
    if (l > loss || (l === loss && l > 0n && payer != null && b.address < payer)) {
      loss = l;
      payer = b.address;
    }
  }
  if (!payer) payer = ins.filter((b) => b.wallet).map((b) => b.address).sort()[0] ?? null;

  const inputIds = new Set<string>();
  for (const b of ins) if (b.boxId) inputIds.add(b.boxId);
  const minted: Bag = new Map();
  for (const b of outs) for (const [id, amt] of b.assets) if (inputIds.has(id)) addTo(minted, id, amt);

  const tin: Bag = new Map();
  const tout: Bag = new Map();
  for (const b of ins) for (const [id, amt] of b.assets) addTo(tin, id, amt);
  for (const b of outs) for (const [id, amt] of b.assets) addTo(tout, id, amt);
  const burned: Bag = new Map();
  for (const [id, amt] of tin) {
    const left = amt - (tout.get(id) ?? 0n);
    if (left > 0n) burned.set(id, left);
  }

  const truncated =
    (tx.inputCount != null && tx.inputCount > ins.length) ||
    (tx.outputCount != null && tx.outputCount > outs.length);

  return { tx, ins, outs, data, net, feeNano, payer, inputIds, minted, burned, truncated };
}

/** Net of one address, with the network fee taken back out when that address paid it. */
export function netOf(f: Facts, addr: string | null, addBackFee = true): Bag {
  const bag: Bag = new Map(addr ? (f.net.get(addr) ?? new Map()) : new Map());
  if (addr && addBackFee && addr === f.payer && f.feeNano > 0n) addTo(bag, ERG, f.feeNano);
  return bag;
}

export function minus(a: Bag, b: Bag): Bag {
  const out: Bag = new Map(a);
  for (const [k, v] of b) addTo(out, k, -v);
  return out;
}

export function plus(a: Bag, b: Bag): Bag {
  const out: Bag = new Map(a);
  for (const [k, v] of b) addTo(out, k, v);
  return out;
}

export function addInto(bag: Bag, key: AssetKey, v: bigint) {
  addTo(bag, key, v);
}

/** Split a net into what left (positive amounts) and what came in. ERG first, then by size. */
export function sides(bag: Bag): { gave: Array<[AssetKey, bigint]>; got: Array<[AssetKey, bigint]> } {
  const gave: Array<[AssetKey, bigint]> = [];
  const got: Array<[AssetKey, bigint]> = [];
  for (const [k, v] of bag) {
    if (v < 0n) gave.push([k, -v]);
    else if (v > 0n) got.push([k, v]);
  }
  const order = (a: [AssetKey, bigint], b: [AssetKey, bigint]) => {
    if ((a[0] === ERG) !== (b[0] === ERG)) return a[0] === ERG ? -1 : 1;
    return a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : a[0] < b[0] ? -1 : 1;
  };
  gave.sort(order);
  got.sort(order);
  return { gave, got };
}

/** Wallet addresses (not the actor) that ended up with more of something. */
export function walletGainers(f: Facts, except: ReadonlySet<string>): string[] {
  const wallets = new Set<string>();
  for (const b of [...f.ins, ...f.outs]) if (b.wallet) wallets.add(b.address);
  const out: string[] = [];
  for (const [addr, bag] of f.net) {
    if (except.has(addr) || !wallets.has(addr)) continue;
    if ([...bag.values()].some((v) => v > 0n)) out.push(addr);
  }
  return out.sort();
}
