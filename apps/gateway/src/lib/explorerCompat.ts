/**
 * Official explorer v1 field names + our safer amount strings.
 * Pure mappers — no I/O.
 */
import { decodeSigmaConstantMap, ergoTokenDecimals, type SigmaConstantInfo } from "@ergoscan/shared";
export const ERGO_EPOCH_LEN = 1024;

export type ExplorerTokenAmount = {
  tokenId: string;
  amount: string;
  decimals: number;
  name?: string | null;
  tokenType?: string | null;
};

export type ExplorerBalance = {
  nanoErgs: string;
  tokens: ExplorerTokenAmount[];
};

export type ExplorerTokenInfo = {
  id: string;
  boxId: string;
  emissionAmount: string;
  name: string | null;
  description: string | null;
  decimals: number;
  type: string | null;
};

export type ExplorerHeader = {
  id: string;
  parentId: string | null;
  version: number | null;
  height: number;
  epoch: number;
  timestamp: number;
  difficulty: string | null;
  size: number | null;
  votes: string;
};

export type ExplorerEpochParams = {
  height: number;
  storageFeeFactor: number;
  minValuePerByte: number;
  maxBlockSize: number;
  maxBlockCost: number;
  blockVersion: number;
  tokenAccessCost: number;
  inputCost: number;
  dataInputCost: number;
  outputCost: number;
  subblocksPerBlock?: number;
};

export type ExplorerBox = {
  boxId: string;
  transactionId: string | null;
  blockId: string | null;
  value: string;
  index: number | null;
  globalIndex: number | null;
  creationHeight: number | null;
  settlementHeight: number | null;
  ergoTree: string | null;
  address: string | null;
  assets: { tokenId: string; amount: string }[];
  additionalRegisters: Record<string, SigmaConstantInfo>;
  spentTransactionId: string | null;
  mainChain: boolean;
};

export function ergoEpoch(height: number): number {
  if (!Number.isFinite(height) || height < 0) return 0;
  return Math.floor(height / ERGO_EPOCH_LEN);
}

export function asDecString(v: unknown): string {
  if (v == null) return "0";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") {
    const t = v.trim();
    return t.length ? t : "0";
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "0";
    return String(Math.trunc(v));
  }
  return String(v);
}

/** Holder share vs `tokens.emission`, 2 dp. Not SUM(token_balances). */
export function sharePctOfEmission(amount: unknown, emission: unknown): number | null {
  try {
    const den = BigInt(asDecString(emission).split(".")[0] || "0");
    if (den <= 0n) return null;
    const n = BigInt(asDecString(amount).split(".")[0] || "0");
    if (n < 0n) return null;
    return Number((n * 10000n) / den) / 100;
  } catch {
    return null;
  }
}

function asInt(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function mapEpochParams(raw: Record<string, unknown> | null | undefined): ExplorerEpochParams | null {
  if (!raw || typeof raw !== "object") return null;
  const height = asInt(raw.height, NaN);
  if (!Number.isFinite(height)) return null;
  return {
    height,
    storageFeeFactor: asInt(raw.storageFeeFactor),
    minValuePerByte: asInt(raw.minValuePerByte),
    maxBlockSize: asInt(raw.maxBlockSize),
    maxBlockCost: asInt(raw.maxBlockCost),
    blockVersion: asInt(raw.blockVersion),
    tokenAccessCost: asInt(raw.tokenAccessCost),
    inputCost: asInt(raw.inputCost),
    dataInputCost: asInt(raw.dataInputCost),
    outputCost: asInt(raw.outputCost),
    ...(raw.subblocksPerBlock != null
      ? { subblocksPerBlock: asInt(raw.subblocksPerBlock) }
      : {}),
  };
}

/** DB decimals win when set. Known map fills 0/null. NFTs (emission=1) stay 0. */
export function resolveDecimals(
  tokenId: string,
  stored: number | null | undefined,
  emission?: string | number | null
): number {
  const em = emission == null ? null : asDecString(emission);
  if (em === "1") {
    return stored != null && Number.isFinite(stored) && stored > 0 ? stored : 0;
  }
  if (stored != null && Number.isFinite(stored) && stored > 0) return stored;
  const known = ergoTokenDecimals(tokenId);
  if (known != null && Number.isFinite(known) && known > 0) return known;
  return stored != null && Number.isFinite(stored) ? stored : 0;
}

export function mapTokenInfo(row: {
  tokenId: string;
  boxId?: string | null;
  emission?: string | number | null;
  name?: string | null;
  description?: string | null;
  decimals?: number | null;
}): ExplorerTokenInfo {
  const emission = row.emission == null ? "0" : asDecString(row.emission);
  return {
    id: row.tokenId,
    boxId: row.boxId || row.tokenId,
    emissionAmount: emission,
    name: row.name ?? null,
    description: row.description ?? null,
    decimals: resolveDecimals(row.tokenId, row.decimals, emission),
    type: emission === "1" ? "EIP-004" : null,
  };
}

export function mapBlockHeader(row: {
  id: string;
  parentId?: string | null;
  height: number;
  timestamp: number;
  difficulty?: string | number | null;
  size?: number | null;
  version?: number | null;
}): ExplorerHeader {
  return {
    id: row.id,
    parentId: row.parentId ?? null,
    version: row.version ?? null,
    height: row.height,
    epoch: ergoEpoch(row.height),
    timestamp: row.timestamp,
    difficulty: row.difficulty == null ? null : asDecString(row.difficulty),
    size: row.size ?? null,
    votes: "",
  };
}

/** Official explorer register object. Wallet GSON rejects a bare hex string. */
export function registersAsSigma(
  raw: Record<string, unknown> | Record<string, string> | null | undefined
): Record<string, SigmaConstantInfo> {
  return decodeSigmaConstantMap(raw ?? null);
}

export function registersAsExplorer(
  raw: Record<string, unknown> | null | undefined
): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string" && v) {
      out[k] = v;
      continue;
    }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.serializedValue === "string") out[k] = o.serializedValue;
      else if (typeof o.renderedValue === "string") out[k] = o.renderedValue;
    }
  }
  return out;
}

export type ExplorerBoxInput = {
  boxId: string;
  value: unknown;
  creationHeight?: number | null;
  settlementHeight?: number | null;
  inclusionHeight?: number | null;
  address?: string | null;
  ergoTree?: string | null;
  transactionId?: string | null;
  index?: number | null;
  gix?: number | null;
  assets?: { tokenId: string; amount: unknown }[];
  additionalRegisters?: Record<string, string> | Record<string, unknown> | null;
  spentTransactionId?: string | null;
  blockId?: string | null;
};

export function mapExplorerBox(row: ExplorerBoxInput): ExplorerBox {
  const settled = row.settlementHeight ?? row.inclusionHeight ?? row.creationHeight ?? null;
  return {
    boxId: row.boxId,
    transactionId: row.transactionId ?? null,
    blockId: row.blockId ?? null,
    value: asDecString(row.value),
    index: row.index ?? null,
    globalIndex:
      row.gix != null && Number.isFinite(row.gix) && row.gix >= 0
        ? Math.trunc(row.gix)
        : null,
    creationHeight: row.creationHeight ?? null,
    settlementHeight: settled,
    ergoTree: row.ergoTree ?? null,
    address: row.address ?? null,
    assets: (row.assets ?? []).map((a) => ({
      tokenId: a.tokenId,
      amount: asDecString(a.amount),
    })),
    additionalRegisters: registersAsSigma(row.additionalRegisters),
    spentTransactionId: row.spentTransactionId ?? null,
    mainChain: true,
  };
}

export type ExplorerTx = {
  id: string;
  blockId: string | null;
  inclusionHeight: number | null;
  timestamp: number | null;
  index: number | null;
  globalIndex: number | null;
  inputs: ExplorerBox[];
  dataInputs: ExplorerBox[];
  outputs: ExplorerBox[];
  size: number | null;
};

export function mapExplorerTx(row: {
  id: string;
  blockId?: string | null;
  inclusionHeight?: number | null;
  timestamp?: number | null;
  index?: number | null;
  gix?: number | null;
  inputs?: ExplorerBoxInput[];
  outputs?: ExplorerBoxInput[];
  size?: number | null;
}): ExplorerTx {
  return {
    id: row.id,
    blockId: row.blockId ?? null,
    inclusionHeight: row.inclusionHeight ?? null,
    timestamp: row.timestamp ?? null,
    index: row.index ?? null,
    globalIndex:
      row.gix != null && Number.isFinite(row.gix) && row.gix >= 0
        ? Math.trunc(row.gix)
        : null,
    inputs: (row.inputs ?? []).map(mapExplorerBox),
    dataInputs: [],
    outputs: (row.outputs ?? []).map(mapExplorerBox),
    size: row.size ?? null,
  };
}

export function itemsPage<T>(items: T[], total: number, offset: number, limit: number) {
  return { items, total, offset, limit };
}

export function notImplemented(feature: string) {
  return {
    error: "not_implemented",
    feature,
    status: 501,
    note: "No full-table scan on boxes. Exact byErgoTree uses the script index. Template-only POST search uses packed.box_template (limit ≤ 100, offset ≤ 500, 4s). Register, constant, and token predicates stay 501. Unspent/stream without a bound and blocks/byGlobalIndex stay 501. Box and tx byGlobalIndex streams are live.",
  };
}

function addToken(map: Map<string, bigint>, tokenId: string, delta: bigint) {
  if (!tokenId || delta === 0n) return;
  map.set(tokenId, (map.get(tokenId) ?? 0n) + delta);
}

function boxMentionsAddress(
  box: { address?: unknown; ergoTree?: unknown },
  address: string,
  tree: string | null
): boolean {
  if (typeof box.address === "string" && box.address === address) return true;
  if (tree && typeof box.ergoTree === "string") {
    const t = box.ergoTree.replace(/^0x/i, "").toLowerCase();
    return t === tree.replace(/^0x/i, "").toLowerCase();
  }
  return false;
}

/** Confirmed + mempool RAM delta. Inputs without value do not invent spends. */
export function mempoolBalanceDelta(
  address: string,
  txs: Iterable<{
    inputs?: Array<{ address?: unknown; ergoTree?: unknown; value?: unknown; assets?: Array<{ tokenId?: string; amount?: unknown }> }>;
    outputs?: Array<{ address?: unknown; ergoTree?: unknown; value?: unknown; assets?: Array<{ tokenId?: string; amount?: unknown }> }>;
  }>,
  ergoTree: string | null = null
): ExplorerBalance {
  let nano = 0n;
  const tokens = new Map<string, bigint>();
  for (const tx of txs) {
    for (const box of tx.outputs ?? []) {
      if (!boxMentionsAddress(box, address, ergoTree)) continue;
      nano += BigInt(asDecString(box.value));
      for (const a of box.assets ?? []) {
        if (a.tokenId) addToken(tokens, a.tokenId, BigInt(asDecString(a.amount)));
      }
    }
    for (const box of tx.inputs ?? []) {
      if (!boxMentionsAddress(box, address, ergoTree)) continue;
      nano -= BigInt(asDecString(box.value));
      for (const a of box.assets ?? []) {
        if (a.tokenId) addToken(tokens, a.tokenId, -BigInt(asDecString(a.amount)));
      }
    }
  }
  return {
    nanoErgs: nano.toString(),
    tokens: [...tokens.entries()]
      .filter(([, amt]) => amt !== 0n)
      .map(([tokenId, amount]) => ({
        tokenId,
        amount: amount.toString(),
        decimals: 0,
      })),
  };
}

export function mempoolUnspentForAddress(
  address: string,
  txs: Iterable<{
    id: string;
    outputs?: Array<{
      boxId?: unknown;
      address?: unknown;
      ergoTree?: unknown;
      value?: unknown;
      creationHeight?: unknown;
      assets?: Array<{ tokenId?: string; amount?: unknown }>;
    }>;
  }>,
  ergoTree: string | null = null
): ExplorerBox[] {
  const items: ExplorerBox[] = [];
  for (const tx of txs) {
    for (const [i, box] of (tx.outputs ?? []).entries()) {
      if (!boxMentionsAddress(box, address, ergoTree)) continue;
      const boxId = typeof box.boxId === "string" ? box.boxId : null;
      if (!boxId) continue;
      items.push(
        mapExplorerBox({
          boxId,
          value: box.value,
          creationHeight:
            typeof box.creationHeight === "number" ? box.creationHeight : null,
          address: typeof box.address === "string" ? box.address : address,
          ergoTree: typeof box.ergoTree === "string" ? box.ergoTree : null,
          transactionId: tx.id,
          index: i,
          assets: (box.assets ?? [])
            .filter((a) => a.tokenId)
            .map((a) => ({ tokenId: a.tokenId as string, amount: a.amount })),
        })
      );
    }
  }
  return items;
}

export function sumBalances(a: ExplorerBalance, b: ExplorerBalance): ExplorerBalance {
  const tokens = new Map<string, { amount: bigint; decimals: number; name?: string | null }>();
  for (const t of [...a.tokens, ...b.tokens]) {
    const prev = tokens.get(t.tokenId);
    const amt = BigInt(asDecString(t.amount)) + (prev?.amount ?? 0n);
    tokens.set(t.tokenId, {
      amount: amt,
      decimals: t.decimals || prev?.decimals || 0,
      name: t.name ?? prev?.name ?? null,
    });
  }
  return {
    nanoErgs: (BigInt(asDecString(a.nanoErgs)) + BigInt(asDecString(b.nanoErgs))).toString(),
    tokens: [...tokens.entries()]
      .filter(([, t]) => t.amount !== 0n)
      .map(([tokenId, t]) => ({
        tokenId,
        amount: t.amount.toString(),
        decimals: t.decimals,
        name: t.name ?? null,
      })),
  };
}
