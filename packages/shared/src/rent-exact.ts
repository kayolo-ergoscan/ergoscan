/**
 * Exact storage-rent inputs.
 *
 * A miner may take storageFeeFactor × box.bytes.length nanoERG from a box older than one storage
 * period (all of it when the box holds less). `bytes` is the box as the protocol serializes it:
 *
 *   VLQ(value) ‖ ergoTree ‖ VLQ(creationHeight) ‖ u8 tokenCount ‖ (tokenId[32] ‖ VLQ(amount))* ‖
 *   u8 registerCount ‖ R4…R9 serialized ‖ transactionId[32] ‖ VLQ(outputIndex)
 *
 * VLQ is unsigned LEB128, 7 bits a byte. Checked on 29 520 protocol claims of 12–14 Nov 2026:
 * for every box that covered its own fee, rent / 1 250 000 equals this size to the byte
 * (P2PK, scripts, tokens, registers, output index ≥ 128). The old `tree + 16` guess was ~35 % low.
 */

import { ERGO_HEADER_EPOCH_LEN } from "./rent-tape.js";
import { DEFAULT_RENT_PARAMS } from "./rent.js";

/** Token count byte + register count byte + transaction id. */
export const BOX_FIXED_BYTES = 34;
/** Token id in a standalone box: the full 32 bytes. */
export const BOX_TOKEN_ID_BYTES = 32;

function toBig(v: number | bigint | string): bigint | null {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return Number.isFinite(v) ? BigInt(Math.trunc(v)) : null;
    const s = String(v).trim();
    return /^\d+$/.test(s) ? BigInt(s) : null;
  } catch {
    return null;
  }
}

/** Unsigned VLQ length: 1 byte below 2^7, 2 below 2^14, … Negative or invalid input counts as 0 → 1 byte. */
export function vlqLen(v: number | bigint | string): number {
  let n = toBig(v) ?? 0n;
  if (n < 0n) n = 0n;
  let len = 1;
  while (n >= 0x80n) {
    n >>= 7n;
    len += 1;
  }
  return len;
}

function hexBytes(hex: unknown): number {
  if (hex == null) return 0;
  const s = String(hex).replace(/^0x/i, "").trim();
  if (s.length < 2 || s.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(s)) return 0;
  return s.length / 2;
}

export type ErgoBoxSizeInput = {
  valueNano: number | bigint | string;
  /** Tree hex. Either this or treeBytes. */
  ergoTree?: string | null;
  treeBytes?: number | null;
  creationHeight: number;
  /** One amount per token on the box, in box order. */
  tokenAmounts?: ReadonlyArray<number | bigint | string>;
  /** R4…R9 as serialized hex, the node's `additionalRegisters`. Either this or registerBytes. */
  registers?: unknown;
  registerBytes?: number | null;
  outputIndex: number;
};

/** Serialized size of a box, the number the storage fee is charged on. */
export function ergoBoxSizeBytes(input: ErgoBoxSizeInput): number {
  const tree =
    input.treeBytes != null && Number.isFinite(input.treeBytes)
      ? Math.max(0, Math.trunc(input.treeBytes))
      : hexBytes(input.ergoTree);
  let tokens = 0;
  for (const amount of input.tokenAmounts ?? []) tokens += BOX_TOKEN_ID_BYTES + vlqLen(amount);
  let regs = 0;
  if (input.registerBytes != null && Number.isFinite(input.registerBytes)) {
    regs = Math.max(0, Math.trunc(input.registerBytes));
  } else if (input.registers && typeof input.registers === "object" && !Array.isArray(input.registers)) {
    for (const v of Object.values(input.registers as Record<string, unknown>)) regs += hexBytes(v);
  }
  return (
    vlqLen(input.valueNano) +
    tree +
    vlqLen(Math.max(0, Math.trunc(input.creationHeight) || 0)) +
    BOX_FIXED_BYTES +
    tokens +
    regs +
    vlqLen(Math.max(0, Math.trunc(input.outputIndex) || 0))
  );
}

/**
 * VLQ length of a non-negative integer SQL expression (bigint or numeric, below 2^63), as a CASE.
 * The expression is repeated, so pass a column, not a subquery.
 */
export function vlqLenSql(expr: string): string {
  const steps: string[] = [];
  for (let k = 1; k <= 8; k++) steps.push(`WHEN ${expr} < ${(1n << BigInt(7 * k)).toString()} THEN ${k}`);
  return `(CASE ${steps.join(" ")} ELSE 9 END)`;
}

/**
 * Bytes known from the packed.boxes row itself: value, tree, height, the fixed 34, output index,
 * registers. Heap columns only. jsonb_each_text runs only on boxes that have registers.
 */
export function boxRowBytesSql(alias = "b"): string {
  const b = alias;
  return `(${vlqLenSql(`${b}.value_nano`)}
     + COALESCE(${b}.tree_bytes, 0)
     + ${vlqLenSql(`${b}.creation_height`)}
     + ${BOX_FIXED_BYTES}
     + ${vlqLenSql(`COALESCE(${b}.output_index, 0)`)}
     + CASE WHEN ${b}.additional_registers IS NULL OR ${b}.additional_registers = '{}'::jsonb THEN 0
            ELSE COALESCE((SELECT SUM(length(r.v) / 2) FROM jsonb_each_text(${b}.additional_registers) AS r(k, v)), 0)
       END)`;
}

/** One token entry: 32-byte id + VLQ(amount). */
export function tokenEntryBytesSql(amountExpr: string): string {
  return `(${BOX_TOKEN_ID_BYTES} + ${vlqLenSql(amountExpr)})`;
}

/** Σ token entries of the box: one box_assets primary-key probe (box_id prefix) per box. */
export function boxTokenBytesSql(alias = "b"): string {
  return `COALESCE((SELECT SUM(${tokenEntryBytesSql("ta.amount")})
       FROM packed.box_assets ta WHERE ta.box_id = ${alias}.box_id), 0)`;
}

/**
 * Exact serialized size of a packed.boxes row. `tokensUpTo`: an SQL height; boxes created above it
 * skip the box_assets probe and count no tokens (bounds the probe on wide windows).
 */
export function boxBytesSql(alias = "b", opts?: { tokensUpTo?: string }): string {
  const tok = boxTokenBytesSql(alias);
  const tokens = opts?.tokensUpTo
    ? `CASE WHEN ${alias}.creation_height <= ${opts.tokensUpTo} THEN ${tok} ELSE 0 END`
    : tok;
  return `(${boxRowBytesSql(alias)} + ${tokens})`;
}

/**
 * The storage fee of one rent spend, nanoERG: storageFeeFactor × the box's serialized bytes.
 *
 * Charged once per spend, however many periods the box sat. The node's rent check
 * (`ErgoInterpreter.checkExpiredBox`, ergo-wallet/src/main/scala/org/ergoplatform/wallet/
 * interpreter/ErgoInterpreter.scala) is
 *
 *   storageFee = params.storageFeeFactor * box.bytes.length
 *   storageFeeNotCovered = box.value - storageFee <= 0
 *   ok = storageFeeNotCovered || (output.creationHeight == currentHeight
 *        && output.value >= box.value - storageFee && registers R1, R2, R4…R9 unchanged)
 *
 * It has no age term: age only gates the spend (currentHeight - creationHeight ≥ StoragePeriod).
 * The recreated box takes the spend height as its creation height, so its next period starts there.
 * A box holding no more than the fee is taken whole, its tokens included.
 */
export function storageFeeNano(bytes: number, factor: number = DEFAULT_RENT_PARAMS.storageFeeFactor): bigint {
  const b = Math.max(0, Math.floor(bytes) || 0);
  return BigInt(Math.max(0, Math.floor(factor) || 0)) * BigInt(b);
}

/** True when a rent spend may take the box whole (value ≤ fee, `storageFeeNotCovered`). */
export function rentTakesWhole(valueNano: bigint, feeNano: bigint): boolean {
  return valueNano <= feeNano;
}

/** SQL: the storage fee of a packed.boxes row (numeric). `fee`: an SQL expression, e.g. a `$n` param. */
export function rentFeeSql(alias: string, fee: string, opts?: { tokensUpTo?: string }): string {
  return `(${fee}::numeric * ${boxBytesSql(alias, opts)})`;
}

/**
 * SQL: the ERG a miner takes from a packed.boxes row, LEAST(value, fee) (numeric). Every sum shown
 * as rent a miner can collect uses this, never the bare fee: a 0.001 ERG box with a 0.4 ERG fee
 * gives 0.001 ERG.
 */
export function rentTakeSql(alias: string, fee: string, opts?: { tokensUpTo?: string }): string {
  return `LEAST(${alias}.value_nano::numeric, ${rentFeeSql(alias, fee, opts)})`;
}

/** First height of the header epoch that holds `height` (epoch = floor(height / 1024)). */
export function headerEpochStart(height: number): number {
  if (!Number.isFinite(height) || height < 0) return 0;
  const h = Math.trunc(height);
  return h - (h % ERGO_HEADER_EPOCH_LEN);
}

/** Protocol rent collected since `fromHeight`, the start of the current header epoch. */
export type RentEpochCollected = { boxes: number; rentNano: string; fromHeight: number };

function nonNegInt(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

/** snapshot_kv.rent `epochCollected`. Strict: ints ≥ 0 and a digit string, else null. */
export function parseRentEpochCollected(raw: unknown): RentEpochCollected | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const boxes = nonNegInt(r.boxes);
  const fromHeight = nonNegInt(r.fromHeight);
  const rentNano = typeof r.rentNano === "string" && /^\d+$/.test(r.rentNano) ? r.rentNano : null;
  if (boxes == null || fromHeight == null || rentNano == null) return null;
  if (fromHeight % ERGO_HEADER_EPOCH_LEN !== 0) return null;
  return { boxes, rentNano, fromHeight };
}

/** Same, but only for the epoch that holds `height`: last epoch's sum is never shown as this one's. */
export function rentEpochCollectedAt(raw: unknown, height: number | null | undefined): RentEpochCollected | null {
  if (height == null || !Number.isFinite(height) || height < 0) return null;
  const parsed = parseRentEpochCollected(raw);
  if (!parsed || parsed.fromHeight !== headerEpochStart(height)) return null;
  return parsed;
}

/**
 * `ergoBoxSizeBytes` for a box as the node or the index gives it (value, ergoTree, creationHeight,
 * index, assets, additionalRegisters). A missing index counts as one byte (outputs 0…127).
 */
export function ergoBoxSizeOf(box: {
  value?: unknown;
  ergoTree?: unknown;
  creationHeight?: unknown;
  index?: unknown;
  assets?: ReadonlyArray<{ amount?: unknown }> | null;
  additionalRegisters?: unknown;
}): number {
  const amount = (v: unknown): string => (typeof v === "bigint" || typeof v === "number" || typeof v === "string" ? String(v) : "0");
  return ergoBoxSizeBytes({
    valueNano: /^\d+$/.test(amount(box.value)) ? amount(box.value) : "0",
    ergoTree: typeof box.ergoTree === "string" ? box.ergoTree : "",
    creationHeight: Number(box.creationHeight) || 0,
    tokenAmounts: (box.assets ?? []).map((a) => (/^\d+$/.test(amount(a?.amount)) ? amount(a?.amount) : "0")),
    registers: box.additionalRegisters ?? {},
    outputIndex: Number(box.index) || 0,
  });
}
