/**
 * ErgoDex liquidity tokens, recognised by the contract they sit in (never by name):
 *  - cl-key: emission 2, decimals 0, minted in the tx that created a V3 position shell box holding
 *    one unit (the other unit goes to the owner).
 *  - cp-pool-nft: emission 1 at the first slot of a CP pool box.
 *  - cp-lp: emission i64::MAX at the second slot of a CP pool box, minted in that pool's create tx.
 * The set lives in memory (indexDb.refreshErgodexLp fills it); this module is pure.
 */
import {
  ERGODEX_CP_POOL_TEMPLATES,
  ERGODEX_LP_ART_SOURCE,
  ERGODEX_LP_ART_URL,
  ERGODEX_V3_SHELL_TEMPLATES,
  type ErgodexLpKind,
} from "@ergoscan/shared";

export type { ErgodexLpKind };

export const I64_MAX = "9223372036854775807";

/** One asset of one template box (refresh SQL row). */
export type LpBoxAssetRow = {
  box_id: string;
  template: string;
  height: number | string | null;
  token_id: string;
  asset_index: number | string | null;
  /** The token's issuing box was spent by the tx that created this box. */
  minted_here: boolean;
  emission: string | null;
  decimals: number | string | null;
};

export type LpEntry = {
  kind: ErgodexLpKind;
  /** Newest template box height that holds the token. */
  height: number;
  /** cl-key: the position's pair from that box. x null = ERG. Unknown order → null. */
  pair?: { x: string | null; y: string } | null;
};

const V3 = new Set(ERGODEX_V3_SHELL_TEMPLATES.map((h) => h.toLowerCase()));
const CP = new Set(ERGODEX_CP_POOL_TEMPLATES.map((h) => h.toLowerCase()));

function intOrNull(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function emissionIs(v: string | null, want: string): boolean {
  if (v == null) return false;
  return String(v).trim().replace(/\.0+$/, "") === want;
}

function kindOf(r: LpBoxAssetRow): ErgodexLpKind | null {
  const tpl = String(r.template || "").toLowerCase();
  const dec = intOrNull(r.decimals) ?? 0;
  if (dec !== 0) return null;
  const idx = intOrNull(r.asset_index);
  if (V3.has(tpl)) {
    if (!emissionIs(r.emission, "2") || !r.minted_here) return null;
    return idx == null || idx === 0 ? "cl-key" : null;
  }
  if (CP.has(tpl)) {
    if (emissionIs(r.emission, "1") && (idx == null || idx === 0)) return "cp-pool-nft";
    if (emissionIs(r.emission, I64_MAX) && r.minted_here && (idx == null || idx === 1)) return "cp-lp";
  }
  return null;
}

/** Pair of a position box: the tokens beside the key, by slot. x null = ERG/token. */
function pairOf(rows: LpBoxAssetRow[], keyId: string): LpEntry["pair"] {
  const rest = rows.filter((r) => r.token_id !== keyId);
  if (rest.length === 1) return { x: null, y: rest[0]!.token_id };
  if (rest.length === 2) {
    const a = intOrNull(rest[0]!.asset_index);
    const b = intOrNull(rest[1]!.asset_index);
    if (a == null || b == null || a === b) return null;
    const [x, y] = a < b ? [rest[0]!, rest[1]!] : [rest[1]!, rest[0]!];
    return { x: x.token_id, y: y.token_id };
  }
  return null;
}

/**
 * Template-box assets → token id → class. `prev` (an earlier, smaller scan) is kept; a newer box
 * moves `height` on and, for a V3 key, gives the pair when its slots are known.
 */
export function classifyLpRows(
  rows: LpBoxAssetRow[],
  prev?: ReadonlyMap<string, LpEntry>
): Map<string, LpEntry> {
  const out = new Map<string, LpEntry>();
  for (const [id, e] of prev ?? []) out.set(id, { ...e });
  const byBox = new Map<string, LpBoxAssetRow[]>();
  for (const r of rows) {
    const list = byBox.get(r.box_id);
    if (list) list.push(r);
    else byBox.set(r.box_id, [r]);
  }
  // 1. Kind: from the box the token was minted beside (cp-pool-nft: any pool box, first slot).
  for (const r of rows) {
    const kind = kindOf(r);
    if (!kind) continue;
    const id = r.token_id.toLowerCase();
    const had = out.get(id);
    if (had && had.kind !== kind) continue;
    if (!had) out.set(id, { kind, height: intOrNull(r.height) ?? 0, ...(kind === "cl-key" ? { pair: null } : {}) });
  }
  // 2. Every later box of a known token: newest height; a key's pair from its newest box that tells it.
  for (const r of rows) {
    const id = r.token_id.toLowerCase();
    const e = out.get(id);
    if (!e) continue;
    const height = intOrNull(r.height) ?? 0;
    if (e.kind === "cl-key") {
      const pair = pairOf(byBox.get(r.box_id) ?? [], r.token_id);
      if (pair && (height >= e.height || !e.pair)) e.pair = pair;
    }
    if (height > e.height) e.height = height;
  }
  return out;
}

let lpMap: ReadonlyMap<string, LpEntry> = new Map();
let clKeys: string[] = [];

export function setErgodexLpMap(next: ReadonlyMap<string, LpEntry>): void {
  lpMap = next;
  clKeys = [...next.entries()]
    .filter(([, e]) => e.kind === "cl-key")
    .sort((a, b) => b[1].height - a[1].height || (a[0] < b[0] ? -1 : 1))
    .map(([id]) => id);
}

export function ergodexLpMap(): ReadonlyMap<string, LpEntry> {
  return lpMap;
}

export function ergodexLpEntry(tokenId: string | null | undefined): LpEntry | null {
  if (!tokenId) return null;
  return lpMap.get(tokenId.toLowerCase()) ?? null;
}

/** V3 position keys, newest position box first. */
export function ergodexClKeyIds(): string[] {
  return clKeys;
}

/** The token's own artwork, else the ErgoDex logo for an ErgoDex liquidity token, else null. */
export function withLpArt(tokenId: string, url: string | null | undefined): string | null {
  const own = typeof url === "string" ? url.trim() : "";
  if (own) return url as string;
  return ergodexLpEntry(tokenId) ? ERGODEX_LP_ART_URL : null;
}

/** `artworkSource` for a token whose shown picture is `shown`. */
export function lpArtSource(tokenId: string, shown: string | null | undefined): string | null {
  return shown === ERGODEX_LP_ART_URL && ergodexLpEntry(tokenId) ? ERGODEX_LP_ART_SOURCE : null;
}

// ---- position box ----

function hexBytes(hex: string): Uint8Array | null {
  const h = hex.trim().toLowerCase();
  if (!h || h.length % 2 || !/^[0-9a-f]+$/.test(h)) return null;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function readVlq(b: Uint8Array, at: number): [bigint, number] | null {
  let r = 0n;
  let shift = 0n;
  let i = at;
  for (;;) {
    if (i >= b.length || shift > 70n) return null;
    const x = b[i++]!;
    r |= BigInt(x & 0x7f) << shift;
    if (!(x & 0x80)) return [r, i];
    shift += 7n;
  }
}

/** Serialized Coll[Long] register (type 0x11) → values. */
export function parseCollLong(hex: string | null | undefined): bigint[] | null {
  const b = hexBytes(String(hex ?? ""));
  if (!b || b[0] !== 0x11) return null;
  const n = readVlq(b, 1);
  if (!n || n[0] > 64n) return null;
  let i = n[1];
  const out: bigint[] = [];
  for (let k = 0n; k < n[0]; k++) {
    const v = readVlq(b, i);
    if (!v) return null;
    i = v[1];
    out.push((v[0] >> 1n) ^ -(v[0] & 1n));
  }
  return i === b.length ? out : null;
}

/** First segregated constant of a tree when it is a 32-byte Coll[Byte]: the shell's validator hash. */
export function shellValidatorHash(ergoTree: string | null | undefined): string | null {
  const b = hexBytes(String(ergoTree ?? ""));
  if (!b || !(b[0]! & 0x10)) return null;
  let i = 1;
  if (b[0]! & 0x08) {
    const size = readVlq(b, i);
    if (!size) return null;
    i = size[1];
  }
  const n = readVlq(b, i);
  if (!n || n[0] < 1n) return null;
  i = n[1];
  if (b[i] !== 0x0e || b[i + 1] !== 0x20 || i + 34 > b.length) return null;
  return [...b.slice(i + 2, i + 34)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Unit of the fee in R4[2], by the validator the shell pins. Only generations we can name from the
 * contract source: f5e47f92… is the pre-ceiling validator (fee in basis points, the DEX SDK lists
 * it as retired bps); 70286f99… is compiled from the current cl-validator.es (parts per million).
 * The earliest shells (3711297e…) are left out: their unit is not on record, so no fee is shown.
 */
const FEE_UNIT_BY_VALIDATOR: Record<string, "bps" | "ppm"> = {
  f5e47f921b32094c0b49f2ca09717b56cbbde827d9c68a2f8f1d2455da3f9c7b: "bps",
  "70286f997a21187839b4902d464335eafb14c4c397f846ab0c12193b142fe67d": "ppm",
};

export function clFeeUnit(ergoTree: string | null | undefined): "bps" | "ppm" | null {
  const h = shellValidatorHash(ergoTree);
  return h ? FEE_UNIT_BY_VALIDATOR[h] ?? null : null;
}

/** nanoERG an ERG/token position keeps outside its curve (cl-validator.es FLOOR). */
const CL_FLOOR_NANO = 1_000_000n;

export type ClPositionBox = {
  boxId: string;
  valueNano: string | bigint;
  /** In box order when `index` is known. */
  assets: { tokenId: string; amount: string | bigint; index: number | null }[];
  r4: string | null;
  r5: string | null;
  ergoTree: string | null;
};

export type ClCurve = {
  /** Token ids; x null = ERG. */
  x: string | null;
  y: string;
  /** Price of 1 raw X in raw Y at the ends of the range. */
  lowRaw: number;
  highRaw: number;
  fee: { raw: number; unit: "bps" | "ppm"; percent: number } | null;
};

function big(v: string | bigint): bigint | null {
  try {
    return typeof v === "bigint" ? v : BigInt(String(v).split(".")[0] || "0");
  } catch {
    return null;
  }
}

/**
 * Curve of a position box: R4 = (vx, vy, fee), R5 = (feeX, feeY). Reserves net of accrued fees
 * plus the virtual offsets keep (x+vx)(y+vy) = k, so the price runs from vy²/k (y spent) to k/vx²
 * (x spent).
 */
export function clCurveFromBox(box: ClPositionBox, keyId: string): ClCurve | null {
  const r4 = parseCollLong(box.r4);
  if (!r4 || r4.length < 3) return null;
  const [vx, vy, feeRaw] = r4 as [bigint, bigint, bigint];
  if (vx <= 0n || vy <= 0n) return null;
  const r5 = parseCollLong(box.r5);
  const feeX = r5 && r5.length >= 2 ? r5[0]! : 0n;
  const feeY = r5 && r5.length >= 2 ? r5[1]! : 0n;
  const key = keyId.toLowerCase();
  const rest = box.assets.filter((a) => a.tokenId.toLowerCase() !== key);
  let xId: string | null;
  let yId: string;
  let x: bigint;
  let y: bigint;
  if (rest.length === 1) {
    const value = big(box.valueNano);
    const ya = big(rest[0]!.amount);
    if (value == null || ya == null) return null;
    xId = null;
    yId = rest[0]!.tokenId;
    x = value - CL_FLOOR_NANO - feeX;
    y = ya - 1n - feeY;
  } else if (rest.length === 2) {
    const [a, b] = rest as [ClPositionBox["assets"][0], ClPositionBox["assets"][0]];
    if (a.index == null || b.index == null || a.index === b.index) return null;
    const [ax, ay] = a.index < b.index ? [a, b] : [b, a];
    const xa = big(ax.amount);
    const ya = big(ay.amount);
    if (xa == null || ya == null) return null;
    xId = ax.tokenId;
    yId = ay.tokenId;
    x = xa - 1n - feeX;
    y = ya - 1n - feeY;
  } else {
    return null;
  }
  if (x < 0n || y < 0n) return null;
  const X = Number(x + vx);
  const Y = Number(y + vy);
  const k = X * Y;
  const lowRaw = (Number(vy) * Number(vy)) / k;
  const highRaw = k / (Number(vx) * Number(vx));
  if (!Number.isFinite(lowRaw) || !Number.isFinite(highRaw) || lowRaw <= 0 || highRaw < lowRaw) return null;
  const unit = clFeeUnit(box.ergoTree);
  const rawFee = Number(feeRaw);
  const fee =
    unit && Number.isFinite(rawFee) && rawFee >= 0
      ? { raw: rawFee, unit, percent: unit === "bps" ? rawFee / 100 : rawFee / 10_000 }
      : null;
  return { x: xId, y: yId, lowRaw, highRaw, fee };
}

/** Raw price (raw Y per raw X) → whole Y per whole X. */
export function wholePrice(raw: number, decX: number, decY: number): number {
  return raw * 10 ** (decX - decY);
}
