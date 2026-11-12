/**
 * Official explorer v1 path aliases.
 * Read index + mempool RAM. Submit-tx is the only user POST to the node.
 */
import type { Express, Request, Response } from "express";
import type { RawTx } from "@ergoscan/shared";
import { apiContractHtml } from "../lib/api-contract.js";
import { cacheList, cacheNoStore, cacheTip } from "../lib/httpCache.js";
import {
  addressBalanceConfirmed,
  addressBoxesCursor,
  addressUnspentBoxesCursor,
  ergoTreeForAddress,
  getAddressSummary,
  getBoxById,
  getTxById,
  getTxHeads,
  parseKeysetCursor,
  tokenMetaMany,
  tokensBySymbol,
  tokensSearchLite,
  listTokensCatalog,
  transactionsByGix,
  boxesByErgoTree,
  boxesByErgoTreeTemplate,
  unspentBoxesByGix,
  unspentBoxesByLastEpochs,
  type GixStreamBox,
  type IdxBoxRow,
} from "../lib/indexDb.js";
import { parseTemplateOnlySearch } from "../lib/boxSearch.js";
import { parseGixWindow } from "../lib/gix.js";
import { ergoTreeFromAddress, normErgoTree } from "../lib/ergoAddress.js";
import { logSubmitFail, publicSubmitFail, requestIp, takeSubmitSlot, validateSignedTx } from "../lib/submit-tx.js";
import { getBlocksList, getHomePage } from "../lib/snapshots.js";
import {
  itemsPage,
  mapBlockHeader,
  mapEpochParams,
  mapExplorerBox,
  mapExplorerTx,
  mapTokenInfo,
  mempoolBalanceDelta,
  mempoolUnspentForAddress,
  notImplemented,
  resolveDecimals,
  sumBalances,
  type ExplorerBalance,
} from "../lib/explorerCompat.js";

export type CompatDeps = {
  getRawMempool: () => Map<string, RawTx>;
  getNodeInfoRaw: () => Record<string, unknown>;
  submitTx: (body: unknown) => Promise<unknown>;
  /** Public API host. Box and tx by id use the explorer document, not the site card. */
  apiContour?: boolean;
};

function qInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(Array.isArray(v) ? v[0] : v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function qStr(v: unknown): string {
  return String(Array.isArray(v) ? v[0] : v ?? "").trim();
}

function boxJson(b: {
  boxId: string;
  value: string;
  creationHeight: number | null;
  address: string | null;
  ergoTree: string | null;
  creationTxId: string | null;
  index: number | null;
  gix?: number | null;
  blockId?: string | null;
  additionalRegisters?: Record<string, unknown> | null;
  assets: { tokenId: string; amount: string }[];
  spentTxId?: string | null;
}) {
  const mapped = mapExplorerBox({
    boxId: b.boxId,
    value: b.value,
    creationHeight: b.creationHeight,
    address: b.address,
    ergoTree: b.ergoTree,
    transactionId: b.creationTxId,
    index: b.index,
    gix: b.gix ?? null,
    blockId: b.blockId ?? null,
    additionalRegisters: b.additionalRegisters ?? undefined,
    assets: b.assets,
    spentTransactionId: b.spentTxId ?? null,
  });
  return b.gix != null ? { ...mapped, gix: b.gix } : mapped;
}

function templateHashParam(raw: string): string | null {
  const hash = raw.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  return hash;
}

async function sendBoxesByTemplate(
  req: Request,
  res: Response,
  unspentOnly: boolean
): Promise<void> {
  cacheList(res);
  const hash = templateHashParam(String(req.params.hash ?? ""));
  if (!hash) {
    res.status(400).json({ error: "bad_request", reason: "template hash must be 64 hex chars" });
    return;
  }
  const limit = qInt(req.query.limit, 20, 1, 100);
  const offset = qInt(req.query.offset, 0, 0, 500);
  const page = await boxesByErgoTreeTemplate(hash, offset, limit, unspentOnly);
  if (!page) {
    res.status(504).json({ error: "timeout", reason: "template hash query exceeded 4s" });
    return;
  }
  res.json({
    items: page.items.map(boxJson),
    offset,
    limit,
    hasMore: page.hasMore,
    source: "index",
  });
}

async function sendTemplateSearch(req: Request, res: Response, unspentOnly: boolean): Promise<void> {
  const parsed = parseTemplateOnlySearch(req.body);
  if (!parsed.ok) {
    if (parsed.status === 501) {
      res.status(501).json(notImplemented(req.path));
      return;
    }
    res.status(400).json({ error: parsed.error, reason: parsed.reason });
    return;
  }
  cacheList(res);
  const limit = qInt(req.query.limit, 20, 1, 100);
  const offset = qInt(req.query.offset, 0, 0, 500);
  const page = await boxesByErgoTreeTemplate(parsed.hash, offset, limit, unspentOnly);
  if (!page) {
    res.status(504).json({ error: "timeout", reason: "template hash query exceeded 4s" });
    return;
  }
  res.json({
    items: page.items.map(boxJson),
    offset,
    limit,
    hasMore: page.hasMore,
    source: "index",
  });
}

function ergoTreeParam(raw: string): string | null {
  const tree = raw.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(tree) || tree.length < 4 || tree.length > 8000 || tree.length % 2 !== 0) {
    return null;
  }
  return tree;
}

async function sendBoxesByTree(
  req: Request,
  res: Response,
  unspentOnly: boolean
): Promise<void> {
  cacheList(res);
  const tree = ergoTreeParam(String(req.params.tree ?? ""));
  if (!tree) {
    res.status(400).json({ error: "bad_request", reason: "ergo tree must be even-length hex" });
    return;
  }
  const limit = qInt(req.query.limit, 20, 1, 100);
  const offset = qInt(req.query.offset, 0, 0, 500);
  const page = await boxesByErgoTree(tree, offset, limit, unspentOnly);
  if (!page) {
    res.status(504).json({ error: "timeout", reason: "ergo tree query exceeded 4s" });
    return;
  }
  res.json({
    items: page.items.map(boxJson),
    offset,
    limit,
    hasMore: page.hasMore,
    source: "index",
  });
}

function streamBoxJson(b: GixStreamBox) {
  return {
    ...mapExplorerBox({
      boxId: b.boxId,
      value: b.value,
      creationHeight: b.creationHeight,
      address: b.address,
      ergoTree: b.ergoTree,
      transactionId: b.creationTxId,
      index: b.index,
      gix: b.gix,
      blockId: b.blockId,
      additionalRegisters: b.additionalRegisters ?? undefined,
      assets: b.assets,
      spentTransactionId: b.spentTxId,
    }),
    gix: b.gix,
  };
}

export function registerCompatRoutes(app: Express, deps: CompatDeps): void {
  app.get("/v1/boxes/unspent/unconfirmed/byAddress/:address", async (req, res) => {
    cacheNoStore(res);
    const address = req.params.address;
    const limit = qInt(req.query.limit, 50, 1, 100);
    const offset = qInt(req.query.offset, 0, 0, 400);
    const tree = await addressTree(address);
    const all = mempoolUnspentForAddress(address, deps.getRawMempool().values(), tree);
    const items = all.slice(offset, offset + limit);
    res.json({
      ...itemsPage(items, all.length, offset, limit),
      source: "mempool-ram",
    });
  });

  app.get("/v1/boxes/unspent/byAddress/:address", async (req, res) => {
    cacheNoStore(res);
    const address = req.params.address;
    const limit = qInt(req.query.limit, 50, 1, 100);
    const offset = qInt(req.query.offset, 0, 0, 500);
    const cursor = parseKeysetCursor(req.query.cursor);
    const [summary, idx] = await Promise.all([
      getAddressSummary(address),
      addressUnspentBoxesCursor(address, cursor, limit, offset),
    ]);
    if (!idx) {
      res.status(503).json({ error: "stale", stale: true });
      return;
    }
    res.json({
      ...itemsPage(
        idx.items.map((b) => boxJson(b)),
        summary?.boxCount ?? idx.items.length,
        offset,
        limit
      ),
      hasMore: idx.hasMore,
      nextCursor: idx.hasMore ? idx.nextCursor : null,
      source: "indexer",
    });
  });

  app.get("/v1/boxes/byAddress/:address", async (req, res) => {
    cacheNoStore(res);
    const address = req.params.address;
    const limit = qInt(req.query.limit, 50, 1, 100);
    const offset = qInt(req.query.offset, 0, 0, 500);
    const cursor = parseKeysetCursor(req.query.cursor);
    const idx = await addressBoxesCursor(address, cursor, limit, offset);
    if (!idx) {
      res.status(503).json({ error: "stale", stale: true });
      return;
    }
    res.json({
      ...itemsPage(
        idx.items.map((b) => boxJson(b)),
        idx.items.length,
        offset,
        limit
      ),
      hasMore: idx.hasMore,
      nextCursor: idx.hasMore ? idx.nextCursor : null,
      source: "indexer",
      note: "total is this page size — no COUNT(boxes). Use nextCursor.",
    });
  });

  app.get("/v1/addresses/:address/balance/total", async (req, res) => {
    cacheNoStore(res);
    const address = req.params.address;
    const got = await confirmedBalance(address);
    if (!got) {
      res.status(503).json({ error: "stale", stale: true });
      return;
    }
    const confirmed = got.balance;
    const tree = await addressTree(address);
    const pending = mempoolBalanceDelta(address, deps.getRawMempool().values(), tree);
    const total = sumBalances(confirmed, pending);
    res.json({
      confirmed,
      unconfirmed: pending,
      total,
      source: "indexer+mempool",
      truncated: got.truncated,
    });
  });

  app.get("/v1/assets", async (req, res) => {
    cacheList(res);
    const limit = qInt(req.query.limit, 25, 1, 50);
    const offset = qInt(req.query.offset, 0, 0, 500);
    const hideNfts = req.query.hideNfts === "true" || req.query.hideNfts === "1";
    const page = await listTokensCatalog({
      limit,
      offset,
      sort: "holders",
      dir: "desc",
      q: "",
    });
    if (!page) {
      cacheNoStore(res);
      res.status(503).json({ error: "stale", stale: true });
      return;
    }
    const rows = hideNfts ? page.items.filter((it) => it.emission !== "1") : page.items;
    res.json({
      ...itemsPage(
        rows.map((it) =>
          mapTokenInfo({
            tokenId: it.tokenId,
            boxId: null,
            emission: it.emission,
            name: it.name,
            decimals: it.decimals,
          })
        ),
        page.total,
        offset,
        limit
      ),
      source: "indexer",
    });
  });

  app.get("/v1/assets/search/byTokenId", async (req, res) => {
    cacheList(res);
    const query = qStr(req.query.query);
    if (query.length < 5) {
      res.status(400).json({ error: "bad_request", reason: "query minLength 5" });
      return;
    }
    const rows = await tokensSearchLite(query, qInt(req.query.limit, 24, 1, 100));
    if (!rows) {
      cacheNoStore(res);
      res.status(503).json({ error: "stale", stale: true });
      return;
    }
    res.json({
      ...itemsPage(rows.map(mapTokenInfo), rows.length, 0, rows.length),
      source: "indexer",
    });
  });

  app.get("/v1/tokens/bySymbol/:symbol", async (req, res) => {
    cacheList(res);
    // Express already decoded the path segment; a second decode threw on "%".
    const symbol = req.params.symbol ?? "";
    const rows = await tokensBySymbol(symbol, qInt(req.query.limit, 50, 1, 100));
    if (!rows) {
      cacheNoStore(res);
      res.status(503).json({ error: "stale", stale: true });
      return;
    }
    res.json(rows.map(mapTokenInfo));
  });

  app.get("/v1/epochs/params", (_req, res) => {
    cacheTip(res);
    const raw = deps.getNodeInfoRaw();
    const params = mapEpochParams((raw.parameters as Record<string, unknown>) ?? null);
    if (!params) {
      res.status(503).json({ error: "stale", stale: true });
      return;
    }
    res.json({ ...params, source: "node-info-ram" });
  });

  app.get("/v1/blocks/headers", async (req, res) => {
    cacheList(res);
    const limit = qInt(req.query.limit, 25, 1, 50);
    const cursorHeight = (() => {
      const c = qStr(req.query.cursor);
      if (/^\d+$/.test(c)) return Number(c);
      return null;
    })();
    const got = await getBlocksList(limit, cursorHeight);
    if (!got) {
      cacheNoStore(res);
      res.status(503).json({ error: "stale", stale: true });
      return;
    }
    const items = got.blocks.map((b) =>
      mapBlockHeader({
        id: b.id,
        parentId: b.parentId,
        height: b.height,
        timestamp: b.timestamp,
        size: b.size,
      })
    );
    res.json({
      ...itemsPage(items, items.length, 0, limit),
      hasMore: got.hasMore,
      nextCursor: got.hasMore ? got.nextCursor : null,
      source: got.source,
    });
  });

  app.get("/v1/networkStats", async (_req, res) => {
    cacheList(res);
    const home = await getHomePage();
    if (!home) {
      cacheNoStore(res);
      res.status(503).json({ error: "stale", stale: true });
      return;
    }
    res.json({
      uniqueAddressesNum: home.holderCount ?? 0,
      hashRate: home.hashRate ?? null,
      transactionAverage: home.txPerDay ?? null,
      txTotal: home.txTotal ?? null,
      height: home.height ?? null,
      source: "snapshot",
    });
  });

  app.get("/v1/mempool/transactions/byAddress/:address", (req, res) => {
    cacheNoStore(res);
    const address = req.params.address;
    const limit = qInt(req.query.limit, 50, 1, 100);
    const offset = qInt(req.query.offset, 0, 0, 400);
    const hits: RawTx[] = [];
    for (const tx of deps.getRawMempool().values()) {
      const blob = JSON.stringify(tx);
      if (blob.includes(address)) hits.push(tx);
    }
    const items = hits.slice(offset, offset + limit);
    res.json({
      ...itemsPage(items, hits.length, offset, limit),
      source: "mempool-ram",
    });
  });

  app.get("/v1/mempool/boxes/unspent", (_req, res) => {
    cacheNoStore(res);
    const items: ReturnType<typeof mapExplorerBox>[] = [];
    for (const tx of deps.getRawMempool().values()) {
      for (const [i, box] of (tx.outputs ?? []).entries()) {
        const boxId = (box as { boxId?: string }).boxId;
        if (!boxId) continue;
        items.push(
          mapExplorerBox({
            boxId,
            value: (box as { value?: unknown }).value,
            creationHeight: (box as { creationHeight?: number }).creationHeight ?? null,
            address: (box as { address?: string }).address ?? null,
            ergoTree: (box as { ergoTree?: string }).ergoTree ?? null,
            transactionId: tx.id,
            index: i,
            assets: ((box as { assets?: { tokenId?: string; amount?: unknown }[] }).assets ?? [])
              .filter((a) => a.tokenId)
              .map((a) => ({ tokenId: a.tokenId as string, amount: a.amount })),
          })
        );
      }
    }
    res.json(items);
  });

  app.post("/v1/mempool/transactions/submit", async (req: Request, res: Response) => {
    cacheNoStore(res);
    const slot = takeSubmitSlot(requestIp(req));
    if (!slot.ok) {
      res.status(429).json({
        error: "rate_limited",
        reason: slot.reason,
        retryAfterSec: slot.retryAfterSec,
      });
      return;
    }
    try {
      const body = req.body;
      const shape = validateSignedTx(body);
      if (!shape.ok) {
        res.status(400).json({ error: "bad_request", reason: shape.reason });
        return;
      }
      try {
        const id = await deps.submitTx(body);
        const txId = typeof id === "string" ? id : String((id as { id?: string })?.id ?? id);
        res.json({ id: txId.replace(/^"|"$/g, "") });
      } catch (e) {
        logSubmitFail(e);
        const fail = publicSubmitFail(e);
        res.status(fail.status).json({ error: fail.error });
      }
    } finally {
      slot.release();
    }
  });

  app.get("/v1/boxes/byErgoTree/:tree", async (req, res) => {
    await sendBoxesByTree(req, res, false);
  });

  app.get("/v1/boxes/unspent/byErgoTree/:tree", async (req, res) => {
    await sendBoxesByTree(req, res, true);
  });

  app.get("/v1/boxes/byErgoTreeTemplateHash/:hash", async (req, res) => {
    await sendBoxesByTemplate(req, res, false);
  });

  app.get("/v1/boxes/unspent/byErgoTreeTemplateHash/:hash", async (req, res) => {
    await sendBoxesByTemplate(req, res, true);
  });

  app.get("/v1/boxes/unspent/byLastEpochs/stream", async (req, res) => {
    cacheNoStore(res);
    const epochs = qInt(req.query.epochs, 1, 1, 4);
    const limit = qInt(req.query.limit, 50, 1, 100);
    const items = await unspentBoxesByLastEpochs(epochs, limit);
    if (!items) {
      res.status(504).json({ error: "timeout", reason: "epoch stream query exceeded 4s" });
      return;
    }
    res.json(items.map(boxJson));
  });

  app.get("/v1/boxes/unspent/byGlobalIndex/stream", async (req, res) => {
    cacheNoStore(res);
    const win = parseGixWindow(req.query.minGix, req.query.maxGix);
    if (!win.ok) {
      res.status(400).json({ error: win.error, reason: win.reason });
      return;
    }
    const items = await unspentBoxesByGix(win.min, win.max);
    if (!items) {
      res.status(504).json({ error: "timeout", reason: "gix stream query exceeded 4s" });
      return;
    }
    res.json(items.map(streamBoxJson));
  });

  app.get("/v1/transactions/byGlobalIndex/stream", async (req, res) => {
    cacheNoStore(res);
    const win = parseGixWindow(req.query.minGix, req.query.maxGix);
    if (!win.ok) {
      res.status(400).json({ error: win.error, reason: win.reason });
      return;
    }
    const items = await transactionsByGix(win.min, win.max);
    if (!items) {
      res.status(504).json({ error: "timeout", reason: "gix stream query exceeded 4s" });
      return;
    }
    res.json(
      items.map((t) => ({
        ...mapExplorerTx({
          id: t.id,
          blockId: t.blockId,
          inclusionHeight: t.inclusionHeight,
          timestamp: t.timestamp,
          index: t.indexInBlock,
          gix: t.gix,
          size: t.size,
          inputs: t.inputs.map((b) => ({
            boxId: b.boxId,
            value: b.value,
            creationHeight: b.creationHeight,
            address: b.address,
            ergoTree: b.ergoTree,
            transactionId: b.creationTxId,
            index: b.index,
            gix: b.gix,
            blockId: b.blockId,
            additionalRegisters: b.additionalRegisters ?? undefined,
            assets: b.assets,
            spentTransactionId: b.spentTxId,
          })),
          outputs: t.outputs.map((b) => ({
            boxId: b.boxId,
            value: b.value,
            creationHeight: b.creationHeight,
            address: b.address,
            ergoTree: b.ergoTree,
            transactionId: b.creationTxId,
            index: b.index,
            gix: b.gix,
            blockId: b.blockId,
            additionalRegisters: b.additionalRegisters ?? undefined,
            assets: b.assets,
            spentTransactionId: b.spentTxId,
          })),
        }),
        gix: t.gix,
      }))
    );
  });

  // Template hash only. Register, constant, and token predicates stay 501.
  app.post("/v1/boxes/search", (req, res) => void sendTemplateSearch(req, res, false));
  app.post("/v1/boxes/unspent/search", (req, res) => void sendTemplateSearch(req, res, true));
  app.post("/v1/boxes/unspent/search/union", (req, res) => void sendTemplateSearch(req, res, true));

  // Unbounded dumps stay 501 so one client cannot scan the chain.
  for (const path of [
    "/v1/boxes/unspent/stream",
    "/v1/blocks/byGlobalIndex/stream",
  ]) {
    app.get(path, (_req, res) => {
      res.status(501).json(notImplemented(path));
    });
  }

  if (deps.apiContour) {
    app.get(["/", "/docs", "/docs/", "/v1/docs", "/v1/docs/"], (_req, res) => {
      res.setHeader("Cache-Control", "public, max-age=60");
      res.type("html").send(apiContractHtml());
    });

    app.get("/v1/boxes/:id", async (req, res, next) => {
      const id = String(req.params.id ?? "").trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(id)) {
        next();
        return;
      }
      const idx = await getBoxById(id);
      if (!idx) {
        cacheNoStore(res);
        res.status(404).json({ error: "not_found" });
        return;
      }
      const head = idx.creationTxId ? (await getTxHeads([idx.creationTxId])).get(idx.creationTxId) : undefined;
      cacheNoStore(res);
      res.json(mapExplorerBox(indexedBox(idx, head?.blockId ?? null)));
    });

    app.get("/v1/transactions/:id", async (req, res, next) => {
      const id = String(req.params.id ?? "").trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(id)) {
        next();
        return;
      }
      const idx = await getTxById(id);
      if (idx) {
        cacheNoStore(res);
        res.json(
          mapExplorerTx({
            id: idx.id,
            blockId: idx.blockId,
            inclusionHeight: idx.inclusionHeight,
            timestamp: idx.timestamp,
            index: idx.indexInBlock,
            gix: idx.gix,
            size: idx.size,
            inputs: idx.inputs.map((b) => indexedBox(b, idx.blockId)),
            outputs: idx.outputs.map((b) => indexedBox(b, idx.blockId)),
          })
        );
        return;
      }
      const mem = deps.getRawMempool().get(id);
      if (!mem) {
        cacheNoStore(res);
        res.status(404).json({ error: "not_found" });
        return;
      }
      cacheNoStore(res);
      res.json(
        mapExplorerTx({
          id: mem.id,
          size: mem.size ?? null,
          inputs: (mem.inputs ?? []).map(rawBox),
          outputs: (mem.outputs ?? []).map(rawBox),
        })
      );
    });
  }
}

function indexedBox(b: IdxBoxRow, blockId: string | null) {
  return {
    boxId: b.boxId,
    value: b.value,
    creationHeight: b.creationHeight,
    address: b.address,
    ergoTree: b.ergoTree,
    transactionId: b.creationTxId,
    index: b.index,
    gix: b.gix,
    blockId,
    additionalRegisters: b.additionalRegisters,
    assets: b.assets,
    spentTransactionId: b.spentTxId,
  };
}

function rawBox(b: {
  boxId?: string;
  value?: number | string;
  ergoTree?: string;
  address?: string;
  additionalRegisters?: Record<string, string>;
  creationHeight?: number;
  transactionId?: string;
  index?: number;
  assets?: { tokenId: string; amount: number | string }[];
}) {
  return {
    boxId: b.boxId ?? "",
    value: b.value ?? "0",
    creationHeight: b.creationHeight ?? null,
    address: b.address ?? null,
    ergoTree: b.ergoTree ?? null,
    transactionId: b.transactionId ?? null,
    index: b.index ?? null,
    additionalRegisters: b.additionalRegisters,
    assets: b.assets ?? [],
  };
}

/** P2PK and P2S decode locally. Only P2SH needs a box from the index. */
async function addressTree(address: string): Promise<string | null> {
  return normErgoTree(ergoTreeFromAddress(address)) ?? normErgoTree(await ergoTreeForAddress(address));
}

async function confirmedBalance(
  address: string
): Promise<{ balance: ExplorerBalance; truncated: boolean } | null> {
  const bal = await addressBalanceConfirmed(address);
  if (!bal) return null;
  const meta = await tokenMetaMany(bal.tokens.slice(0, 80).map((t) => t.tokenId));
  return {
    truncated: bal.tokens.length > 80,
    balance: {
      nanoErgs: bal.nanoErgs,
      tokens: bal.tokens.slice(0, 80).map((tok) => {
        const m = meta.get(tok.tokenId) ?? meta.get(tok.tokenId.toLowerCase());
        return {
          tokenId: tok.tokenId,
          amount: tok.amount,
          decimals: resolveDecimals(
            tok.tokenId,
            m?.decimals != null && Number.isFinite(m.decimals) ? m.decimals : 0
          ),
          name: m?.name ?? null,
        };
      }),
    },
  };
}
