/**
 * Market & discovery routes: rich list, token search/price, recent txs.
 */
import type { Express } from "express";
import {
  fetchRichList,
  fetchErgMarket,
  fetchOracleErgUsd,
  priceForToken,
  searchTokensByName,
} from "../lib/market.js";
import type { RawTx } from "@ergoscan/shared";
import { estimateFee, txToBall } from "@ergoscan/shared";
import { getConfirmedRecentTxs, parseTxTapeCursor } from "../lib/snapshots.js";
import { cacheList, cacheNoStore } from "../lib/httpCache.js";
import {
  listTokensCatalog,
  tokensSearchLite,
  type TokenCatalogDir,
  type TokenCatalogSort,
} from "../lib/indexDb.js";
import { mapTokenInfo } from "../lib/explorerCompat.js";
import { loadPriceTapeErg } from "../lib/price-tape.js";

export type MarketDeps = {
  getRawMempool: () => Map<string, RawTx>;
};

export function registerMarketRoutes(app: Express, deps: MarketDeps) {
  // Additive catalog. Must be before /v1/tokens/:id in explorer.
  app.get("/v1/tokens", async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 25) || 25));
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
    const sortRaw = String(req.query.sort ?? "holders");
    const sort = (
      ["last", "first", "holders", "supply", "txs", "name"].includes(sortRaw) ? sortRaw : "holders"
    ) as TokenCatalogSort;
    const dir: TokenCatalogDir = String(req.query.dir ?? "desc") === "asc" ? "asc" : "desc";
    const q = String(req.query.q ?? "").trim();
    const page = await listTokensCatalog({ limit, offset, sort, dir, q });
    if (!page) {
      cacheNoStore(res);
      res.status(503).json({ error: "stale", stale: true });
      return;
    }
    // Index only. names=0 kept as a no-op (old clients). Never node on this GET.
    cacheList(res);
    res.json(page);
  });

  // ── Rich list ───────────────────────────────────────────────────────────
  app.get("/v1/richlist", async (req, res) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50) || 50));
      const p2pkOnly =
        req.query.p2pk === "1" ||
        req.query.p2pkOnly === "1" ||
        req.query.p2pk === "true";
      const data = await fetchRichList(limit, p2pkOnly);
      cacheList(res);
      res.json(data);
    } catch (e) {
      cacheNoStore(res);
      res.status(502).json({ error: "richlist_unavailable", detail: String(e) });
    }
  });

  // ── ERG price ───────────────────────────────────────────────────────────
  app.get("/v1/prices/erg", async (_req, res) => {
    try {
      const [p, tapeErg] = await Promise.all([fetchErgMarket(), loadPriceTapeErg()]);
      const usd = p.usd;
      const tape =
        usd > 0
          ? tapeErg.map((row) => ({
              tokenId: row.tokenId,
              symbol: row.symbol,
              priceUsd: row.priceErg * usd,
              changePct: row.changePct,
            }))
          : [];
      res.json({ asset: "ERG", ...p, ts: Date.now(), tape });
    } catch (e) {
      res.status(502).json({ error: "price_unavailable", detail: String(e) });
    }
  });

  /** EIP-23 from home snapshot. GET does not scan oracle boxes. */
  app.get("/v1/prices/erg/oracle", async (_req, res) => {
    try {
      const p = await fetchOracleErgUsd();
      res.json({
        asset: "ERG",
        usd: p.usd,
        nanoPerUsd: p.nano,
        boxId: p.boxId,
        height: p.height,
        source: "oracle",
        ts: Date.now(),
      });
    } catch (e) {
      res.status(502).json({ error: "price_unavailable", detail: String(e) });
    }
  });

  // ── Token search by name ────────────────────────────────────────────────
  app.get("/v1/tokens/search", async (req, res) => {
    const q = String(req.query.q ?? req.query.query ?? "").trim();
    if (!q) return res.json({ q, items: [] });
    try {
      const limit = Math.min(40, Math.max(1, Number(req.query.limit ?? 24) || 24));
      // P2-8: merge Phase 2 indexer hits first (window), then external/name sources
      // tokens table only — searchTokensFromIndex COUNTs box_assets and can trip the pool.
      const lite = (await tokensSearchLite(q, limit)) ?? [];
      const external = await searchTokensByName(q, limit).catch(
        () => [] as Awaited<ReturnType<typeof searchTokensByName>>
      );
      const seen = new Set<string>();
      const items: Array<Record<string, unknown>> = [];
      for (const h of lite) {
        if (seen.has(h.tokenId)) continue;
        seen.add(h.tokenId);
        items.push({
          tokenId: h.tokenId,
          name: h.name,
          decimals: h.decimals ?? 0,
          emissionAmount: h.emission,
          boxId: h.boxId,
          source: "indexer",
        });
        if (items.length >= limit) break;
      }
      for (const h of external) {
        const id = String((h as { tokenId?: string }).tokenId ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        items.push({ ...h, source: (h as { source?: string }).source ?? "external" });
        if (items.length >= limit) break;
      }
      res.json({
        q,
        query: q,
        items,
        total: items.length,
        count: items.length,
        explorerItems: lite.map(mapTokenInfo),
        sources: {
          indexer: lite.length,
          external: external.length,
        },
      });
    } catch (e) {
      res.status(502).json({ error: "token_search_failed", detail: String(e), q, items: [] });
    }
  });

  // ── Token price ─────────────────────────────────────────────────────────
  app.get("/v1/tokens/:id/price", async (req, res) => {
    try {
      const quote = await priceForToken(req.params.id);
      res.json(quote);
    } catch (e) {
      res.status(502).json({ error: "price_unavailable", detail: String(e) });
    }
  });

  // ── Recent confirmed transactions ───────────────────────────────────────
  app.get("/v1/transactions/recent", async (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 25) || 25));
    const offset = Math.max(0, Math.floor(Number(req.query.offset ?? 0) || 0));
    const cursor = parseTxTapeCursor(req.query.cursor);
    const confirmed = await getConfirmedRecentTxs(limit, cursor);
    if (!confirmed) {
      cacheNoStore(res);
      res.status(503).json({ error: "stale", stale: true });
      return;
    }

    const includeMempool =
      cursor == null &&
      offset === 0 &&
      (req.query.mempool === "1" || req.query.mempool === "true");
    const mempoolItems = includeMempool
      ? [...deps.getRawMempool().values()]
          .slice(0, 15)
          .map((mem) => {
            const ball = txToBall(mem);
            return {
              id: mem.id,
              index: null,
              inclusionHeight: null,
              timestamp: ball.firstSeen,
              size: mem.size ?? ball.size,
              fee: estimateFee(mem),
              feeRate: ball.feeRate,
              category: ball.category,
              color: ball.color,
              platform: ball.platform ?? null,
              inputs: mem.inputs?.length ?? 0,
              outputs: mem.outputs?.length ?? 0,
              value: ball.value,
              confirmed: false,
            };
          })
          .sort((a, b) => b.timestamp - a.timestamp)
      : [];

    cacheList(res);
    res.json({
      items: [...mempoolItems, ...confirmed.items],
      offset,
      limit,
      hasMore: confirmed.hasMore,
      nextCursor: confirmed.hasMore ? confirmed.nextCursor : null,
      maxIndex: null,
      ts: Date.now(),
      source: includeMempool ? `${confirmed.source}+mempool` : confirmed.source,
      height: confirmed.meta.height,
      updatedAt: confirmed.meta.updatedAt,
    });
  });
}
