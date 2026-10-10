/**
 * Chain explorer routes: blocks, txs, boxes, addresses.
 */
import type { Express } from "express";
import {
  computeBoxRent,
  estimateBoxSizeBytes,
  registerPayloadBytes,
  estimateFee,
  txToBall,
  DEFAULT_RENT_PARAMS,
  KNOWN_TOKENS,
  classifyTxShape,
  pickTxAction,
  classifyAddrFlow,
  eip4MintOfOutputs,
  netValueParties,
  parseNanoErg,
  pickTxLock,
  type AddrFlowKind,
  type BallProps,
  type RawTx,
  previewArtworkUrl,
  decodeSigmaConstantMap,
} from "@ergoscan/shared";
import { laterTs } from "../lib/later-ts.js";
import { stampTemplateHashes } from "../lib/txTemplateHash.js";
import { pageLimit } from "../lib/page-limit.js";
import { addressFromErgoTree, ergoTreeFromAddress, normErgoTree } from "../lib/ergoAddress.js";
import { decodeErgoTree, type ErgoTreeDecode } from "../lib/ergoTree.js";
import {
  addressBalanceConfirmed,
  addressNftsFromIndex,
  addressTokenTape,
  addressTokensConfirmed,
  addressTransactionsCursor,
  addressTxActivity,
  addressTxParties,
  addressUnspentBoxesCursor,
  boxesLiteByIds,
  boxesLiteByIdsChecked,
  ergoTreeForAddress,
  type BoxLite,
  addressRentBlocks,
  getAddressSummary,
  getBoxById,
  getTxById,
  readGixWatermark,
  getTxHeads,
  indexerStatus,
  parseAddressSort,
  parseAddressSortDir,
  parseAddressBandList,
  parseAddressKindList,
  joinAddressFilter,
  normalizeAddressFilter,
  parseKeysetCursor,
  readyPreviewCids,
  tokenMetaMany,
  unspentBoxesByTokenId,
  refreshSpectrumPoolNfts,
  cachedDexLockHints,
  type AddrTxActivity,
} from "../lib/indexDb.js";
import { rentWriterHealth } from "../lib/rentIndex.js";
import { addressName } from "../lib/names.js";
import { BLOCK_TX_PACK, getAddressesPage, getBlockCard, getBlockSections, getBlocksList, getHolderBands, getHomePage, getRentPage, getStatusSnapshot, parseBlockHeightCursor, peekChainTip, rentTapeMarks } from "../lib/snapshots.js";
import { publicIndexerStatus } from "../lib/public-health.js";
import { holderFilterTotal } from "../lib/addressListFilter.js";
import { cacheList, cacheNoStore, cacheTip, cacheTokens } from "../lib/httpCache.js";
import { mapEpochParams } from "../lib/explorerCompat.js";
import type { OrbitSnap } from "../lib/orbit-peers.js";

export type ChainDeps = {
  getRawMempool: () => Map<string, RawTx>;
  getBalls: () => Map<string, BallProps>;
  getFullHeight: () => number | null | undefined;
  getNodeInfoRaw?: () => Record<string, unknown>;
  getOrbit: () => OrbitSnap;
  blocksLimit: number;
};

/** Keep nanoERG / token raw as decimal strings — never JS Number (LP overflow). */
function amountStr(v: unknown): string {
  if (v == null) return "0";
  if (typeof v === "string") {
    const t = v.trim();
    return t.length ? t : "0";
  }
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "0";
    // May already be precision-damaged if it came through JSON.parse
    return String(Math.trunc(v));
  }
  return String(v);
}

const MEMPOOL_ADDR_SCAN_CAP = 400;

function rawBoxAddress(box: unknown): string | null {
  const a = (box as { address?: unknown }).address;
  return typeof a === "string" && a.length > 0 ? a : null;
}

function rawBoxId(box: unknown): string | null {
  const id = (box as { boxId?: unknown }).boxId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function rawBoxTree(box: unknown): string | null {
  return normErgoTree((box as { ergoTree?: unknown }).ergoTree);
}

function boxLiteFromRaw(box: unknown): BoxLite | null {
  const boxId = rawBoxId(box);
  if (!boxId) return null;
  const assets = (box as { assets?: { tokenId?: string; amount?: unknown }[] }).assets ?? [];
  return {
    boxId,
    value: amountStr((box as { value?: unknown }).value),
    address: rawBoxAddress(box),
    ergoTree: rawBoxTree(box),
    assets: assets.map((a) => ({
      tokenId: String(a.tokenId ?? ""),
      amount: amountStr(a.amount),
    })),
  };
}

function boxHitsAddress(
  box: unknown,
  address: string,
  tree: string | null,
  hint?: BoxLite
): boolean {
  if (rawBoxAddress(box) === address || hint?.address === address) return true;
  if (!tree) return false;
  const bt = rawBoxTree(box) ?? normErgoTree(hint?.ergoTree);
  return bt != null && bt === tree;
}

function rawTouchesAddress(
  address: string,
  tx: RawTx,
  ball: BallProps | undefined,
  tree: string | null,
  hintFor: (box: unknown) => BoxLite | undefined
): boolean {
  if (ball?.addresses?.includes(address)) return true;
  for (const box of tx.inputs ?? []) {
    if (boxHitsAddress(box, address, tree, hintFor(box))) return true;
  }
  for (const box of tx.outputs ?? []) {
    if (boxHitsAddress(box, address, tree, hintFor(box))) return true;
  }
  try {
    return JSON.stringify(tx).includes(address);
  } catch {
    return false;
  }
}

function mempoolFlowForAddress(
  address: string,
  tx: RawTx,
  tree: string | null,
  hintFor: (box: unknown) => BoxLite | undefined,
  fee: bigint
): AddrTxActivity | null {
  const inputs = tx.inputs ?? [];
  const outputs = tx.outputs ?? [];
  const hasIn = inputs.some((i) => boxHitsAddress(i, address, tree, hintFor(i)));
  const hasOut = outputs.some((o) => boxHitsAddress(o, address, tree, hintFor(o)));
  if (!hasIn && !hasOut) return null;

  let inErg = 0n;
  let outErg = 0n;
  const tokens = new Map<string, bigint>();
  const mintBoxes: { boxId?: string | null; assets?: { tokenId?: string; amount?: unknown }[] }[] =
    [];
  const addTok = (id: string | undefined, d: bigint) => {
    if (!id || /^0+$/.test(id)) return;
    const k = id.toLowerCase();
    const next = (tokens.get(k) ?? 0n) + d;
    if (next === 0n) tokens.delete(k);
    else tokens.set(k, next);
  };

  for (const i of inputs) {
    const hint = hintFor(i);
    if (!boxHitsAddress(i, address, tree, hint)) continue;
    try {
      inErg += parseNanoErg(hint?.value ?? amountStr((i as { value?: unknown }).value));
    } catch {
      /* */
    }
    const assets =
      (i as { assets?: { tokenId?: string; amount?: unknown }[] }).assets ??
      hint?.assets ??
      [];
    for (const a of assets) {
      try {
        addTok(a.tokenId, -parseNanoErg(amountStr(a.amount)));
      } catch {
        /* */
      }
    }
  }
  for (const o of outputs) {
    const hint = hintFor(o);
    if (!boxHitsAddress(o, address, tree, hint)) continue;
    try {
      outErg += parseNanoErg(amountStr((o as { value?: unknown }).value));
    } catch {
      /* */
    }
    const assets = (o as { assets?: { tokenId?: string; amount?: unknown }[] }).assets ?? [];
    mintBoxes.push({ boxId: rawBoxId(o) ?? hint?.boxId, assets });
    for (const a of assets) {
      try {
        addTok(a.tokenId, parseNanoErg(amountStr(a.amount)));
      } catch {
        /* */
      }
    }
  }

  const mint = eip4MintOfOutputs(mintBoxes);
  const netErg = outErg - inErg;
  const kind = classifyAddrFlow({
    netErg,
    fee,
    tokens: [...tokens.entries()].map(([id, amount]) => ({
      amount,
      mint: mint.get(id) ?? 0n,
    })),
  });
  const partyOf = (box: unknown, hint?: BoxLite): string | null => {
    if (box && typeof box === "object" && "address" in box) {
      const direct = (box as { address?: unknown }).address;
      if (typeof direct === "string" && direct.trim()) return direct.trim();
    }
    const hinted = hint?.address?.trim();
    return hinted || null;
  };
  const asParty = (box: unknown, hint?: BoxLite) => {
    const raw = box && typeof box === "object" ? (box as { value?: unknown; assets?: { tokenId?: string; amount?: unknown }[] }) : null;
    return {
      address: partyOf(box, hint),
      value: hint?.value ?? raw?.value ?? null,
      assets: raw?.assets ?? hint?.assets ?? [],
    };
  };
  const parties = netValueParties(
    inputs.map((box) => asParty(box, hintFor(box))),
    outputs.map((box) => asParty(box, hintFor(box))),
    fee
  );
  return {
    kind,
    erg: netErg.toString(),
    tokens: [...tokens.entries()].map(([tokenId, amount]) => ({
      tokenId,
      amount: amount.toString(),
    })),
    from: parties.from,
    to: parties.to,
  };
}

type MempoolAddrTx = {
  id: string;
  inclusionHeight: null;
  timestamp: number;
  numConfirmations: number;
  size: number | null;
  fee: number;
  mempool: true;
};

async function resolveAddrErgoTree(address: string): Promise<string | null> {
  const local = normErgoTree(ergoTreeFromAddress(address));
  if (local) return local;
  return normErgoTree(await ergoTreeForAddress(address));
}

async function mempoolTxsForAddress(
  address: string,
  mem: Map<string, RawTx>,
  balls: Map<string, BallProps>,
  skipIds: Set<string>
): Promise<{ txs: MempoolAddrTx[]; activity: Record<string, AddrTxActivity> }> {
  const tree = await resolveAddrErgoTree(address);
  const outById = new Map<string, BoxLite>();
  for (const tx of mem.values()) {
    for (const o of tx.outputs ?? []) {
      const lite = boxLiteFromRaw(o);
      if (lite) outById.set(lite.boxId, lite);
    }
  }
  const unresolved: string[] = [];
  let scan = 0;
  for (const tx of mem.values()) {
    if (scan++ > MEMPOOL_ADDR_SCAN_CAP) break;
    for (const inp of tx.inputs ?? []) {
      const id = rawBoxId(inp);
      if (!id || outById.has(id)) continue;
      unresolved.push(id);
    }
  }
  const idxBoxes = await boxesLiteByIds(unresolved);
  const hintFor = (box: unknown): BoxLite | undefined => {
    const id = rawBoxId(box);
    if (!id) return undefined;
    return outById.get(id) ?? idxBoxes.get(id);
  };

  const txs: MempoolAddrTx[] = [];
  const activity: Record<string, AddrTxActivity> = {};
  let n = 0;
  for (const tx of mem.values()) {
    if (n++ > MEMPOOL_ADDR_SCAN_CAP) break;
    if (!tx?.id || skipIds.has(tx.id)) continue;
    const ball = balls.get(tx.id);
    if (!rawTouchesAddress(address, tx, ball, tree, hintFor)) continue;
    const fee = parseNanoErg(ball?.fee ?? estimateFee(tx));
    const flow = mempoolFlowForAddress(address, tx, tree, hintFor, fee);
    if (flow) activity[tx.id] = flow;
    const sizeNum = Number(tx.size) || ball?.size || null;
    txs.push({
      id: tx.id,
      inclusionHeight: null,
      timestamp: ball?.firstSeen ?? Date.now(),
      numConfirmations: 0,
      size: sizeNum != null && Number.isFinite(sizeNum) ? sizeNum : null,
      fee: ball?.fee ?? estimateFee(tx),
      mempool: true,
    });
  }
  txs.sort((a, b) => b.timestamp - a.timestamp);
  return { txs: txs.slice(0, 40), activity };
}

function activityNanoSum(activity: Record<string, AddrTxActivity>): string {
  let s = 0n;
  for (const f of Object.values(activity)) {
    try {
      s += BigInt(f.erg);
    } catch {
      /* */
    }
  }
  return s.toString();
}

function mapIo(x: Record<string, unknown> | { boxId?: string; value?: number }) {
  const o = x as Record<string, unknown>;
  const assets = (o.assets as Array<{ tokenId?: string; amount?: number | string }>) ?? [];
  const ergoTree = (o.ergoTree as string) ?? null;
  const given = typeof o.address === "string" ? o.address.trim() : "";
  const address = given || addressFromErgoTree(ergoTree);
  const mappedAssets = assets.map((a) => ({
    tokenId: String(a.tokenId ?? ""),
    amount: amountStr(a.amount),
  }));
  return {
    boxId: (o.boxId as string) ?? null,
    value: o.value != null ? amountStr(o.value) : null,
    ergoTree,
    assets: mappedAssets,
    additionalRegisters: o.additionalRegisters ?? o.registers ?? {},
    creationHeight: o.creationHeight ?? null,
    address,
    index: o.index ?? null,
    transactionId: (o.transactionId as string) ?? null,
  };
}

type IoMapped = ReturnType<typeof mapIo>;

function mapIdxIo(
  b: {
    boxId: string;
    value: string;
    ergoTree: string | null;
    address: string | null;
    creationHeight: number | null;
    creationTxId: string | null;
    index: number | null;
    additionalRegisters: Record<string, unknown> | null;
    assets: { tokenId: string; amount: string }[];
  },
  index: number
): IoMapped {
  return {
    boxId: b.boxId,
    value: amountStr(b.value),
    ergoTree: b.ergoTree,
    assets: b.assets.map((a) => ({
      tokenId: a.tokenId,
      amount: amountStr(a.amount),
    })),
    additionalRegisters: b.additionalRegisters ?? {},
    creationHeight: b.creationHeight,
    address: b.address ?? addressFromErgoTree(b.ergoTree),
    index: b.index != null ? b.index : index,
    transactionId: b.creationTxId,
  } as IoMapped;
}

function rawFromMapped(id: string, size: number | null, inputs: IoMapped[], outputs: IoMapped[]): RawTx {
  return {
    id,
    size: size ?? undefined,
    inputs: inputs.map((io) => ({
      boxId: io.boxId ?? undefined,
      value: io.value != null ? Number(io.value) || 0 : undefined,
      assets: io.assets,
      ergoTree: io.ergoTree ?? undefined,
      additionalRegisters: (io.additionalRegisters ?? {}) as Record<string, string>,
      creationHeight: io.creationHeight != null ? Number(io.creationHeight) : undefined,
      transactionId: io.transactionId ?? undefined,
      index: io.index != null ? Number(io.index) : undefined,
      address: io.address ?? undefined,
    })),
    outputs: outputs.map((io) => ({
      boxId: io.boxId ?? undefined,
      value: io.value != null ? Number(io.value) || 0 : undefined,
      assets: io.assets,
      ergoTree: io.ergoTree ?? undefined,
      additionalRegisters: (io.additionalRegisters ?? {}) as Record<string, string>,
      creationHeight: io.creationHeight != null ? Number(io.creationHeight) : undefined,
      transactionId: io.transactionId ?? undefined,
      index: io.index != null ? Number(io.index) : undefined,
      address: io.address ?? undefined,
    })),
  } as RawTx;
}

function shapeFromIo(
  coinbase: boolean,
  inputs: Array<{
    ergoTree?: string | null;
    address?: string | null;
    assets?: Array<{ tokenId?: string | null; amount?: string | number | null }>;
  }>,
  outputs: Array<{
    ergoTree?: string | null;
    address?: string | null;
    assets?: Array<{ tokenId?: string | null; amount?: string | number | null }>;
  }>
) {
  return classifyTxShape({ coinbase, inputs, outputs });
}

function lockFromIo(
  inputs: Array<{
    ergoTree?: string | null;
    address?: string | null;
    assets?: Array<{ tokenId?: string | null; amount?: string | number | null }>;
  }>,
  outputs: Array<{
    ergoTree?: string | null;
    address?: string | null;
    assets?: Array<{ tokenId?: string | null; amount?: string | number | null }>;
  }>,
  dataInputs?: Array<{
    ergoTree?: string | null;
    address?: string | null;
    assets?: Array<{ tokenId?: string | null; amount?: string | number | null }>;
  }>
): string | null {
  return (
    pickTxLock(
      { inputs, outputs, dataInputs },
      cachedDexLockHints()
    )?.id ?? null
  );
}

type HydratedIo = {
  items: IoMapped[];
  assetsComplete: boolean;
};

/** Fill mempool I/O from indexed boxes (spent inputs). Never the node. */
async function hydrateIoFromIndex(
  ios: IoMapped[],
  side: "input" | "output"
): Promise<HydratedIo> {
  const ids = ios
    .map((io) => io.boxId)
    .filter((id): id is string => !!id && id.length >= 16);
  if (!ids.length) {
    return {
      items: ios,
      assetsComplete:
        side === "output" && ios.every((io) => io.value != null),
    };
  }
  const result = await boxesLiteByIdsChecked(ids);
  const found = result.boxes;
  const items = ios.map((io) => {
    if (!io.boxId) return io;
    const b = found.get(io.boxId);
    if (!b) return io;
    const ergoTree = io.ergoTree ?? b.ergoTree;
    return {
      ...io,
      ergoTree,
      address: io.address ?? b.address ?? addressFromErgoTree(ergoTree),
      value: io.value ?? amountStr(b.value),
      assets: io.assets?.length
        ? io.assets
        : b.assets.map((a) => ({
            tokenId: a.tokenId,
            amount: amountStr(a.amount),
          })),
    };
  });
  return {
    items,
    assetsComplete:
      result.assetsComplete &&
      (side === "input"
        ? ios.every((io) => io.boxId != null && found.has(io.boxId))
        : ios.every((io) => io.value != null)),
  };
}

async function tokenMetaForIo(inputs: IoMapped[], outputs: IoMapped[]) {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const io of [...inputs, ...outputs]) {
    for (const a of io.assets ?? []) {
      const id = String(a.tokenId ?? "").toLowerCase();
      if (id.length === 64 && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  const meta = await tokenMetaMany(ids);
  return ids.map((tokenId) => {
    const m = meta.get(tokenId);
    return {
      tokenId,
      name: m?.name ?? null,
      decimals: m?.decimals ?? null,
    };
  });
}

function ioValueSum(ios: IoMapped[]): string {
  let n = 0n;
  for (const io of ios) {
    try {
      n += BigInt(String(io.value ?? "0").split(".")[0] || "0");
    } catch {
      /* skip */
    }
  }
  return n.toString();
}

function normalizeBox(
  box: Record<string, unknown>,
  source: string,
  rentExtras?: { currentHeight?: number; sizeBytes?: number; rentParams?: Partial<typeof DEFAULT_RENT_PARAMS> }
) {
  const regs =
    (box.additionalRegisters as Record<string, string | null>) ??
    (box.registers as Record<string, string | null>) ??
    {};
  // Rent clock = declared creationHeight only. Never inclusion/settlement.
  const creationHeight = numOrNull(box.creationHeight);
  const inclusionHeight = numOrNull(box.inclusionHeight) ?? numOrNull(box.settlementHeight);
  const settlementHeight = numOrNull(box.settlementHeight) ?? numOrNull(box.inclusionHeight);
  const blockId =
    typeof box.blockId === "string" && box.blockId.trim() ? box.blockId.trim() : null;
  // Strings only — LP amounts exceed Number.MAX_SAFE_INTEGER
  const value = amountStr(box.value ?? box.value_nano ?? "0");
  const rawAssets = Array.isArray(box.assets) ? box.assets : [];
  const assets = rawAssets.map((a) => {
    const x = a as Record<string, unknown>;
    const decimals = Number(x.decimals);
    const emission = Number(x.emission);
    return {
      tokenId: String(x.tokenId ?? x.token_id ?? ""),
      amount: amountStr(x.amount),
      name: typeof x.name === "string" && x.name.trim() ? x.name : null,
      decimals: Number.isFinite(decimals) ? decimals : null,
      emission: Number.isFinite(emission) ? emission : null,
    };
  });
  const sizeBytes =
    rentExtras?.sizeBytes ??
    estimateBoxSizeBytes({
      ergoTree: String(box.ergoTree ?? ""),
      assetsCount: assets.length,
      registerBytes: registerPayloadBytes(regs),
    });
  const currentHeight = rentExtras?.currentHeight ?? null;
  // Rent uses number; clamp huge values (display only)
  let valueNanoRent = 0;
  try {
    const b = BigInt(value);
    valueNanoRent =
      b > BigInt(Number.MAX_SAFE_INTEGER)
        ? Number.MAX_SAFE_INTEGER
        : Number(b);
  } catch {
    valueNanoRent = 0;
  }
  const rent =
    currentHeight != null
      ? computeBoxRent({
          creationHeight,
          currentHeight,
          valueNano: valueNanoRent,
          sizeBytes,
          params: rentExtras?.rentParams,
        })
      : null;

  const ergoTree = String(box.ergoTree ?? "");
  const rawAddr = box.address;
  const address =
    typeof rawAddr === "string" && rawAddr.trim()
      ? rawAddr.trim()
      : addressFromErgoTree(box.ergoTree) ?? null;

  return {
    boxId: box.boxId ?? box.id,
    value,
    ergoTree,
    assets,
    registers: {
      R4: regs.R4 ?? regs["R4"] ?? null,
      R5: regs.R5 ?? null,
      R6: regs.R6 ?? null,
      R7: regs.R7 ?? null,
      R8: regs.R8 ?? null,
      R9: regs.R9 ?? null,
      ...regs,
    },
    additionalRegisters: regs,
    creationHeight,
    inclusionHeight,
    settlementHeight,
    blockId,
    spentHeight: numOrNull(box.spentHeight),
    createdTs: numOrNull(box.createdTs),
    spentTs: numOrNull(box.spentTs),
    address,
    transactionId: box.transactionId ?? null,
    spentTransactionId: box.spentTransactionId ?? null,
    index: box.index ?? null,
    gix: numOrNull(box.gix),
    sizeBytes,
    rent,
    rentAsOf: numOrNull(box.spentHeight) != null ? "spend" : "tip",
    source,
  };
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const EMPTY_TREE: ErgoTreeDecode = {
  ergoTreeConstants: "",
  ergoTreeScript: "",
  ergoTreeTemplateHash: null,
  treeConstants: [],
};

/** Card-only. Lists keep normalizeBox cheap — no Sigma parse. */
async function attachBoxCardDecode(
  ergoTree: string | null | undefined,
  regs: Record<string, unknown> | null | undefined
) {
  let tree: ErgoTreeDecode = EMPTY_TREE;
  try {
    tree = await decodeErgoTree(ergoTree ?? null);
  } catch (err) {
    console.warn("[boxes/:id] ergoTree decode failed", err);
  }
  return {
    registersTyped: decodeSigmaConstantMap(regs ?? null),
    ...tree,
  };
}

export function registerChainRoutes(app: Express, deps: ChainDeps) {
  app.get("/v1/blocks", async (req, res) => {
    const limit = Math.min(
      50,
      Math.max(1, Number(req.query.limit ?? deps.blocksLimit) || deps.blocksLimit)
    );
    const offsetRaw = req.query.offset;
    const offsetPresent = offsetRaw !== undefined;
    const offset = offsetPresent
      ? Math.max(0, Number(Array.isArray(offsetRaw) ? offsetRaw[0] : offsetRaw) || 0)
      : 0;
    const cursorHeight = parseBlockHeightCursor(req.query.cursor);
    const got = await getBlocksList(limit, cursorHeight);
    if (!got) {
      cacheNoStore(res);
      res.status(503).json({ error: "stale", stale: true });
      return;
    }
    cacheList(res);
    if (offsetPresent || cursorHeight != null) {
      res.json({
        items: got.blocks,
        offset,
        hasMore: got.hasMore,
        nextCursor: got.hasMore ? got.nextCursor : null,
        olderTs: got.olderTs,
        updatedAt: got.meta.updatedAt,
      });
      return;
    }
    res.json(got.blocks);
  });

  app.get("/v1/blocks/:id/sections", async (req, res) => {
    const id = String(req.params.id ?? "").trim();
    const got = await getBlockSections(id);
    cacheNoStore(res);
    if (got == null) {
      res.status(503).json({ error: "stale", stale: true });
      return;
    }
    if (got === "missing") {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(got);
  });

  app.get("/v1/blocks/:id", async (req, res) => {
    const id = String(req.params.id ?? "").trim();
    const limitRaw = req.query.limit;
    const limit =
      limitRaw === undefined
        ? BLOCK_TX_PACK
        : Math.max(
            0,
            Math.min(50, Number(Array.isArray(limitRaw) ? limitRaw[0] : limitRaw) || 0)
          );
    const offsetRaw = req.query.offset;
    const offset = Math.max(
      0,
      Number(Array.isArray(offsetRaw) ? offsetRaw[0] : offsetRaw) || 0
    );
    const got = await getBlockCard(id, limit, offset);
    if (got == null) {
      cacheNoStore(res);
      res.status(503).json({ error: "stale", stale: true });
      return;
    }
    if (got === "missing") {
      cacheNoStore(res);
      res.status(404).json({ error: "not_found" });
      return;
    }
    cacheList(res);
    res.json(got);
  });

  app.get("/v1/transactions/:id", async (req, res) => {
    const id = req.params.id;
    await refreshSpectrumPoolNfts();
    const mem = deps.getRawMempool().get(id);
    if (mem) {
      const ball = deps.getBalls().get(id) ?? txToBall(mem);
      const [hydratedInputs, hydratedOutputs] = await Promise.all([
        hydrateIoFromIndex((mem.inputs ?? []).map(mapIo), "input"),
        hydrateIoFromIndex((mem.outputs ?? []).map(mapIo), "output"),
      ]);
      const inputs = hydratedInputs.items;
      const outputs = hydratedOutputs.items;
      cacheNoStore(res);
      const shaped = shapeFromIo(false, inputs, outputs);
      await stampTemplateHashes([...inputs, ...outputs]);
      const action = pickTxAction({ inputs, outputs }, shaped.shape);
      const tokenMeta = await tokenMetaForIo(inputs, outputs);
      const lock = lockFromIo(inputs, outputs, mem.dataInputs);
      return res.json({
        id,
        confirmed: false,
        inclusionHeight: null,
        numConfirmations: 0,
        size: mem.size ?? ball.size,
        fee: estimateFee(mem),
        category: shaped.category,
        shape: shaped.shape,
        protocol: shaped.protocol,
        action,
        ball: {
          ...ball,
          category: shaped.category,
          platform: lock ?? shaped.protocol ?? ball.platform,
          action: action ?? undefined,
        },
        inputs,
        outputs,
        dataInputs: mem.dataInputs ?? [],
        indexInBlock: null,
        gix: null,
        prevId: null,
        nextId: null,
        valueNano: ioValueSum(outputs),
        inputCount: inputs.length,
        outputCount: outputs.length,
        assetsComplete:
          hydratedInputs.assetsComplete && hydratedOutputs.assetsComplete,
        tokenMeta,
        source: "mempool",
      });
    }

    const tip = deps.getFullHeight() ?? null;
    const idx = await getTxById(id);
    if (!idx) {
      cacheNoStore(res);
      res.status(404).json({ error: "not_found" });
      return;
    }

    const inputs = idx.inputs.map((b, i) => mapIdxIo({ ...b, index: i }, i));
    const outputs = idx.outputs.map((b, i) => mapIdxIo(b, i));
    const raw = rawFromMapped(id, idx.size, inputs, outputs);
    const ball = txToBall(raw);
    const height = idx.inclusionHeight;
    const confs =
      height != null && tip != null && Number.isFinite(tip)
        ? Math.max(0, Number(tip) - height + 1)
        : null;
    const feeNum = idx.fee != null && idx.fee !== "" ? Number(idx.fee) : NaN;
    const shaped = shapeFromIo(idx.indexInBlock === 0, inputs, outputs);
    await stampTemplateHashes([...inputs, ...outputs]);
    const tokenMeta = await tokenMetaForIo(inputs, outputs);
    const lock = lockFromIo(inputs, outputs);
    const rent =
      height != null ? (await rentTapeMarks([id], height, height)).get(id) ?? null : null;
    const category = rent?.category ?? shaped.category;
    const action = rent ? null : pickTxAction({ inputs, outputs }, shaped.shape);
    cacheNoStore(res);
    return res.json({
      id,
      confirmed: true,
      blockId: idx.blockId,
      inclusionHeight: height,
      timestamp: idx.timestamp,
      numConfirmations: confs,
      size: idx.size ?? ball.size,
      fee: Number.isFinite(feeNum) ? feeNum : estimateFee(raw),
      category,
      shape: shaped.shape,
      protocol: shaped.protocol,
      action,
      rent: rent?.category ?? null,
      ball: {
        ...ball,
        category,
        color: rent?.color ?? ball.color,
        platform: lock ?? shaped.protocol ?? ball.platform,
        action: action ?? undefined,
      },
      inputs,
      outputs,
      dataInputs: [],
      indexInBlock: idx.indexInBlock,
      gix: idx.gix,
      prevId: idx.prevId,
      nextId: idx.nextId,
      valueNano: idx.valueNano ?? ioValueSum(outputs),
      inputCount: idx.inputCount ?? inputs.length,
      outputCount: idx.outputCount ?? outputs.length,
      assetsComplete: idx.assetsComplete,
      tokenMeta,
      source: "indexer",
    });
  });

  /**
   * Explorer-compatible: unspent boxes holding a token.
   * GET /v1/boxes/unspent/byTokenId/:tokenId?offset=&limit=
   * Indexer window only. Never the node.
   */
  app.get("/v1/boxes/unspent/byTokenId/:tokenId", async (req, res) => {
    const tokenId = String(req.params.tokenId || "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(tokenId)) {
      return res.status(400).json({ error: "invalid_token_id" });
    }
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));

    const idx = await unspentBoxesByTokenId(tokenId, offset, limit);
    if (!idx) {
      return res.json({
        items: [],
        total: 0,
        offset,
        limit,
        tokenId,
        source: "empty",
        note: "Indexer unavailable.",
      });
    }
    return res.json({
      items: idx.items.map((b) =>
        normalizeBox(
          {
            boxId: b.boxId,
            value: b.value,
            creationHeight: b.creationHeight,
            address: b.address,
            ergoTree: b.ergoTree,
            transactionId: b.creationTxId,
            index: b.index ?? null,
            additionalRegisters: (b.additionalRegisters ?? {}) as Record<string, string>,
            assets: b.assets.map((a) => ({
              tokenId: a.tokenId,
              amount: a.amount,
            })),
          },
          "indexer"
        )
      ),
      total: idx.total,
      offset,
      limit,
      tokenId,
      source: "indexer",
      note: "Unspent boxes holding token (indexed window). Never the node.",
    });
  });

  app.get("/v1/boxes/:id", async (req, res) => {
    const id = req.params.id;
    const tip = deps.getFullHeight() ?? 0;
    const extras = {
      currentHeight: Number(tip) || 0,
      sizeBytes: 0,
      rentParams: DEFAULT_RENT_PARAMS,
    };

    const idx = await getBoxById(id);
    if (idx) {
      extras.sizeBytes = estimateBoxSizeBytes({
        ergoTree: idx.ergoTree ?? "",
        assetsCount: idx.assets.length,
        registerBytes: registerPayloadBytes(idx.additionalRegisters ?? {}),
      });
      const [heads, meta] = await Promise.all([
        getTxHeads([idx.creationTxId ?? "", idx.spentTxId ?? ""]),
        tokenMetaMany(idx.assets.map((a) => a.tokenId)),
      ]);
      const created = idx.creationTxId ? heads.get(idx.creationTxId) : undefined;
      const spent = idx.spentTxId ? heads.get(idx.spentTxId) : undefined;
      if (idx.spentHeight != null) extras.currentHeight = idx.spentHeight;
      const assets = idx.assets.map((a) => {
        const m =
          meta.get(a.tokenId) ??
          meta.get(a.tokenId.toLowerCase()) ??
          null;
        return {
          tokenId: a.tokenId,
          amount: a.amount,
          name: m?.name ?? null,
          decimals: m?.decimals ?? null,
          emission: m?.emission ?? null,
        };
      });
      cacheNoStore(res);
      const card = normalizeBox(
        {
          boxId: idx.boxId,
          value: idx.value,
          ergoTree: idx.ergoTree,
          address: idx.address,
          creationHeight: idx.creationHeight,
          inclusionHeight: created?.height ?? null,
          settlementHeight: created?.height ?? null,
          blockId: created?.blockId ?? null,
          spentHeight: idx.spentHeight,
          createdTs: created?.timestampMs ?? null,
          spentTs: spent?.timestampMs ?? null,
          transactionId: idx.creationTxId,
          spentTransactionId: idx.spentTxId,
          index: idx.index,
          gix: idx.gix,
          additionalRegisters: idx.additionalRegisters ?? {},
          assets,
        },
        "indexer",
        extras
      );
      const decoded = await attachBoxCardDecode(
        idx.ergoTree,
        idx.additionalRegisters ?? {}
      );
      return res.json({ ...card, ...decoded });
    }

    for (const tx of deps.getRawMempool().values()) {
      for (const o of tx.outputs ?? []) {
        if (o.boxId === id) {
          extras.sizeBytes = estimateBoxSizeBytes({
            ergoTree: String(o.ergoTree ?? ""),
            assetsCount: o.assets?.length ?? 0,
            registerBytes: registerPayloadBytes(o.additionalRegisters),
          });
          cacheNoStore(res);
          const card = normalizeBox(
            {
              boxId: o.boxId,
              value: o.value,
              ergoTree: o.ergoTree,
              assets: o.assets,
              additionalRegisters: o.additionalRegisters,
              creationHeight: o.creationHeight,
              inclusionHeight: null,
              settlementHeight: null,
              blockId: null,
              transactionId: o.transactionId ?? tx.id,
              index: o.index,
            },
            "mempool",
            extras
          );
          const decoded = await attachBoxCardDecode(
            String(o.ergoTree ?? ""),
            (o.additionalRegisters as Record<string, unknown>) ?? {}
          );
          return res.json({ ...card, ...decoded });
        }
      }
    }
    cacheNoStore(res);
    res.status(404).json({ error: "not_found" });
  });

  async function addressShowcase(
    address: string,
    query: Record<string, unknown>,
    pricesDefault: boolean
  ) {
    const listsQ = query.lists;
    const wantLists = !(listsQ === "0" || listsQ === "false");
    const txLimit = wantLists
      ? pageLimit(query.txLimit ?? query.limit, 25)
      : 0;
    const boxLimit = wantLists ? pageLimit(query.boxLimit, 25) : 0;
    const pricesQ = query.prices;
    const enrichPrices =
      pricesQ === "0" || pricesQ === "false"
        ? false
        : pricesQ === "1" || pricesQ === "true"
          ? true
          : pricesDefault;
    const tokensQ = query.tokens;
    const wantTokens =
      tokensQ === "0" || tokensQ === "false"
        ? false
        : tokensQ === "1" || tokensQ === "true"
          ? true
          : enrichPrices;
    const activityQ = query.activity;
    const wantActivity = !(activityQ === "0" || activityQ === "false");
    const txCursor = parseKeysetCursor(query.txCursor ?? query.cursor);
    const boxCursor = parseKeysetCursor(query.boxCursor);
    const boxOffset = boxCursor
      ? 0
      : Math.max(0, Math.floor(Number(query.boxOffset ?? 0) || 0));

    const tip = deps.getFullHeight() ?? 0;
    const txsP =
      wantLists && txLimit > 0
        ? addressTransactionsCursor(address, txCursor, txLimit)
        : Promise.resolve({ items: [], hasMore: false, nextCursor: null });
    const boxesP =
      wantLists && boxLimit > 0
        ? addressUnspentBoxesCursor(address, boxCursor, boxLimit, boxOffset)
        : Promise.resolve({ items: [], hasMore: false, nextCursor: null });
    const summaryP = getAddressSummary(address);
    const nameP = addressName(address);
    const tokensP =
      wantLists && wantTokens
        ? addressTokensConfirmed(address)
        : Promise.resolve([] as Awaited<ReturnType<typeof addressTokensConfirmed>>);
    const stP = indexerStatus(tip);

    const idxTxs = await txsP;
    const pageTxIds =
      wantLists && wantActivity && idxTxs != null ? idxTxs.items.map((row) => row.id) : [];
    const activityP: Promise<Record<string, AddrTxActivity>> =
      pageTxIds.length > 0
        ? addressTxActivity(address, pageTxIds)
        : Promise.resolve({});
    const partiesP: Promise<Record<string, { from: string[]; to: string[] }>> =
      pageTxIds.length > 0 ? addressTxParties(address, pageTxIds) : Promise.resolve({});
    const [summary, idxBoxes, tokenBals, idxSt, activity, parties] = await Promise.all([
      summaryP,
      boxesP,
      tokensP,
      stP,
      activityP,
      partiesP,
    ]);
    if (wantLists && txLimit > 0 && !idxTxs) {
      return { status: 503 as const, body: { error: "stale", stale: true } };
    }
    const boxesTimedOut = boxLimit > 0 && !idxBoxes;
    const txPage = idxTxs ?? { items: [], hasMore: false, nextCursor: null };
    const boxPage = idxBoxes ?? { items: [], hasMore: false, nextCursor: null };

    const unspentList = boxPage.items.map((b) =>
      normalizeBox(
        {
          boxId: b.boxId,
          value: b.value,
          creationHeight: b.creationHeight,
          address: b.address,
          ergoTree: b.ergoTree,
          transactionId: b.creationTxId,
          index: b.index,
          assets: b.assets.map((a) => ({
            tokenId: a.tokenId,
            amount: a.amount,
          })),
        },
        "indexer"
      )
    );

    const recentTxs = txPage.items.map((row) => ({
      id: row.id,
      inclusionHeight: row.inclusionHeight,
      timestamp: row.timestamp,
      numConfirmations:
        row.inclusionHeight != null && tip
          ? Math.max(0, tip - row.inclusionHeight)
          : null,
      size: row.size,
      fee: row.fee,
    }));

    // lists=0 refreshes the header without the confirmed tape. Mempool still
    // belongs on that refresh — the page replaces mempoolTxs from this body.
    const mempoolPack = await mempoolTxsForAddress(
      address,
      deps.getRawMempool(),
      deps.getBalls(),
      new Set(recentTxs.map((t) => t.id))
    );

    const tokens = (wantLists && wantTokens ? (tokenBals ?? []) : []).map((row) => ({
      tokenId: row.tokenId,
      amount: amountStr(row.amount),
      firstHeight: row.firstHeight,
      lastHeight: row.lastHeight,
      name: KNOWN_TOKENS[row.tokenId]?.name ?? null,
    }));
    const activityTokenIds = [
      ...new Set(
        [
          ...Object.values(activity).flatMap((f) => f.tokens.map((t) => t.tokenId)),
          ...Object.values(mempoolPack.activity).flatMap((f) =>
            f.tokens.map((t) => t.tokenId)
          ),
        ]
      ),
    ];
    const metaMap = await tokenMetaMany([
      ...tokens.map((tok) => tok.tokenId),
      ...activityTokenIds,
    ]);
    for (const tok of tokens) {
      tok.name = metaMap.get(tok.tokenId)?.name ?? tok.name;
    }

    const activityOut: Record<
      string,
      {
        kind: AddrFlowKind;
        erg: string;
        tokens: {
          tokenId: string;
          amount: string;
          name: string | null;
          decimals: number;
        }[];
        from: string[];
        to: string[];
      }
    > = {};
    for (const [tid, flow] of Object.entries({ ...activity, ...mempoolPack.activity })) {
      const side = parties[tid];
      // Confirmed tape: one counterparty, or two so the column can say "many".
      // Intra is this address alone — a refreshed script is not a party.
      // Mempool rows already carry from/to.
      const decided = flow.from != null || flow.to != null;
      const from = decided
        ? (flow.from ?? [])
        : flow.kind === "sent" || flow.kind === "intra"
          ? [address]
          : (side?.from ?? []);
      const to = decided
        ? (flow.to ?? [])
        : flow.kind === "received" || flow.kind === "intra"
          ? [address]
          : (side?.to ?? []);
      activityOut[tid] = {
        kind: flow.kind,
        erg: amountStr(flow.erg),
        from,
        to,
        tokens: flow.tokens.map((tok) => {
          const meta = metaMap.get(tok.tokenId);
          return {
            tokenId: tok.tokenId,
            amount: amountStr(tok.amount),
            name: meta?.name ?? KNOWN_TOKENS[tok.tokenId]?.name ?? null,
            decimals:
              meta?.decimals != null && Number.isFinite(meta.decimals)
                ? meta.decimals
                : 0,
          };
        }),
      };
    }

    const confirmedNanoErg = amountStr(summary?.nanoerg ?? "0");
    const unconfirmedNanoErg = activityNanoSum(mempoolPack.activity);
    const name = await nameP;

    return {
      status: 200 as const,
      body: {
        address,
        name,
        balance: {
          confirmedNanoErg,
          unconfirmedNanoErg,
          tokens,
        },
        unspentBoxes: unspentList,
        recentTxs,
        mempoolTxs: mempoolPack.txs,
        tokenCount: summary?.tokenCount ?? tokens.length,
        firstTs: summary?.firstTs ?? null,
        lastTs: laterTs(
          summary?.lastTs,
          ...recentTxs.map((t) => t.timestamp),
          ...mempoolPack.txs.map((t) => t.timestamp)
        ),
        activity: activityOut,
        pagination: {
          txs: {
            offset: 0,
            limit: txLimit,
            total: summary?.txCount ?? 0,
            hasMore: txPage.hasMore,
            nextCursor: txPage.hasMore ? txPage.nextCursor : null,
          },
          boxes: {
            offset: boxOffset,
            limit: boxLimit,
            returned: unspentList.length,
            total: summary?.boxCount ?? unspentList.length,
            hasMore: boxPage.hasMore,
            nextCursor: boxPage.hasMore ? boxPage.nextCursor : null,
          },
        },
        sources: {
          balance: summary ? "summary" : "pending",
          boxes: boxLimit > 0 ? (boxesTimedOut ? "stale" : "indexer") : "deferred",
          txs: txLimit > 0 ? "indexer" : "deferred",
          activity: wantLists && wantActivity ? "indexer" : "deferred",
          tokens: wantTokens ? "indexer" : "deferred",
          indexer: publicIndexerStatus(idxSt),
        },
      },
    };
  }

  app.get("/v1/addresses/:id", async (req, res) => {
    const address = req.params.id;
    try {
      const out = await addressShowcase(
        address,
        req.query as Record<string, unknown>,
        true
      );
      cacheNoStore(res);
      res.status(out.status).json(out.body);
    } catch (e) {
      cacheNoStore(res);
      res.status(404).json({ error: "not_found", detail: String(e) });
    }
  });

  app.get("/v1/indexer/status", async (_req, res) => {
    const snap = await getStatusSnapshot();
    if (snap) {
      cacheTip(res);
      res.json(publicIndexerStatus(snap));
      return;
    }
    const st = await indexerStatus(null);
    if (!st.enabled || (st.lastHeight == null && !st.ok)) {
      cacheNoStore(res);
      res.status(503).json({ error: "stale", stale: true, ...publicIndexerStatus(st), ts: Date.now() });
      return;
    }
    cacheTip(res);
    res.json({
      ...publicIndexerStatus(st),
      ok: st.ok,
      tipHeight: st.tipHeight ?? st.tipSeen ?? null,
      ts: Date.now(),
      source: "indexer_state",
    });
  });

  /** Additive SSR composite. Frozen `/v1` paths unchanged. Mempool count is live RAM, not persisted. */
  app.get("/v1/page/home", async (_req, res) => {
    const home = await getHomePage();
    if (!home) {
      cacheNoStore(res);
      res.status(503).json({ error: "stale", stale: true });
      return;
    }
    cacheList(res);
    res.json({
      ...home,
      mempool: { count: deps.getBalls().size },
    });
  });

  app.get("/v1/page/addresses", async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const offset = Math.max(0, Math.floor(Number(req.query.offset ?? 0) || 0));
    const p2pkOnly =
      req.query.p2pk === "1" ||
      req.query.p2pkOnly === "1" ||
      req.query.p2pk === "true";
    const sort = parseAddressSort(req.query.sort);
    const dir = parseAddressSortDir(req.query.dir);
    const { bands, kinds } = normalizeAddressFilter(
      parseAddressBandList(req.query.band),
      parseAddressKindList(req.query.kind)
    );
    const page = await getAddressesPage({ limit, offset, p2pkOnly, sort, dir, bands, kinds });
    if (!page) {
      cacheNoStore(res);
      res.status(503).json({ error: "stale", stale: true });
      return;
    }
    const bandsSnap = await getHolderBands();
    const total = holderFilterTotal(bandsSnap, bands, kinds);
    cacheList(res);
    res.json({
      items: page.items,
      source: page.source,
      height: page.meta.height,
      updatedAt: page.meta.updatedAt,
      ts: Date.now(),
      offset,
      limit,
      sort,
      dir,
      band: joinAddressFilter(bands),
      kind: joinAddressFilter(kinds),
      ...(total != null ? { total } : {}),
      ...(bandsSnap ? { bands: bandsSnap } : {}),
    });
  });



  app.get("/v1/page/address/:id", async (req, res) => {
    const address = req.params.id;
    try {
      const out = await addressShowcase(
        address,
        {
          ...(req.query as Record<string, unknown>),
          prices: req.query.prices ?? "0",
          lists: req.query.lists ?? "0",
        },
        false
      );
      cacheNoStore(res);
      res.status(out.status).json(out.body);
    } catch (e) {
      cacheNoStore(res);
      res.status(503).json({ error: "stale", stale: true, detail: String(e) });
    }
  });

  app.get("/v1/rent/health", async (_req, res) => {
    const health = await rentWriterHealth();
    if (!health) {
      cacheNoStore(res);
      res.status(503).json({ ok: false, ready: false, source: "lumen-rent" });
      return;
    }
    cacheList(res);
    res.json(health);
  });

  app.get("/v1/page/rent", async (req, res) => {
    const tab = String(req.query.tab ?? "oldest");
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    const claimOffset = Math.max(0, Number(req.query.claimOffset ?? 0) || 0);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 25) || 25));
    const page = await getRentPage({ tab, offset, limit, claimOffset });
    if (!page) {
      cacheNoStore(res);
      res.status(503).json({ error: "stale", stale: true });
      return;
    }
    cacheList(res);
    res.json(page);
  });


  // ── Network peer snapshot (Home Earth) ──

  /** Additive: crawl live + connected snapshot for Home Earth. File + RAM, not per-GET node. */
  app.get("/v1/network/orbit", (_req, res) => {
    const snap = deps.getOrbit();
    if (!snap.updatedAt) {
      cacheNoStore(res);
      res.status(503).json({ error: "stale", stale: true, peers: [], regions: [] });
      return;
    }
    cacheTokens(res);
    res.json({
      updatedAt: snap.updatedAt,
      peers: snap.peers,
      regions: snap.regions,
    });
  });

  app.get("/v1/networkState", async (_req, res) => {
    const tip = deps.getFullHeight() ?? null;
    const snap = await peekChainTip();
    const raw = deps.getNodeInfoRaw?.() ?? {};
    const gix = await readGixWatermark();
    res.json({
      height: tip ?? snap?.height ?? null,
      lastBlockId: snap?.headerId ?? null,
      network: "mainnet",
      maxBoxGix: gix.maxBoxGix,
      maxTxGix: gix.maxTxGix,
      params: mapEpochParams((raw.parameters as Record<string, unknown>) ?? null),
      source: "index",
    });
  });

  app.get("/v1/addresses/:address/rent-due", async (req, res) => {
    cacheList(res);
    const blocksUntilRent = await addressRentBlocks(req.params.address);
    res.json({ blocksUntilRent, source: "index" });
  });

  app.get("/v1/addresses/:address/balance/confirmed", async (req, res) => {
    cacheNoStore(res);
    const address = req.params.address;
    const bal = await addressBalanceConfirmed(address);
    if (bal) {
      const metaMap = await tokenMetaMany(bal.tokens.slice(0, 80).map((x) => x.tokenId));
      const tokens = bal.tokens.slice(0, 80).map((tok) => {
        const meta = metaMap.get(tok.tokenId);
        return {
          tokenId: tok.tokenId,
          amount: amountStr(tok.amount),
          decimals:
            meta?.decimals != null && Number.isFinite(meta.decimals)
              ? meta.decimals
              : 0,
          emission: meta?.emission ?? null,
          name: meta?.name ?? KNOWN_TOKENS[tok.tokenId]?.name ?? null,
        };
      });
      res.json({
        nanoErgs: amountStr(bal.nanoErgs),
        tokens,
        source: "indexer",
        truncated: bal.tokens.length > 80,
      });
      return;
    }
    res.status(503).json({ error: "stale", stale: true });
  });

  app.get("/v1/addresses/:address/tokens", async (req, res) => {
    cacheNoStore(res);
    const address = req.params.address;
    const tape = await addressTokenTape(address);
    if (tape == null) {
      res.status(503).json({ error: "stale", stale: true });
      return;
    }
    const ready = await readyPreviewCids(tape.items.map((tok) => tok.artworkUrl));
    const tokens = tape.items.map((tok) => ({
      ...tok,
      name: tok.name ?? KNOWN_TOKENS[tok.tokenId]?.name ?? null,
      artworkUrl: previewArtworkUrl(tok.artworkUrl, ready),
    }));
    res.json({
      address,
      tokens,
      source: "indexer",
      truncated: tape.truncated,
    });
  });

  app.get("/v1/addresses/:address/nfts", async (req, res) => {
    cacheNoStore(res);
    const address = req.params.address;
    const limit = Math.min(48, Math.max(1, Number(req.query.limit ?? 24) || 24));
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    const page = await addressNftsFromIndex(address, limit, offset);
    if (!page) {
      res.status(503).json({ error: "stale", stale: true, items: [], total: 0 });
      return;
    }
    const ready = await readyPreviewCids(
      page.items.flatMap((it) => [it.artworkUrl, it.mediaUrl])
    );
    const items = page.items.map((it) => ({
      ...it,
      artworkUrl: previewArtworkUrl(it.artworkUrl, ready),
      mediaUrl: previewArtworkUrl(it.mediaUrl, ready),
    }));
    res.json({
      address,
      items,
      total: page.total,
      offset,
      limit,
      hasMore: offset + items.length < page.total,
      source: "indexer",
    });
  });

  app.get("/v1/addresses/:address/boxes/unspent", async (req, res) => {
    cacheNoStore(res);
    const address = req.params.address;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const cursor = parseKeysetCursor(req.query.cursor);
    const summary = await getAddressSummary(address);
    const idx = await addressUnspentBoxesCursor(address, cursor, limit);
    if (!idx) {
      res.status(503).json({ error: "stale", stale: true });
      return;
    }
    res.json({
      items: idx.items.map((b) =>
        normalizeBox(
          {
            boxId: b.boxId,
            value: b.value,
            creationHeight: b.creationHeight,
            address: b.address,
            ergoTree: b.ergoTree,
            transactionId: b.creationTxId,
            index: b.index,
            assets: b.assets.map((a) => ({
              tokenId: a.tokenId,
              amount: a.amount,
            })),
          },
          "indexer"
        )
      ),
      total: summary?.boxCount ?? idx.items.length,
      offset: 0,
      limit,
      hasMore: idx.hasMore,
      nextCursor: idx.hasMore ? idx.nextCursor : null,
      source: "indexer",
    });
  });

  app.get("/v1/addresses/:address/transactions", async (req, res) => {
    cacheNoStore(res);
    const address = req.params.address;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));
    const cursor = parseKeysetCursor(req.query.cursor);
    const tip = deps.getFullHeight() ?? null;
    const summary = await getAddressSummary(address);
    const idx = await addressTransactionsCursor(address, cursor, limit);
    if (!idx) {
      res.status(503).json({ error: "stale", stale: true });
      return;
    }
    const items = idx.items.map((row) => ({
      id: row.id,
      transactionId: row.id,
      inclusionHeight: row.inclusionHeight,
      timestamp: row.timestamp,
      numConfirmations:
        row.inclusionHeight != null && tip != null
          ? Math.max(0, tip - row.inclusionHeight)
          : null,
      size: row.size,
      fee: row.fee,
    }));
    res.setHeader("x-orbit-history-truncated", "true");
    res.json({
      items,
      total: summary?.txCount ?? 0,
      offset: 0,
      limit,
      hasMore: idx.hasMore,
      nextCursor: idx.hasMore ? idx.nextCursor : null,
      source: "indexer",
      truncated: true,
    });
  });

}
