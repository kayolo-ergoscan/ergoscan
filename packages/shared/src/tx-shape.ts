/**
 * Tx shape — chain facts, not protocol guesses.
 * v4: Monetary protocol txs (fee-collect, reward-unlock, emission coinbase)
 * are exact tree matches. Contract = spending a leftover script.
 * Paying into a leftover script is script-pay.
 * Miners-fee P2S and 88… reward lock are not dApps.
 */

import { LOCK_BY_ADDRESS } from "./lock-addresses.js";

export const TX_SHAPE_RULES_VERSION = 4;

/** Standard miners-fee P2S. Wallets pay every tx here — not a dApp. */
export const MINERS_FEE_ADDRESS =
  "2iHkR7CWvD1R4j1yZg5bkeDRQavjAaVPeTDFGGLZduHyfWMuYpmhHocX8GJoaieTx78FntzJbCBVL6rf96ocJoZdmWBL2fci7NqWgAirppPQmZ7fN9V6z13Ay6brPriBKYqLp1bT2Fk4FkFLCfdPpe";

export const MINERS_FEE_TREE =
  "1005040004000e36100204a00b08cd0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ea02d192a39a8cc7a701730073011001020402d19683030193a38cc7b2a57300000193c2b2a57301007473027303830108cdeeac93b1a57304";

export type TxShape =
  | "coinbase"
  | "fee-collect"
  | "reward-unlock"
  | "transfer"
  | "token"
  | "contract"
  | "script-pay";

const TX_SHAPE_SET: ReadonlySet<string> = new Set([
  "coinbase",
  "fee-collect",
  "reward-unlock",
  "transfer",
  "token",
  "contract",
  "script-pay",
]);

export function asTxShape(s: string | null | undefined): TxShape {
  if (s && TX_SHAPE_SET.has(s)) return s as TxShape;
  return "transfer";
}

export type ShapeBox = {
  ergoTree?: string | null;
  address?: string | null;
  /** SHA-256 of ErgoTree template bytes, 64 hex. Set by the indexer or the mempool poll. */
  templateHash?: string | null;
  assets?: Array<{ tokenId?: string | null; amount?: string | number | null }>;
};

export type TxShapeResult = {
  shape: TxShape;
  protocol: string | null;
  ruleId: string;
  rulesVersion: number;
  /** Frozen list JSON: shape only. Never unknown/agent/token-brand. */
  category: string;
};

export const SHAPE_COLORS: Record<string, string> = {
  coinbase: "#34D399",
  "fee-collect": "#4ADE80",
  "reward-unlock": "#A3E635",
  transfer: "#5B8CFF",
  token: "#2DD4BF",
  contract: "#A78BFA",
  "script-pay": "#7DD3FC",
  unknown: "#64748B",
};

/**
 * Tape chip from rent_collected, not a box shape.
 * One red for both marks. The caption still separates a collection from a renewal.
 */
export const RENT_TAPE_COLOR = {
  rent: "#ff4d4d",
  "rent-renew": "#ff4d4d",
} as const;

export type RentTapeCategory = keyof typeof RENT_TAPE_COLOR;

/** Collector present wins. A mixed tx is rent, not a renewal. */
export function rentTapePaint(
  took: boolean,
  renewed: boolean
): { category: RentTapeCategory; color: string } | null {
  if (took) return { category: "rent", color: RENT_TAPE_COLOR.rent };
  if (renewed) return { category: "rent-renew", color: RENT_TAPE_COLOR["rent-renew"] };
  return null;
}

function normTree(tree?: string | null): string {
  if (!tree) return "";
  return tree.trim().toLowerCase().replace(/^0x/, "");
}

function isP2pkAddress(addr?: string | null): boolean {
  if (!addr) return false;
  return addr.startsWith("9") && addr.length >= 50 && addr.length < 70;
}

export function isMinerFeeBox(box: ShapeBox): boolean {
  if (box.address === MINERS_FEE_ADDRESS) return true;
  const tree = normTree(box.ergoTree);
  return tree.length > 0 && tree === MINERS_FEE_TREE;
}

/** Ergo fee is an output to the miners-fee contract, not Σin−Σout (that is ~0). */
export function minerFeeFromOutputs(
  outputs: Array<ShapeBox & { value?: number | string | null }>
): number {
  let s = 0;
  for (const o of outputs) {
    if (!isMinerFeeBox(o)) continue;
    const n = Number(o.value ?? 0);
    if (Number.isFinite(n) && n > 0) s += n;
  }
  return s;
}

/** Emission lock / pool P2S. Prefix 88 — not Contract. */
export function isMiningRewardLock(box: ShapeBox): boolean {
  const addr = box.address?.trim() ?? "";
  return addr.startsWith("88");
}

export function isEmissionBox(box: ShapeBox): boolean {
  const addr = box.address?.trim() ?? "";
  return Boolean(addr) && LOCK_BY_ADDRESS.get(addr) === "emission";
}

export function isShapeWhitelist(box: ShapeBox): boolean {
  return isMinerFeeBox(box) || isMiningRewardLock(box);
}

/** true / false / null (no tree and no address — incomplete). */
export function isP2pkBox(box: ShapeBox): boolean | null {
  const tree = normTree(box.ergoTree);
  if (tree.startsWith("0008cd")) return true;
  if (tree.length > 0) return false;
  if (isP2pkAddress(box.address)) return true;
  if (box.address && box.address.length > 0) return false;
  return null;
}

/** Non-P2PK after fee / 88 whitelist. Incomplete boxes are not scripts. */
export function isScriptBox(box: ShapeBox): boolean {
  if (isShapeWhitelist(box)) return false;
  return isP2pkBox(box) === false;
}

function boxHasAssets(box: ShapeBox): boolean {
  for (const a of box.assets ?? []) {
    if (!a.tokenId) continue;
    const amt = String(a.amount ?? "0").trim();
    if (amt !== "" && amt !== "0") return true;
  }
  return false;
}

/**
 * Reference `feeProposition(720)`: spend only fee boxes, exactly one output,
 * and that output is the current miner's 720-lock reward script (`88…`).
 */
export function isFeeCollectTx(inputs: ShapeBox[], outputs: ShapeBox[]): boolean {
  if (!inputs.length || outputs.length !== 1) return false;
  if (!inputs.every(isMinerFeeBox)) return false;
  if (!isMiningRewardLock(outputs[0])) return false;
  if (inputs.some(boxHasAssets) || boxHasAssets(outputs[0])) return false;
  return true;
}

/**
 * Emission coinbase: spend + recreate the emission box and pay the 88… lock.
 * Independent of index-in-block so a missing flag cannot hide it.
 */
export function isEmissionRewardTx(inputs: ShapeBox[], outputs: ShapeBox[]): boolean {
  if (!inputs.some(isEmissionBox)) return false;
  if (!outputs.some(isEmissionBox)) return false;
  return outputs.some(isMiningRewardLock);
}

/**
 * Solo claim of matured 720-lock boxes. Pool payouts that mix a hot wallet
 * stay transfer — that is not an exact tree.
 */
export function isRewardUnlockTx(inputs: ShapeBox[], outputs: ShapeBox[]): boolean {
  if (!inputs.length) return false;
  if (!inputs.every(isMiningRewardLock)) return false;
  const nonFee = outputs.filter((box) => !isMinerFeeBox(box));
  if (!nonFee.length) return false;
  return nonFee.every((box) => isP2pkBox(box) === true);
}

export function classifyTxShape(input: {
  coinbase?: boolean;
  inputs?: ShapeBox[];
  outputs?: ShapeBox[];
}): TxShapeResult {
  const inputs = input.inputs ?? [];
  const outputs = input.outputs ?? [];

  let shape: TxShape;
  let ruleId: string;
  let protocol: string | null = null;

  if (isFeeCollectTx(inputs, outputs)) {
    shape = "fee-collect";
    ruleId = "shape:fee-collect";
    protocol = "miner-fee";
  } else if (input.coinbase || isEmissionRewardTx(inputs, outputs)) {
    shape = "coinbase";
    ruleId = input.coinbase ? "shape:coinbase" : "shape:coinbase-emission";
    protocol = inputs.some(isEmissionBox) || outputs.some(isEmissionBox) ? "emission" : null;
  } else if (isRewardUnlockTx(inputs, outputs)) {
    shape = "reward-unlock";
    ruleId = "shape:reward-unlock";
    protocol = "miner-reward";
  } else {
    const hasScriptInput = inputs.some(isScriptBox);
    const hasScriptOutput = outputs.some(isScriptBox);
    const hasAssets = [...inputs, ...outputs].some((box) => {
      if (isMinerFeeBox(box)) return false;
      return boxHasAssets(box);
    });
    const sawKnown = [...inputs, ...outputs].some(
      (box) => box.ergoTree || box.address || boxHasAssets(box)
    );

    if (hasScriptInput) {
      shape = "contract";
      ruleId = "shape:contract";
    } else if (hasAssets) {
      shape = "token";
      ruleId = "shape:token";
    } else if (hasScriptOutput) {
      shape = "script-pay";
      ruleId = "shape:script-pay";
    } else if (sawKnown) {
      shape = "transfer";
      ruleId = "shape:transfer";
    } else {
      shape = "transfer";
      ruleId = "shape:transfer-empty";
    }
  }

  return {
    shape,
    protocol,
    ruleId,
    rulesVersion: TX_SHAPE_RULES_VERSION,
    category: shape,
  };
}

export function txListPaint(result: TxShapeResult): {
  category: string;
  color: string;
  platform: string | null;
} {
  return {
    category: result.shape,
    color: SHAPE_COLORS[result.shape] ?? SHAPE_COLORS.unknown,
    platform: result.protocol,
  };
}

/**
 * Tape chip fields from stored columns.
 * Category is always shape — never protocol. Overlay (lock, else protocol)
 * rides `platform`; attachTxLocks may overwrite it later.
 */
export function txTapeFields(
  shape: string | null | undefined,
  protocol: string | null | undefined
): { category: string; color: string; platform: string | null } {
  const raw = shape && String(shape).length ? String(shape) : null;
  const proto = protocol && String(protocol).length ? String(protocol) : null;
  if (!raw || raw === "unknown") {
    return { category: "unknown", color: SHAPE_COLORS.unknown, platform: proto };
  }
  const paint = txListPaint({
    shape: asTxShape(raw),
    protocol: proto,
    ruleId: "",
    rulesVersion: TX_SHAPE_RULES_VERSION,
    category: asTxShape(raw),
  });
  return {
    category: paint.category,
    color: paint.color,
    platform: paint.platform,
  };
}
