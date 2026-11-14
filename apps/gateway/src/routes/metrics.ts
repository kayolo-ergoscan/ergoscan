/**
 * Operator metrics: node snapshot, charts, per-box rent.
 */
import type { Express } from "express";
import {
  computeBoxRent,
  DEFAULT_RENT_PARAMS,
  ergoBoxSizeOf,
  type BallProps,
  type BlockEta,
  type FeeHistogram,
  type NetworkId,
  type NodeInfoLite,
  type RawTx,
} from "@ergoscan/shared";
import { cacheNoStore } from "../lib/httpCache.js";
import {
  chartsSummary,
  getBlockSeries,
  getMempoolDay,
  getMempoolFine,
} from "../lib/history.js";
import { getBoxById } from "../lib/indexDb.js";

const STORAGE_PERIOD = DEFAULT_RENT_PARAMS.storagePeriodBlocks;
const BLOCKS_PER_YEAR = 262_980;

export type MetricsDeps = {
  getBalls: () => Map<string, BallProps>;
  getRawMempool: () => Map<string, RawTx>;
  getNodeInfo: () => NodeInfoLite;
  getNodeInfoRaw: () => Record<string, unknown>;
  getFeeHist: () => FeeHistogram;
  getBlockEta: () => BlockEta;
  network: NetworkId;
  mock: () => boolean;
};

function byCategory(balls: Iterable<BallProps>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of balls) {
    const k = b.category || "unknown";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function asNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function registerMetricsRoutes(app: Express, deps: MetricsDeps): void {
  app.get("/v1/metrics", async (_req, res) => {
    cacheNoStore(res);
    const balls = [...deps.getBalls().values()];
    const fee = deps.getFeeHist();
    const eta = deps.getBlockEta();
    const infoLite = deps.getNodeInfo();
    const info = deps.getNodeInfoRaw();
    const params = (info.parameters as Record<string, unknown>) ?? {};
    const storageFeeFactor = asNum(params.storageFeeFactor) ?? DEFAULT_RENT_PARAMS.storageFeeFactor;
    const minValuePerByte = asNum(params.minValuePerByte) ?? DEFAULT_RENT_PARAMS.minValuePerByte;
    const avgMs = eta.avgIntervalMs || 120_000;
    const avgSec = avgMs / 1000;
    const difficulty = asNum(info.difficulty);
    const hashRateEstimate =
      difficulty != null && avgSec > 0 ? difficulty / avgSec : null;

    const totalSize = balls.reduce((s, b) => s + b.size, 0);
    const totalFees = balls.reduce((s, b) => s + b.fee, 0);

    res.json({
      ts: Date.now(),
      network: deps.network,
      mock: deps.mock(),
      node: {
        name: String(info.name ?? infoLite.name ?? ""),
        appVersion: String(info.appVersion ?? infoLite.appVersion ?? ""),
        stateType: info.stateType ?? null,
        isExplorer: Boolean(info.isExplorer),
        isMining: Boolean(info.isMining ?? infoLite.isMining),
        eip27Supported: Boolean(info.eip27Supported),
        eip37Supported: Boolean(info.eip37Supported),
        currentTime: info.currentTime ?? Date.now(),
      },
      chain: {
        fullHeight: info.fullHeight ?? infoLite.fullHeight ?? null,
        headersHeight: info.headersHeight ?? infoLite.headersHeight ?? null,
        maxPeerHeight: info.maxPeerHeight ?? null,
        bestFullHeaderId: info.bestFullHeaderId ?? null,
        bestHeaderId: info.bestHeaderId ?? null,
        previousFullHeaderId: info.previousFullHeaderId ?? null,
        genesisBlockId: info.genesisBlockId ?? null,
        stateRoot: info.stateRoot ?? null,
        stateVersion: info.stateVersion ?? null,
        difficulty: info.difficulty ?? null,
        fullBlocksScore: info.fullBlocksScore ?? null,
        headersScore: info.headersScore ?? null,
        indexedHeight: info.indexedHeight ?? info.fullHeight ?? null,
        indexLag: asNum(info.fullHeight) != null && asNum(info.indexedHeight) != null
          ? Number(info.fullHeight) - Number(info.indexedHeight)
          : 0,
      },
      peers: {
        peersCount: Number(info.peersCount ?? infoLite.peersCount ?? 0),
        connected: Number(info.peersCount ?? infoLite.peersCount ?? 0),
        blacklisted: Number(info.blacklistedPeersCount ?? 0),
        lastSeenMessageTime: info.lastIncomingMessageTime ?? info.maxPeerHeight ?? null,
      },
      mempool: {
        unconfirmedCount: Number(info.unconfirmedCount ?? balls.length),
        balls: balls.length,
        totalSize,
        totalFees,
        byCategory: byCategory(balls),
        lastMemPoolUpdateTime: info.lastMemPoolUpdateTime ?? null,
        p50FeeRate: fee.p50,
        p90FeeRate: fee.p90,
        recommend: fee.recommend,
      },
      timing: {
        avgBlockIntervalMs: eta.avgIntervalMs,
        avgBlockIntervalSec: Math.round(avgSec) || eta.nextEtaSec,
        samples: eta.samples,
        nextBlockEtaSec: eta.nextEtaSec,
        hashRateEstimate,
        note: "hashRateEstimate is difficulty/blockTime (indicative, not consensus hashrate product)",
      },
      protocol: {
        ...params,
        storagePeriodBlocks: STORAGE_PERIOD,
        orderingWindowNote:
          "subblocksPerBlock is a protocol constant; mainnet has no live Matrix IB stream",
      },
      rent: {
        storagePeriodBlocks: STORAGE_PERIOD,
        storageFeeFactor,
        minValuePerByte,
        storagePeriodYearsApprox: STORAGE_PERIOD / BLOCKS_PER_YEAR,
        formula: "rent ≈ periodsElapsed * storageFeeFactor * boxSizeBytes (nanoERG)",
      },
    });
  });

  app.get("/v1/metrics/charts", (_req, res) => {
    cacheNoStore(res);
    const fee = deps.getFeeHist();
    const balls = deps.getBalls();
    res.json({
      ts: Date.now(),
      blocks: getBlockSeries(),
      mempool: getMempoolFine(),
      mempool24h: getMempoolDay(),
      summary: chartsSummary(balls.size, fee.p50, fee.p90),
      note: "Block series from node headers. Mempool fine ~2h @poll; mempool24h ~30s samples up to 24h (grows after gateway uptime).",
    });
  });

  app.get("/v1/rent/box/:id", async (req, res) => {
    const id = req.params.id;
    if (!/^[0-9a-fA-F]{64}$/.test(id)) {
      return res.status(400).json({ error: "invalid_box_id" });
    }
    try {
      const info = deps.getNodeInfoRaw();
      const tip = Number(info.fullHeight ?? info.headersHeight ?? deps.getNodeInfo().fullHeight ?? 0);
      const params = (info.parameters as Record<string, number>) ?? {};
      const rentParams = {
        storagePeriodBlocks: STORAGE_PERIOD,
        storageFeeFactor: Number(params.storageFeeFactor ?? DEFAULT_RENT_PARAMS.storageFeeFactor),
        minValuePerByte: Number(params.minValuePerByte ?? DEFAULT_RENT_PARAMS.minValuePerByte),
      };
      const box = await getBoxById(id);
      if (!box) {
        cacheNoStore(res);
        return res.status(404).json({ error: "not_found" });
      }
      const regs = box.additionalRegisters ?? {};
      const sizeBytes = ergoBoxSizeOf({ ...box, additionalRegisters: regs });
      let valueNano = 0;
      try {
        const b = BigInt(String(box.value ?? "0"));
        valueNano =
          b > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(b);
      } catch {
        valueNano = Number(box.value ?? 0) || 0;
      }
      const rent = computeBoxRent({
        creationHeight: box.creationHeight,
        currentHeight: tip,
        valueNano,
        sizeBytes,
        params: rentParams,
      });
      cacheNoStore(res);
      res.json({
        boxId: box.boxId ?? id,
        source: "indexer",
        address: box.address ?? null,
        rent,
      });
    } catch (e) {
      res.status(404).json({ error: "not_found", detail: String(e) });
    }
  });
}
