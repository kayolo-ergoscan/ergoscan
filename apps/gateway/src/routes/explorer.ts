/**
 * eUTXO-native explorer routes (graph, subblocks, tokens, platforms, openapi).
 */
import type { Express } from "express";
import {
  buildBoxGraph,
  KNOWN_TOKENS,
  listPlatforms,
  decodeRegisterMap,
  isLikelyNft,
  isNftKind,
  pickArtworkUrl,
  previewArtworkUrl,
  DEFAULT_RENT_PARAMS,
  type RawTx,
} from "@ergoscan/shared";
import type { SubblockEngine } from "../lib/subblocks.js";
import { API_PUBLIC_ORIGIN, apiContractMarkdown } from "../lib/api-contract.js";
import { OPENAPI_INFO_DESCRIPTION } from "../lib/openapi-intro.js";
import { parseHolderCursor } from "../lib/holder-cursor.js";
import { priceForToken, poolsForToken } from "../lib/market.js";
import {
  getTxById,
  indexerStatus,
  tokenHoldersFromIndex,
  tokenHoldersFromBalances,
  addressPipsByAddresses,
  tokenHolderActivityByAddresses,
  tokenTransactions,
  recentNftsFromIndex,
  nftCatalogFromIndex,
  nftNameGroupsFromIndex,
  nftNameGroupDetailFromIndex,
  nftIssuersFromIndex,
  nftIssuerItemsFromIndex,
  readyPreviewCids,
  tokenMetaFromIndex,
  searchTokensFromIndex,
  parseKeysetCursor,
  type IdxBoxRow,
  type IdxNft,
} from "../lib/indexDb.js";
import { getRentPage } from "../lib/snapshots.js";
import { resolveDecimals, sharePctOfEmission } from "../lib/explorerCompat.js";

export type ExplorerDeps = {
  getRawMempool: () => Map<string, RawTx>;
  subblocks: SubblockEngine;
  getFullHeight?: () => number | null | undefined;
};

function rawFromIdxBoxes(
  id: string,
  size: number | null,
  inputs: IdxBoxRow[],
  outputs: IdxBoxRow[]
): RawTx {
  const box = (b: IdxBoxRow) => ({
    boxId: b.boxId,
    value: Number(b.value) || 0,
    ergoTree: b.ergoTree ?? undefined,
    address: b.address ?? undefined,
    additionalRegisters: (b.additionalRegisters ?? {}) as Record<string, string>,
    assets: b.assets.map((a) => ({
      tokenId: a.tokenId,
      amount: Number(a.amount) || 0,
    })),
    creationHeight: b.creationHeight ?? undefined,
    index: b.index ?? undefined,
  });
  return {
    id,
    size: size ?? undefined,
    inputs: inputs.map(box),
    outputs: outputs.map(box),
    dataInputs: [],
  };
}

function catalogNftRow(it: IdxNft, ready: Set<string>) {
  return {
    tokenId: it.tokenId,
    name: it.name,
    artworkUrl: previewArtworkUrl(it.artworkUrl, ready),
    kind: it.kind,
    mediaUrl: previewArtworkUrl(it.mediaUrl, ready),
    sha256: it.sha256,
    amount: it.amount,
    firstHeight: it.firstHeight ?? it.creationHeight,
    txId: it.creationTxId,
    address: it.address,
    issuerAddress: it.issuerAddress,
    collection: it.collection,
    slug: it.slug,
    emission: it.emission,
    decimals: it.decimals,
    confirmed: true,
    source: "indexer",
  };
}

async function nftIndexWindow() {
  const st = await indexerStatus();
  return {
    minHeight: st.minHeight,
    lastHeight: st.lastHeight,
    span: st.span,
    ok: st.ok,
  };
}

export function registerExplorerRoutes(app: Express, deps: ExplorerDeps) {
  app.get("/v1/platforms", (_req, res) => {
    res.json({ platforms: listPlatforms(), knownTokens: Object.keys(KNOWN_TOKENS).length });
  });

  /**
   * Search NFT-like tokens (emission=1) in `tokens`. Never box_assets, never the node.
   */
  app.get("/v1/nfts/search", async (req, res) => {
    const q = String(req.query.q ?? req.query.query ?? "").trim();
    const limit = Math.min(40, Math.max(1, Number(req.query.limit ?? 24) || 24));
    if (!q) return res.json({ q, items: [], count: 0, source: "indexer", ready: true });
    try {
      const hits = await searchTokensFromIndex(q, limit, { nftOnly: true });
      if (!hits) {
        return res.json({
          q,
          items: [],
          count: 0,
          ready: false,
          source: "indexer_cold",
          note: "Indexer unavailable.",
        });
      }
      const ready = await readyPreviewCids(
        hits.flatMap((h) => [h.artworkUrl, h.mediaUrl])
      );
      const items = hits.map((h) => ({
        tokenId: h.tokenId,
        name: h.name,
        decimals: h.decimals,
        emission: h.emission,
        firstHeight: h.firstHeight,
        unspentBoxes: h.unspentBoxes,
        isNftLike: h.isNftLike || h.emission === 1,
        artworkUrl: previewArtworkUrl(h.artworkUrl, ready),
        kind: h.kind,
        mediaUrl: previewArtworkUrl(h.mediaUrl, ready),
        source: "indexer",
      }));
      res.json({
        q,
        items,
        count: items.length,
        ready: true,
        source: "indexer:tokens",
        note: "Search on tokens.emission=1 (name/id). Name/art from tokens + mint registers in PG.",
      });
    } catch (e) {
      res.status(502).json({ error: "nft_search_failed", detail: String(e), q, items: [] });
    }
  });

  /**
   * Catalog: tokens.emission=1. Name/art from tokens + mint registers in PG.
   */
  app.get("/v1/nfts/catalog", async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 24) || 24));
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    const kindRaw = String(req.query.kind ?? req.query.type ?? "").trim().toLowerCase();
    const kind = isNftKind(kindRaw) ? kindRaw : null;
    try {
      const [cat, window] = await Promise.all([
        nftCatalogFromIndex(limit, offset, kind),
        nftIndexWindow(),
      ]);
      if (!cat) {
        return res.json({
          items: [],
          count: 0,
          total: 0,
          named: 0,
          withArt: 0,
          kind,
          kindReady: false,
          kinds: {},
          ready: false,
          window,
          source: "indexer_cold",
          note: "Indexer unavailable.",
        });
      }
      const ready = await readyPreviewCids(
        cat.items.flatMap((it) => [it.artworkUrl, it.mediaUrl])
      );
      const items = cat.items.map((it) => catalogNftRow(it, ready));
      return res.json({
        items,
        count: items.length,
        total: cat.total,
        named: cat.named,
        withArt: cat.withArt,
        kind: cat.kind,
        kindReady: cat.kindReady,
        kinds: cat.kinds,
        ready: true,
        window,
        pagination: {
          offset,
          limit,
          hasMore: offset + items.length < cat.total,
          total: cat.total,
        },
        source: "indexer:tokens",
        note:
          "NFT catalog from tokens.emission=1. Kind from mint R7 (page) or tokens.nft_kind (filter). Never the node.",
      });
    } catch (e) {
      res.status(502).json({ error: "catalog_failed", detail: String(e) });
    }
  });

  /**
   * Recent NFT mints from tokens.first_height. Mempool singles overlay only — not catalog truth.
   */
  app.get("/v1/nfts/recent", async (req, res) => {
    const limit = Math.min(48, Math.max(1, Number(req.query.limit ?? 24) || 24));
    const items: Array<Record<string, unknown>> = [];
    const preferIndex = req.query.index !== "0" && req.query.index !== "false";
    let ready = true;

    if (preferIndex) {
      try {
        const idx = await recentNftsFromIndex(limit);
        if (idx == null) ready = false;
        else {
          const artReady = await readyPreviewCids(
            idx.flatMap((it) => [it.artworkUrl, it.mediaUrl])
          );
          for (const it of idx) {
            items.push({
              txId: it.creationTxId,
              tokenId: it.tokenId,
              name: it.name,
              artworkUrl: previewArtworkUrl(it.artworkUrl, artReady),
              kind: it.kind,
              mediaUrl: previewArtworkUrl(it.mediaUrl, artReady),
              category: "nft",
              fee: null,
              firstSeen: null,
              height: it.creationHeight ?? it.firstHeight,
              source: "indexer",
              confirmed: true,
              address: it.address,
              issuerAddress: it.issuerAddress,
              collection: it.collection,
              slug: it.slug,
            });
          }
        }
      } catch {
        ready = false;
      }
    }

    const seen = new Set(
      items.map((i) => String((i as { tokenId?: string }).tokenId ?? "")).filter(Boolean)
    );
    for (const tx of deps.getRawMempool().values()) {
      if (items.length >= limit) break;
      for (const o of tx.outputs ?? []) {
        if (items.length >= limit) break;
        for (const a of o.assets ?? []) {
          if (items.length >= limit) break;
          if (Number(a.amount) !== 1 || !a.tokenId || seen.has(a.tokenId)) continue;
          seen.add(a.tokenId);
          items.push({
            txId: tx.id,
            tokenId: a.tokenId,
            name: null,
            artworkUrl: null,
            category: "nft",
            fee: null,
            firstSeen: null,
            height: null,
            source: "mempool",
            confirmed: false,
          });
        }
      }
    }

    const sources = new Set(
      items.map((i) => String((i as { source?: string }).source ?? "unknown"))
    );
    res.json({
      items: items.slice(0, limit),
      count: Math.min(items.length, limit),
      ready,
      sources: [...sources],
      note:
        "Recent emission=1 from tokens.first_height. Mempool amount=1 is overlay only. Never the node.",
    });
  });

  /**
   * Name series: strip #n / -n / edition n. Not EIP-34. Index only.
   */
  app.get("/v1/nfts/collections", async (req, res) => {
    const limit = Math.min(48, Math.max(1, Number(req.query.limit ?? 24) || 24));
    try {
      const collections = await nftNameGroupsFromIndex(limit);
      if (!collections) {
        return res.json({
          collections: [],
          scannedTokens: 0,
          uniqueCollections: 0,
          ready: false,
          source: "indexer_cold",
          note: "Indexer unavailable.",
        });
      }
      const ready = await readyPreviewCids(
        collections.flatMap((c) => [c.coverUrl, ...c.sample.map((s) => s.artworkUrl)])
      );
      res.json({
        collections: collections.map((c) => ({
          ...c,
          coverUrl: previewArtworkUrl(c.coverUrl, ready),
          sample: c.sample.map((s) => ({
            ...s,
            artworkUrl: previewArtworkUrl(s.artworkUrl, ready),
          })),
        })),
        scannedTokens: collections.reduce((n, c) => n + c.count, 0),
        uniqueCollections: collections.length,
        ready: true,
        source: "indexer:tokens",
        note:
          "Name series from tokens.emission=1 (strip #n / -n / edition n). Not EIP-34 collections.",
      });
    } catch (e) {
      res.status(502).json({ error: "collections_scan_failed", detail: String(e) });
    }
  });

  app.get("/v1/nfts/collections/:slug", async (req, res) => {
    const slug = String(req.params.slug || "").toLowerCase();
    if (!slug || slug.length > 80) {
      return res.status(400).json({ error: "invalid_slug" });
    }
    const limit = Math.min(60, Math.max(1, Number(req.query.limit ?? 24) || 24));
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    try {
      const detail = await nftNameGroupDetailFromIndex(slug, limit, offset);
      if (!detail) {
        return res.status(503).json({
          error: "indexer_cold",
          slug,
          ready: false,
          items: [],
        });
      }
      if (!detail.items.length && detail.total === 0) {
        return res.status(404).json({ error: "collection_not_found", slug });
      }
      const ready = await readyPreviewCids(
        detail.items.flatMap((it) => [it.artworkUrl, it.mediaUrl])
      );
      const items = detail.items.map((it) => ({
        ...catalogNftRow(it, ready),
        height: it.firstHeight ?? it.creationHeight,
      }));
      res.json({
        slug,
        name: detail.name,
        items,
        count: detail.total,
        total: detail.total,
        ready: true,
        pagination: {
          offset,
          limit,
          hasMore: offset + items.length < detail.total,
          total: detail.total,
        },
        coverUrl: items.find((i) => i.artworkUrl)?.artworkUrl ?? null,
        note: "Name series members from tokens.emission=1. Not EIP-34.",
      });
    } catch (e) {
      res.status(502).json({ error: "collection_failed", detail: String(e) });
    }
  });

  /**
   * Issuers = mint issuer-box address (boxes.box_id = token_id). Not EIP-34 artist.
   */
  app.get("/v1/nfts/issuers", async (req, res) => {
    const limit = Math.min(48, Math.max(1, Number(req.query.limit ?? 24) || 24));
    try {
      const issuers = await nftIssuersFromIndex(limit);
      if (!issuers) {
        return res.json({
          issuers: [],
          count: 0,
          ready: false,
          source: "indexer_cold",
          note: "Indexer unavailable.",
        });
      }
      const ready = await readyPreviewCids(issuers.map((it) => it.coverUrl));
      res.json({
        issuers: issuers.map((it) => ({
          ...it,
          coverUrl: previewArtworkUrl(it.coverUrl, ready),
        })),
        count: issuers.length,
        ready: true,
        source: "indexer:tokens",
        note:
          "Grouped by issuer-box address (spent box_id = token_id). Address-book names on the UI. Not EIP-34.",
      });
    } catch (e) {
      res.status(502).json({ error: "issuers_failed", detail: String(e) });
    }
  });

  app.get("/v1/nfts/issuers/:address", async (req, res) => {
    const address = String(req.params.address || "").trim();
    if (!address || address.length < 8 || address.length > 4000 || /\s/.test(address)) {
      return res.status(400).json({ error: "invalid_address" });
    }
    const limit = Math.min(60, Math.max(1, Number(req.query.limit ?? 24) || 24));
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    try {
      const page = await nftIssuerItemsFromIndex(address, limit, offset);
      if (!page) {
        return res.status(503).json({
          error: "indexer_cold",
          address,
          ready: false,
          items: [],
        });
      }
      const ready = await readyPreviewCids(
        page.items.flatMap((it) => [it.artworkUrl, it.mediaUrl])
      );
      const items = page.items.map((it) => ({
        ...catalogNftRow(it, ready),
        height: it.firstHeight ?? it.creationHeight,
      }));
      res.json({
        address,
        items,
        count: page.total,
        total: page.total,
        ready: true,
        pagination: {
          offset,
          limit,
          hasMore: offset + items.length < page.total,
          total: page.total,
        },
        coverUrl: items.find((i) => i.artworkUrl)?.artworkUrl ?? null,
        source: "indexer:tokens",
        note: "NFTs whose issuer box (token_id) was created by this address.",
      });
    } catch (e) {
      res.status(502).json({ error: "issuer_failed", detail: String(e) });
    }
  });

  app.get("/v1/subblocks", (_req, res) => {
    const snap = deps.subblocks.snapshot();
    res.json({
      ...snap,
      // honest naming for clients
      kind: "ordering-window",
      matrixInputBlocks: false,
      note:
        snap.disclaimer ||
        "SYNTHETIC ordering-window progress. Matrix input blocks are devnet-only; not mainnet.",
    });
  });

  app.get("/v1/graph/tx/:id", async (req, res) => {
    const id = req.params.id;
    const mem = deps.getRawMempool().get(id);
    if (mem) return res.json(buildBoxGraph(mem));
    const idx = await getTxById(id);
    if (!idx) {
      return res.status(404).json({ error: "not_found" });
    }
    res.json(buildBoxGraph(rawFromIdxBoxes(id, idx.size, idx.inputs, idx.outputs)));
  });

  /**
   * Top holders by summing unspent boxes containing the token.
   * Approximate: scans up to `scan` boxes (default 200), aggregates by address.
   */
  app.get("/v1/tokens/:id/pools", async (req, res) => {
    const id = req.params.id;
    if (!/^[0-9a-fA-F]{64}$/.test(id) && id !== "ERG") {
      return res.status(400).json({ error: "invalid_token_id" });
    }
    try {
      const limit = Math.min(40, Math.max(1, Number(req.query.limit ?? 15) || 15));
      const data = await poolsForToken(id === "ERG" ? "0".repeat(64) : id, limit);
      res.json(data);
    } catch (e) {
      res.status(502).json({ error: "pools_failed", detail: String(e) });
    }
  });

  app.get("/v1/tokens/:id/txs", async (req, res) => {
    const id = req.params.id;
    if (!/^[0-9a-fA-F]{64}$/.test(id)) {
      return res.status(400).json({ error: "invalid_token_id" });
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 25) || 25));
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    const flowQ = String(req.query.flow ?? "all");
    const flow = flowQ === "mintburn" ? "mintburn" : flowQ === "swap" ? "swap" : "all";
    const cursor = parseKeysetCursor(req.query.cursor);
    try {
      const page = await tokenTransactions(id.toLowerCase(), offset, limit, flow, cursor);
      if (!page) {
        return res.json({
          tokenId: id,
          items: [],
          pagination: { offset, limit, hasMore: false, total: 0, nextCursor: null },
          source: "indexer:missing",
        });
      }
      return res.json({
        tokenId: id,
        items: page.items,
        pagination: {
          offset,
          limit,
          hasMore: page.hasMore,
          total: page.total,
          nextCursor: page.nextCursor,
        },
        source: page.source,
      });
    } catch (e) {
      res.status(502).json({ error: "token_txs_failed", detail: String(e) });
    }
  });

  app.get("/v1/tokens/:id/holders", async (req, res) => {
    const id = req.params.id;
    if (!/^[0-9a-fA-F]{64}$/.test(id)) {
      return res.status(400).json({ error: "invalid_token_id" });
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 40) || 40));
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    const dir = req.query.dir === "asc" ? "asc" : "desc";
    const cursor = parseHolderCursor(req.query.cursor);

    try {
      const known = KNOWN_TOKENS[id];
      const idxMeta = await tokenMetaFromIndex(id).catch(() => null);
      const bal = await tokenHoldersFromBalances(
        id,
        limit,
        offset,
        dir,
        cursor,
        idxMeta?.holders
      );
      let decimals = Number(idxMeta?.decimals ?? 0) || 0;
      let name: string | null = idxMeta?.name ?? known?.name ?? null;

      // Incremental balances first; unspent scan is the fallback. Node only if indexer is empty.
      const idx =
        bal && (bal.holders.length > 0 || bal.uniqueAddresses > 0)
          ? bal
          : await tokenHoldersFromIndex(id, limit, offset, dir);
      if (idx && idx.uniqueAddresses > 0) {
        const totalAmount = idx.totalAmount;
        const addrs = idx.holders.map((h) => h.address);
        const sums = await addressPipsByAddresses(addrs).catch(() => new Map());
        const addrTxN = new Map<string, number>();
        for (const [addr, s] of sums) addrTxN.set(addr, s.txCount);
        const ledger = new Map(
          idx.holders.map((h) => [
            h.address,
            {
              firstHeight: h.firstHeight ?? null,
              lastHeight: h.lastHeight ?? null,
              txCount: h.txCount ?? null,
            },
          ])
        );
        const tokenAct = await tokenHolderActivityByAddresses(id, addrs, addrTxN, ledger).catch(
          () => new Map()
        );
        const page = idx.holders.map((h, i) => {
          const s = sums.get(h.address);
          const a = tokenAct.get(h.address);
          return {
            rank: offset + i + 1,
            address: h.address,
            amount: h.amount,
            amountUi: decimals > 0 ? h.amount / 10 ** decimals : h.amount,
            boxes: h.boxes,
            sharePct: sharePctOfEmission(h.amount, idxMeta?.emission),
            nanoerg: s?.nanoerg ?? null,
            txCount: a?.txCount ?? null,
            tokenCount: s?.tokenCount ?? null,
            firstTs: a?.firstTs ?? null,
            lastTs: a?.lastTs ?? null,
            firstTxId: a?.firstTxId ?? null,
            lastTxId: a?.lastTxId ?? null,
          };
        });
        const fromBalances = !!(bal && (bal.holders.length > 0 || bal.uniqueAddresses > 0));
        return res.json({
          tokenId: id,
          name,
          decimals,
          holders: page,
          scannedBoxes: idx.scannedBoxes,
          uniqueAddresses: idx.uniqueAddresses,
          totalAmountScanned: totalAmount,
          totalAmountUi:
            decimals > 0 ? totalAmount / 10 ** decimals : totalAmount,
          pagination: {
            offset,
            limit,
            hasMore: idx.hasMore,
            total: idx.uniqueAddresses,
            nextCursor: idx.nextCursor,
          },
          note: fromBalances
            ? "Holders from indexer token_balances (indexed window)."
            : "Holders from Phase 2 indexer unspent boxes (window tip-backfill, not full chain history).",
          source: fromBalances ? "indexer:token_balances" : "indexer:box_assets+unspent",
        });
      }

      return res.json({
        tokenId: id,
        name,
        decimals,
        holders: [],
        scannedBoxes: 0,
        uniqueAddresses: 0,
        totalAmountScanned: 0,
        totalAmountUi: 0,
        pagination: { offset, limit, hasMore: false, total: 0 },
        note: "No holders in the indexed window.",
        source: "indexer:empty",
      });
    } catch (e) {
      res.status(502).json({ error: "holders_failed", detail: String(e) });
    }
  });

  app.get("/v1/tokens/:id", async (req, res) => {
    const id = req.params.id;
    const marketQ = req.query.market;
    const skipMarket =
      marketQ === "0" || marketQ === "false" || (Array.isArray(marketQ) && (marketQ[0] === "0" || marketQ[0] === "false"));
    const idx = await tokenMetaFromIndex(id).catch(() => null);
    const indexStats = idx
      ? {
          holders: idx.holders,
          txCount: idx.txCount,
          unspentBoxes: idx.unspentBoxes,
          firstHeight: idx.firstHeight,
          lastHeight: idx.lastHeight,
        }
      : {};
    const known = KNOWN_TOKENS[id];
    if (!idx && !known) {
      return res.status(404).json({ error: "not_found" });
    }
    const regs = idx?.registers ?? {};
    const decoded = decodeRegisterMap(regs);
    const rawName = idx?.name?.trim() || known?.name || decoded.R4?.text || null;
    const name = rawName && !rawName.includes("\uFFFD") ? rawName : null;
    const emission = idx?.emission ?? null;
    const storedDec = idx?.decimals ?? 0;
    const decimals = resolveDecimals(id, storedDec, emission);
    const isNft = isLikelyNft({
      decimals: storedDec,
      emissionAmount: emission,
      name,
    });
    const rawArt = idx?.artworkUrl ?? pickArtworkUrl(decoded);
    const ready = await readyPreviewCids([
      rawArt,
      idx?.nft?.url,
      idx?.nft?.coverUrl,
      ...(idx?.nft?.extraUrls ?? []),
    ]);
    const artworkUrl = previewArtworkUrl(rawArt, ready);
    const nft = idx?.nft
      ? {
          ...idx.nft,
          url: previewArtworkUrl(idx.nft.url, ready) ?? idx.nft.url,
          coverUrl: previewArtworkUrl(idx.nft.coverUrl, ready) ?? idx.nft.coverUrl,
          extraUrls: (idx.nft.extraUrls ?? []).map((u) => previewArtworkUrl(u, ready) ?? u),
        }
      : null;
    const price = skipMarket
      ? null
      : await priceForToken(id, name).catch(() => null);
    const pools = skipMarket ? null : await poolsForToken(id, 12).catch(() => null);
    return res.json({
      tokenId: id,
      id,
      name,
      description: idx?.description ?? null,
      decimals,
      emissionAmount: emission,
      boxId: idx?.boxId ?? null,
      platform: known?.platform ?? null,
      category: known?.category ?? (isNft ? "nft" : null),
      registers: regs,
      registersDecoded: decoded,
      isNft,
      artworkUrl,
      nft,
      issuerAddress: idx?.issuerAddress ?? null,
      mintTxId: idx?.mintTxId ?? null,
      price,
      pools: pools?.pools ?? [],
      poolCount: pools?.pools.length ?? 0,
      source: idx ? "indexer" : "known",
      ...indexStats,
    });
  });

  /**
   * Boxes closest to storage rent from the indexer tape. Never the node.
   */
  app.get("/v1/rent/at-risk", async (req, res) => {
    const limit = Math.min(80, Math.max(1, Number(req.query.limit ?? 40) || 40));
    const page = await getRentPage({ tab: "upcoming", offset: 0, limit });
    if (!page) {
      return res.status(503).json({ error: "stale", stale: true });
    }
    const rentParams = {
      storagePeriodBlocks: page.periodBlocks,
      storageFeeFactor: page.storageFeeFactor,
      minValuePerByte: DEFAULT_RENT_PARAMS.minValuePerByte,
    };
    const items = page.items.map((it) => ({
      boxId: it.boxId,
      address: it.address,
      value: Number(it.valueNano),
      creationHeight: it.creationHeight,
      height: it.creationHeight,
      rent: {
        rentDue: it.rentDue,
        blocksUntilRent: it.blocksUntilRent,
        estimatedRentNano: Number(it.rentNano) || 0,
        boxValueNano: Number(it.valueNano) || 0,
        sizeBytes: it.sizeBytes,
        belowMinValue: false,
      },
    }));
    res.json({
      tipHeight: page.tipHeight,
      params: rentParams,
      scannedBoxes: items.length,
      scannedBlocks: 0,
      dueCount: page.due.boxCount,
      soonCount: page.next30d.boxCount,
      dustCount: 0,
      items,
      source: page.source,
      note:
        "Upcoming storage-rent tape from indexer unspent boxes (same as /v1/page/rent). Not a recent-block sample.",
    });
  });

  app.get("/openapi.json", (_req, res) => {
    res.json(openapiForDocs());
  });
}

const COMPAT_PATHS = [
  "/v1/boxes/unspent/byAddress",
  "/v1/boxes/unspent/unconfirmed/byAddress",
  "/v1/boxes/byAddress",
  "/v1/boxes/unspent/byTokenId",
  "/v1/boxes/byErgoTree",
  "/v1/boxes/unspent/byErgoTree",
  "/v1/boxes/byErgoTreeTemplateHash",
  "/v1/boxes/unspent/byErgoTreeTemplateHash",
  "/v1/boxes/unspent/byGlobalIndex/stream",
  "/v1/transactions/byGlobalIndex/stream",
  "/v1/addresses/{address}/balance/total",
  "/v1/tokens/bySymbol",
  "/v1/epochs/params",
  "/v1/blocks/headers",
  "/v1/networkStats",
  "/v1/networkState",
  "/v1/mempool/transactions",
  "/v1/mempool/boxes/unspent",
  "/v1/assets",
];

function pathTag(path: string): string {
  if (COMPAT_PATHS.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}{`))) {
    return "Wallet compat";
  }
  return "ErgoScan";
}

function openapiForDocs() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [path, ops] of Object.entries(OPENAPI_SPEC.paths)) {
    const tagged: Record<string, unknown> = {};
    for (const [method, op] of Object.entries(ops as Record<string, Record<string, unknown>>)) {
      tagged[method] = { ...op, tags: op.tags ?? [pathTag(path)] };
    }
    paths[path] = tagged;
  }
  const api = process.env.API_CONTOUR === "1";
  return {
    ...OPENAPI_SPEC,
    info: {
      ...OPENAPI_SPEC.info,
      title: "ErgoScan API",
      description: api ? apiContractMarkdown() : OPENAPI_INFO_DESCRIPTION,
    },
    servers: api ? [{ url: API_PUBLIC_ORIGIN }] : OPENAPI_SPEC.servers,
    tags: [
      { name: "ErgoScan", description: "Native product routes. What the site uses." },
      {
        name: "Wallet compat",
        description:
          "Official explorer path aliases over our index. Same suffixes, our data, string amounts.",
      },
    ],
    paths,
  };
}

const OPENAPI_SPEC = {
  openapi: "3.0.3",
  info: {
    title: "ErgoScan API",
    version: "1.0.0",
    description: OPENAPI_INFO_DESCRIPTION,
  },
  servers: [{ url: "https://ergoscan.me" }, { url: "/" }],
  paths: {
    "/v1/health": {
      get: { summary: "Public liveness: ok, network, height, mempool count. No node URL or disk." },
    },
    "/v1/info": { get: { summary: "Node info lite" } },
    "/v1/mempool": { get: { summary: "Mempool ball snapshot" } },
    "/v1/fees/histogram": { get: { summary: "Fee histogram + ETA" } },
    "/v1/fees/eta": { get: { summary: "Next ordering block ETA" } },
    "/v1/indexer/status": { get: { summary: "Indexer window from snapshot" } },
    "/v1/blocks": {
      get: {
        summary:
          "Latest blocks from indexer snapshot `blocks_latest` (not the node). Raw array when no offset/cursor. Additive ?limit=&offset= or ?cursor= (height) returns { items, hasMore, nextCursor, offset, updatedAt }. Pager is keyset on `blocks.height`, not a 50-row snapshot cap. Additive userValueNano = output sum minus coinbase (emission-box recycle). Additive lithos is true when the block was mined with Lithos: one LITHOS-COLLAT leaves the collateral contract. The later return is not marked. The first page reads the flag from snapshot blocks_latest.",
      },
    },
    "/v1/blocks/{id}": {
      get: {
        summary:
          "Block card from indexer tables (not the node). Additive ?limit=&offset= packs txs (default 25). limit=0 is header only. Additive txs[].tokenCount = distinct tokens on boxes created or spent by that tx. Additive userValueNano = output sum minus coinbase. Additive lithos is true when this block was mined with Lithos: one LITHOS-COLLAT leaves the collateral contract.",
      },
    },
    "/v1/transactions/{id}": {
      get: {
        summary:
          "Transaction from the index only. Mempool RAM first (input addresses hydrated from boxes, not the node). Confirmed = transactions row + boxes that exist. Additive indexInBlock, prevId, nextId, valueNano, inputCount, outputCount, assetsComplete, tokenMeta[], gix (our sequential index or null; not official explorer). Additive rent=rent|rent-renew from rent_collected at the inclusion height (null when the writer has no protocol row). assetsComplete=false suppresses settlement claims in the UI. 404 if missing. source=mempool|indexer.",
      },
    },
    "/v1/boxes/{id}": {
      get: {
        summary:
          "Box from the index (mempool RAM if unconfirmed). creationHeight is the declared rent clock; settlementHeight and blockId are creating-tx inclusion (null in mempool). Additive registersTyped plus ergoTreeConstants / ergoTreeScript / ergoTreeTemplateHash (SHA-256 of template bytes; decode on this GET only). Additive gix: our sequential index or null. Not official explorer globalIndex. Unspent/tx byGlobalIndex streams are live. Exact byErgoTree uses the script index. Template hash uses packed.box_template. Both limit ≤ 100, offset ≤ 500, 4s.",
      },
    },
    "/v1/addresses/{address}/rent-due": {
      get: {
        summary:
          "Soonest storage rent on this address. Oldest unspent box via the address index (one row). blocksUntilRent is 0 when already due, a block count when due within 90 days, null otherwise. No node, no box list.",
      },
    },
    "/v1/addresses/{id}": {
      get: {
        summary:
          "Address showcase. Activity tape is txs from address_tx (boxLimit=0). Unspent boxes are a separate GET. A boxes timeout returns 200 with sources.boxes=stale and does not 503 the txs tape. Additive activity=0 skips live box UNION (activity {}, sources.activity=deferred). Additive mempoolTxs: pending txs whose outputs/inputs match the address ergoTree (node mempool has trees, not Base58). Not counted in pagination.txs.total.",
      },
    },
    "/v1/addresses/{id}/nfts": {
      get: {
        summary:
          "Unspent NFT holdings (additive). EIP-4 emission=1, else 1-unit 0-decimal while meta is thin. Name/art from tokens + issuance box in PG. Never the node.",
      },
    },
    "/v1/tokens": {
      get: {
        summary:
          "Token catalog from indexer `tokens` (window, not genesis). Additive limit/offset/sort=last|first|holders|supply|txs|name. Names from `tokens.name` only — no node on this GET. Additive names=0 is a no-op. KPIs: unique holders/txs from indexer token_balances (not SUM of rows).",
      },
    },
    "/v1/tokens/{id}": {
      get: {
        summary:
          "Token card from indexer `tokens` + issuance box registers in PG. Additive nft { kind, sha256, url, royalty, collectionTokenId, mintAddress } from EIP-4/24. Never the node. Additive ?market=0 skips Spectrum.",
      },
    },
    "/v1/tokens/{id}/price": { get: { summary: "Token price (Spectrum + ERG/USD)" } },
    "/v1/tokens/{id}/holders": {
      get: {
        summary:
          "Top token holders from token_balances. Keyset ?cursor=amount|address (LIMIT 26). Additive ?offset only ranks; ignored when cursor is set. Additive ?dir=asc|desc (amount). Default desc. Additive sharePct is % of tokens.emission, not SUM(token_balances). Additive txCount/firstTs/lastTs from token_balances.tx_count + heights (indexer snapshot); GET COUNT only while seed is NULL. Additive nanoerg/tokenCount from address_summary (pip / inventory).",
      },
    },
    "/v1/tokens/{id}/txs": {
      get: {
        summary:
          "Token tx tape from token_tx_move. No box walk. flow=all is transfers, swaps excluded. flow=swap is Spectrum/Lithos buy/sell from defi.trades. flow=mintburn is issuance and real burns. Keyset ?cursor=height:txId.",
      },
    },
    "/v1/tokens/{id}/pools": { get: { summary: "Spectrum DEX pools for token" } },
    "/v1/tokens/search": {
      get: {
        summary:
          "Search tokens by name or id. Accepts q or official query. Index first (tokens table), then known/Spectrum. Never api.ergoplatform.com. Additive explorerItems[] as official TokenInfo (string emissionAmount).",
      },
    },
    "/v1/tokens/bySymbol/{name}": {
      get: {
        summary:
          "Official alias. All tokens with this exact name (case-insensitive). Array of TokenInfo. tokens table only. Decimals from DB or known Rosen/Spectrum map when DB is 0.",
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/TokenInfo" } },
              },
            },
          },
        },
      },
    },
    "/v1/boxes/unspent/unconfirmed/byAddress/{address}": {
      get: {
        summary: "Official alias. Mempool RAM outputs for this address. Never the node.",
        responses: {
          "200": {
            content: { "application/json": { schema: { $ref: "#/components/schemas/Items_OutputInfo" } } },
          },
        },
      },
    },
    "/v1/boxes/unspent/byAddress/{address}": {
      get: {
        summary:
          "Official alias. Unspent boxes for address. items/total from address_summary.box_count. Keyset nextCursor. offset≤500 on the address index, not a table OFFSET.",
        responses: {
          "200": {
            content: { "application/json": { schema: { $ref: "#/components/schemas/Items_OutputInfo" } } },
          },
        },
      },
    },
    "/v1/boxes/byErgoTree/{tree}": {
      get: {
        summary:
          "Boxes with this exact ErgoTree hex. Index via script md5. limit ≤ 100, offset ≤ 500. No total. Timeout 4s → 504.",
      },
    },
    "/v1/boxes/unspent/byErgoTree/{tree}": {
      get: {
        summary: "Unspent boxes with this exact ErgoTree. Same page caps and timeout.",
      },
    },
    "/v1/boxes/byErgoTreeTemplateHash/{hash}": {
      get: {
        summary:
          "Boxes whose ErgoTree shares this template hash (SHA-256 of template bytes, 64 hex). Same value as ergoTreeTemplateHash on GET /boxes/{id}. limit ≤ 100, offset ≤ 500. No total. Timeout 4s → 504.",
      },
    },
    "/v1/boxes/unspent/byErgoTreeTemplateHash/{hash}": {
      get: {
        summary: "Unspent boxes for this template hash. Same page caps and timeout.",
      },
    },
    "/v1/boxes/unspent/byGlobalIndex/stream": {
      get: {
        summary:
          "Unspent boxes in our gix window. minGix+maxGix required, max−min+1≤10000. globalIndex and additive gix are ours, not official explorer. Timeout 4s → 504.",
      },
    },
    "/v1/transactions/byGlobalIndex/stream": {
      get: {
        summary:
          "Transactions in our gix window. Same minGix/maxGix rules. Official-shaped items; globalIndex and additive gix are ours. Timeout 4s → 504.",
      },
    },
    "/v1/assets": {
      get: {
        summary:
          "Official deprecated alias of a token catalog page. TokenInfo items from indexer tokens (holders sort). hideNfts=1 skips emission=1. Does not change GET /v1/tokens.",
        responses: {
          "200": {
            content: { "application/json": { schema: { $ref: "#/components/schemas/Items_TokenInfo" } } },
          },
        },
      },
    },
    "/v1/assets/search/byTokenId": {
      get: {
        summary: "Official alias. Token id / name search, min query length 5. tokens table only.",
        responses: {
          "200": {
            content: { "application/json": { schema: { $ref: "#/components/schemas/Items_TokenInfo" } } },
          },
        },
      },
    },
    "/v1/boxes/byAddress/{address}": {
      get: {
        summary:
          "Official alias. Spent+unspent boxes for address, small page. total is page size (no COUNT boxes).",
      },
    },
    "/v1/addresses/{address}/balance/total": {
      get: {
        summary:
          "Official alias. confirmed from address_summary + unspent tokens; unconfirmed from mempool RAM. nanoErgs as strings.",
        responses: {
          "200": {
            content: { "application/json": { schema: { $ref: "#/components/schemas/TotalBalance" } } },
          },
        },
      },
    },
    "/v1/epochs/params": {
      get: {
        summary: "Official alias. Last node /info.parameters from gateway RAM. Not a node GET.",
        responses: {
          "200": {
            content: { "application/json": { schema: { $ref: "#/components/schemas/EpochInfo" } } },
          },
        },
      },
    },
    "/v1/blocks/headers": {
      get: { summary: "Official alias. Recent block headers from indexer snapshot/tables. items + nextCursor." },
    },
    "/v1/networkState": {
      get: { summary: "Official NetworkState names + our network. params from node /info RAM. maxBoxGix/maxTxGix = *_gix_next − 1 (our gix, not official explorer)." },
    },
    "/v1/graphql": {
      post: {
        summary:
          "Our GraphQL on this gateway. Indexed roots only (box/tx/address/token/gix/mempool/oracles/defi/rosen + submitTx). submitTx shares the REST submit rate limit; node errors map to rejected/submit_failed. Not nautls or SigmaSpace. GET is 405.",
      },
    },
    "/v1/networkStats": {
      get: { summary: "Official uniqueAddressesNum from home snapshot holderCount. Additive hashRate, transactionAverage. No table COUNT." },
    },
    "/v1/mempool/transactions/submit": {
      post: {
        summary:
          "Broadcast a signed tx. Shape-checked, then node POST /transactions. Node errors map to rejected/submit_failed. Separate submit rate limit.",
      },
    },
    "/v1/mempool/transactions/byAddress/{address}": {
      get: { summary: "Official alias. Pending txs in gateway RAM that mention the address." },
    },
    "/v1/mempool/boxes/unspent": {
      get: { summary: "Official alias. Outputs currently in mempool RAM." },
    },
    "/v1/nfts/recent": {
      get: {
        summary:
          "Recent emission=1 from tokens.first_height. Mempool amount=1 overlay only. Never the node.",
      },
    },
    "/v1/nfts/catalog": {
      get: {
        summary:
          "NFT catalog from tokens.emission=1. Additive ?kind=image|audio|video|collection|file|membership uses tokens.nft_kind. Page items include EIP-4 R7 kind from mint registers. Never the node.",
      },
    },
    "/v1/nfts/search": {
      get: { summary: "Search tokens.emission=1 by name or id. Never box_assets, never the node." },
    },
    "/v1/nfts/collections": {
      get: { summary: "Name series (strip #n). Not EIP-34. Index tokens only." },
    },
    "/v1/nfts/collections/{slug}": {
      get: { summary: "Name-series members from tokens.emission=1." },
    },
    "/v1/nfts/issuers": {
      get: { summary: "Issuer-box addresses with ≥2 emission=1 tokens. Not EIP-34 artist." },
    },
    "/v1/nfts/issuers/{address}": {
      get: { summary: "NFTs minted from this issuer-box address." },
    },
    "/v1/richlist": { get: { summary: "Top ERG holders from address_summary" } },
    "/v1/rent/at-risk": { get: { summary: "Upcoming storage-rent tape from indexer (not the node)" } },
    "/v1/transactions/recent": {
      get: {
        summary:
          "Recent confirmed txs (snapshot first pack). Additive mempool=1 prepends up to 15 pending when no cursor. Additive ?cursor= keyset (height, index_in_block, id); hasMore/nextCursor. Not TX_WINDOW OFFSET and not a full-table COUNT. Additive category rent | rent-renew when rent_collected has a protocol row in the page height window (collector set → rent, otherwise renewal). Shape columns stay unchanged.",
      },
    },
    "/v1/network/orbit": {
      get: { summary: "Home Earth: crawl live + connected peers, plus top ISO regions" },
    },
    "/v1/page/home": {
      get: {
        summary:
          "SSR home composite from list snapshots. Hashrate/tx/circulating/CG price/24h/miner share/holderCount/scriptCount/txTotal from indexer; GET does not scan tables, explorer, or CoinGecko. Additive scriptCount is protocol+pool+contract with nanoERG>0 from the holder-bands pass, stored on the home snapshot. Does not attach userValueNano (coinbase subtract stays on /v1/blocks and the block card). Additive rank/volume24h/change24h/ergUsd copied from snapshot_kv.market (oracle writer CoinGecko). Additive txTotal is the indexer running SUM(blocks.tx_count), not a GET COUNT. Additive rentTape + rentEpochBoxes + rentEpochNano + rentDanger from snapshot_kv.rent (oldest addresses this week; box count and estimated rent due this header epoch; tokens short on ERG in the next 7 days; not a live boxes scan).",
      },
    },
    "/v1/page/addresses": {
      get: {
        summary:
          "Address list; additive sort=erg|tokens|txs|address|first|last dir=asc|desc. Additive band= and kind= (comma lists, OR / union, same CASE as holder_bands; not a COUNT). Empty = All. Mixed band+kind omits total (overlap). Additive firstTxId/lastTxId from address_tx at first/last height (pack join, not a COUNT).",
      },
    },
    "/v1/page/address/{id}": {
      get: {
        summary:
          "Address card header from address_summary (lists=0 default). lists=1 adds txs/boxes. Additive activity=0 skips live box UNION. Additive txCursor keyset on lists (not txOffset). Additive mempoolTxs always (pending txs matched by address ergoTree). Frozen /v1/addresses/{id} still returns the full showcase.",
      },
    },
    "/v1/page/rent": {
      get: {
        summary:
          "Storage rent from indexer unspent boxes. Additive tab=oldest|upcoming, offset/limit. KPIs: due + 24h/7d/30d windows (SigmaSpace). Additive inIndex on each window when the horizon is older than min_height. Additive collected from snapshot_kv.rent_history (recreate/taken heuristic; GET does not scan boxes). Additive collected.series / daily / hourly / forecast / miners / minersDay / minersMonth (weekly, daily, last-7d hourly, 30d becomes-due, all-time pool shares, last-720 / last-21600 from rent_collected + blocks). Additive items[].tokens[] (tokenId + name) from box_assets + tokens for the page ids only. Snapshot keys rent + rent_miners; tape is index ORDER BY creation_height.",
      },
    },
    "/v1/prices/erg": {
      get: {
        summary:
          "ERG/USD from snapshot_kv.market (oracle writer CoinGecko); home is a copy. Additive rank, volume24h, change24h. GET does not call CoinGecko. Official pool price is /v1/prices/erg/oracle.",
      },
    },
    "/v1/prices/erg/oracle": {
      get: {
        summary:
          "Official Erg-USD from snapshot_kv.market (oracle writer), home copy fallback. usd, nanoPerUsd, boxId, height, source=oracle. GET does not scan oracle boxes or call the node.",
      },
    },
    "/v1/platforms": { get: { summary: "Classification platforms" } },
    "/v1/subblocks": { get: { summary: "Ordering-window (synthetic on mainnet)" } },
    "/v1/graph/tx/{id}": { get: { summary: "eUTXO box graph from mempool RAM or indexer. Never the node." } },
    "/v1/metrics": { get: { summary: "Full network metrics dashboard" } },
    "/v1/metrics/charts": { get: { summary: "Block + mempool/fee time series" } },
    "/v1/rent/box/{id}": { get: { summary: "Storage rent report for box" } },
    "/v1/rent/health": {
      get: {
        summary:
          "ergoscan-rent-writer cursors from indexer_state. mode=history|tip, verifyHeight, liveHeight, lag of the tip cursor. GET does not call the node.",
      },
    },
    "/v1/rosen/events": {
      get: {
        summary:
          "Rosen bridge events from schema rosen (writer). Additive ?status=processing|completed|fraud and ?cursor=ts:eventId keyset. Empty items when the writer has not run. GET does not call app.rosen.tech or the node.",
      },
    },
    "/v1/rosen/health": {
      get: { summary: "Rosen KPI snapshot (rosen.kpis). ready=false until the writer has created the schema." },
    },
    "/v1/oracles/health": {
      get: {
        summary:
          "Oracle writer cursor (schema oracle). mode, scanHeight, ready, live per feed. ready=false until pool_snap exists. Official page is /oracles/ergusd. GET does not scan boxes.",
      },
    },
    "/v1/oracles/{slug}": {
      get: {
        summary:
          "Oracle feed from schema oracle. slug=ergusd|erg-usd|xau-erg. Operators are P2PK from R4, not the datapoint P2S. Additive ?range=7d|30d. Empty when the writer has not run. GET does not call byTokenId or the node.",
      },
    },
    "/v1/oracles/{slug}/buyback": {
      get: {
        summary:
          "GORT (xau-erg) or DORT (erg-usd) buyback from the index. Box, LP price, mint top-ups, swaps, returns, chart, tape. Reads that NFT's boxes. Does not call the node.",
      },
    },
    "/v1/search": { get: { summary: "Same as /v1/resolve (index + mempool). Never the node." } },
    "/v1/resolve": {
      get: {
        summary:
          "Canonical path from q. Additive. Height may start with # and use thousand separators (#1 885 000, 1,885,000). Hex hits ordered tx → token → block → box. Address: address_summary PK first, else blake2b256 checksum (P2PK/P2SH/P2S, up to 8000 chars). Token name: exact lower(name), else LIKE. Never the node. Empty hits on miss. Cache like lists.",
      },
    },
    "/v1/stream": {
      get: {
        summary:
          "WS: mempool.add/remove, fees, node.info, chain.tip { height, headerId } from list snapshot",
      },
    },
    "/openapi.json": { get: { summary: "OpenAPI" } },
  },
  components: {
    schemas: {
      TokenInfo: {
        type: "object",
        required: ["id", "boxId", "emissionAmount", "decimals"],
        properties: {
          id: { type: "string" },
          boxId: { type: "string" },
          emissionAmount: { type: "string", description: "Decimal string (safer than official int64)" },
          name: { type: "string", nullable: true },
          description: { type: "string", nullable: true },
          decimals: { type: "integer" },
          type: { type: "string", nullable: true },
        },
      },
      TokenAmount: {
        type: "object",
        required: ["tokenId", "amount", "decimals"],
        properties: {
          tokenId: { type: "string" },
          amount: { type: "string" },
          decimals: { type: "integer" },
          name: { type: "string", nullable: true },
        },
      },
      Balance: {
        type: "object",
        required: ["nanoErgs", "tokens"],
        properties: {
          nanoErgs: { type: "string" },
          tokens: { type: "array", items: { $ref: "#/components/schemas/TokenAmount" } },
        },
      },
      TotalBalance: {
        type: "object",
        required: ["confirmed", "unconfirmed"],
        properties: {
          confirmed: { $ref: "#/components/schemas/Balance" },
          unconfirmed: { $ref: "#/components/schemas/Balance" },
          total: { $ref: "#/components/schemas/Balance" },
          source: { type: "string" },
        },
      },
      EpochInfo: {
        type: "object",
        required: [
          "height",
          "storageFeeFactor",
          "minValuePerByte",
          "maxBlockSize",
          "maxBlockCost",
          "blockVersion",
          "tokenAccessCost",
          "inputCost",
          "dataInputCost",
          "outputCost",
        ],
        properties: {
          height: { type: "integer" },
          storageFeeFactor: { type: "integer" },
          minValuePerByte: { type: "integer" },
          maxBlockSize: { type: "integer" },
          maxBlockCost: { type: "integer" },
          blockVersion: { type: "integer" },
          tokenAccessCost: { type: "integer" },
          inputCost: { type: "integer" },
          dataInputCost: { type: "integer" },
          outputCost: { type: "integer" },
          subblocksPerBlock: { type: "integer" },
        },
      },
      OutputInfo: {
        type: "object",
        required: ["boxId", "value", "mainChain"],
        properties: {
          boxId: { type: "string" },
          transactionId: { type: "string", nullable: true },
          blockId: { type: "string", nullable: true },
          value: { type: "string" },
          index: { type: "integer", nullable: true },
          globalIndex: { type: "integer", nullable: true },
          creationHeight: { type: "integer", nullable: true },
          settlementHeight: { type: "integer", nullable: true },
          ergoTree: { type: "string", nullable: true },
          address: { type: "string", nullable: true },
          assets: {
            type: "array",
            items: {
              type: "object",
              properties: { tokenId: { type: "string" }, amount: { type: "string" } },
            },
          },
          additionalRegisters: { type: "object", additionalProperties: { type: "string" } },
          spentTransactionId: { type: "string", nullable: true },
          mainChain: { type: "boolean" },
        },
      },
      Items_OutputInfo: {
        type: "object",
        properties: {
          items: { type: "array", items: { $ref: "#/components/schemas/OutputInfo" } },
          total: { type: "integer" },
          offset: { type: "integer" },
          limit: { type: "integer" },
        },
      },
      Items_TokenInfo: {
        type: "object",
        properties: {
          items: { type: "array", items: { $ref: "#/components/schemas/TokenInfo" } },
          total: { type: "integer" },
          offset: { type: "integer" },
          limit: { type: "integer" },
        },
      },
      TxIdResponse: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
      NetworkState: {
        type: "object",
        properties: {
          lastBlockId: { type: "string", nullable: true },
          height: { type: "integer", nullable: true },
          maxBoxGix: { type: "integer", nullable: true },
          maxTxGix: { type: "integer", nullable: true },
          params: { $ref: "#/components/schemas/EpochInfo" },
          network: { type: "string" },
        },
      },
      NetworkStats: {
        type: "object",
        properties: {
          uniqueAddressesNum: { type: "integer" },
          hashRate: { type: "number", nullable: true },
          transactionAverage: { type: "number", nullable: true },
        },
      },
    },
  },
};
