/**
 * ErgoScan realtime gateway — mempool → balls → WS + REST
 * Architecture: sub-blocks, seal, box graph
 */
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  buildFeeHistogram,
  estimateFee,
  generateMockBalls,
  asTxShape,
  txToBall,
  pickTxAction,
  pickTxLock,
  type BallProps,
  type BlockEta,
  type FeeHistogram,
  type MempoolSnapshot,
  type NetworkId,
  type NodeInfoLite,
  type RawTx,
  type WsServerEvent,
} from "@ergoscan/shared";
import { createNodeClient } from "./lib/node.js";
import { stampTemplateHashes } from "./lib/txTemplateHash.js";
import { SubblockEngine } from "./lib/subblocks.js";
import { SealWatcher } from "./lib/seal.js";
import { registerExplorerRoutes } from "./routes/explorer.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerChainRoutes } from "./routes/chain.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerMarketRoutes } from "./routes/market.js";
import { registerDefiRoutes } from "./routes/defi.js";
import { registerRosenRoutes } from "./routes/rosen.js";
import { registerLithosRoutes } from "./routes/lithos.js";
import { registerOracleRoutes } from "./routes/oracles.js";
import { registerBuybackRoutes } from "./routes/buyback.js";
import { registerNamesRoutes } from "./routes/names.js";
import { registerCompatRoutes } from "./routes/compat.js";
import { registerGraphqlRoutes } from "./routes/graphql.js";
import { mapEpochParams } from "./lib/explorerCompat.js";
import { peekChainTip, type ChainTip } from "./lib/snapshots.js";
import { startOrbitPeerCache } from "./lib/orbit-peers.js";
import { cacheList, cacheNoStore } from "./lib/httpCache.js";
import { resolveFromIndex } from "./lib/resolve.js";
import { isErgoAddressChecksumValid } from "./lib/ergoAddress.js";
import { matrixConfigFromEnv } from "./lib/matrix.js";
import { pushMempoolSample, pushBlockPoints } from "./lib/history.js";
import { addressesFromTx } from "./lib/address.js";
import { txWithTreeAddresses } from "./lib/ergoAddress.js";
import {
  cachedDexLockHints,
  cachedSpectrumPoolNfts,
  readGixWatermark,
  refreshSpectrumPoolNfts,
} from "./lib/indexDb.js";
import { warmErgoTreeParser } from "./lib/ergoTree.js";
import { startTemplateHashFill } from "./lib/templateHashFill.js";
import { toPublicHealth, type OpsHealth } from "./lib/public-health.js";
import {
  allowStreamOrigin,
  headerOrigin,
  isApiContour,
  siteCorsReflect,
} from "./lib/siteOrigin.js";

const PORT = Number(process.env.PORT ?? 4400);
const BIND = process.env.BIND || "127.0.0.1";
const ERGO_NODE_URL = (process.env.ERGO_NODE_URL ?? "http://127.0.0.1:9053").replace(/\/$/, "");
const NETWORK = (process.env.NETWORK ?? "mainnet") as NetworkId;
const POLL_MS = Number(process.env.POLL_MS ?? 2500);
/** Force synthetic mempool always */
const FORCE_MOCK = process.env.MOCK === "1" || process.env.MOCK === "true";
/** When real mempool empty, fill with demo balls (default off) */
const MOCK_FALLBACK =
  process.env.MOCK_FALLBACK === "1" || process.env.MOCK_FALLBACK === "true";
const BLOCKS_LIMIT = Number(process.env.BLOCKS_LIMIT ?? 24);
/** Full unconfirmed dump can take 5–15s on busy node — do not undercut that */
const MEMPOOL_TIMEOUT_MS = Number(process.env.MEMPOOL_TIMEOUT_MS ?? 20_000);
/** Resolve ergoTree→address via node utils (expensive). Default off on shared node. */
const ENRICH_ADDRESSES =
  process.env.ENRICH_ADDRESSES === "1" || process.env.ENRICH_ADDRESSES === "true";

// ── single-flight + soft backoff (shared ergonode REST) ─────────────
let pollInFlight = false;
/** Consecutive empty unconfirmed dumps while balls are still on screen. */
let emptyKeep = 0;
let infoInFlight = false;
let etaInFlight = false;
let pollBackoffMs = 0;
let pollFailStreak = 0;

const node = createNodeClient(ERGO_NODE_URL);
const subblocks = new SubblockEngine();
const seals = new SealWatcher(node);
const orbitPeers = startOrbitPeerCache((path, timeoutMs) => node.get(path, timeoutMs));

const app = express();
if (isApiContour()) {
  app.use(cors());
} else {
  app.use((_req, res, next) => {
    const prev = res.getHeader("Vary");
    if (!prev) res.setHeader("Vary", "Origin");
    else if (!String(prev).toLowerCase().includes("origin")) {
      res.setHeader("Vary", `${String(prev)}, Origin`);
    }
    next();
  });
  app.use(
    cors({
      origin(origin, callback) {
        const reflected = siteCorsReflect(origin);
        callback(null, reflected === false ? false : reflected);
      },
    })
  );
}
app.use(express.json());

/**
 * /api/v1/* is an alias of /v1/* (frozen public API).
 * Gateway primary paths are /v1/*.
 */
app.use((req, _res, next) => {
  if (req.url === "/api/v1" || req.url.startsWith("/api/v1/") || req.url.startsWith("/api/v1?")) {
    req.url = req.url.replace(/^\/api\/v1/, "/v1");
  }
  next();
});

// Simple in-memory rate limit (per IP): protect public API
const RL_WINDOW_MS = 60_000;
const RL_MAX = Number(process.env.RATE_LIMIT_PER_MIN ?? 180);
/** Caddy always sets X-Forwarded-For, so a loopback request without it is internal (page SSR, ops scripts). */
const RL_INTERNAL_MAX = Number(process.env.RATE_LIMIT_INTERNAL_PER_MIN ?? 3000);
const rlHits = new Map<string, { n: number; reset: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [key, row] of rlHits) {
    if (now > row.reset) rlHits.delete(key);
  }
}, RL_WINDOW_MS).unref();

function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  return addr === "::1" || addr.startsWith("127.") || addr.startsWith("::ffff:127.");
}

app.use((req, res, next) => {
  if (
    req.path === "/v1/stream" ||
    req.path.startsWith("/v1/media/") ||
    req.path.startsWith("/v1/ops/")
  ) {
    return next();
  }
  // API-contour GraphQL has its own read budget. The shared 120 cap turned a
  // wallet page into an empty list.
  if (
    process.env.API_CONTOUR === "1" &&
    req.method === "POST" &&
    (req.path === "/graphql" || req.path === "/v1/graphql")
  ) {
    return next();
  }
  const forwarded = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim();
  const internal = !forwarded && isLoopback(req.socket.remoteAddress);
  const ip = internal ? "internal" : forwarded || req.socket.remoteAddress || "unknown";
  const max = internal ? RL_INTERNAL_MAX : RL_MAX;
  const now = Date.now();
  let row = rlHits.get(ip);
  if (!row || now > row.reset) {
    row = { n: 0, reset: now + RL_WINDOW_MS };
    rlHits.set(ip, row);
  }
  row.n += 1;
  res.setHeader("X-RateLimit-Limit", String(max));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - row.n)));
  if (row.n > max) {
    res.status(429).json({ error: "rate_limited", retryAfterSec: Math.ceil((row.reset - now) / 1000) });
    return;
  }
  next();
});

/** Every route that takes an address in the path. A failed checksum is a typo, not an empty wallet. */
const ADDRESS_PATHS = [
  /^\/v1\/addresses\/([^/]+)(?:\/|$)/,
  /^\/v1\/page\/address\/([^/]+)$/,
  /^\/v1\/boxes\/(?:unspent\/(?:unconfirmed\/)?)?byAddress\/([^/]+)$/,
  /^\/v1\/mempool\/transactions\/byAddress\/([^/]+)$/,
];

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  for (const re of ADDRESS_PATHS) {
    const m = re.exec(req.path);
    if (!m) continue;
    let address = m[1] ?? "";
    try {
      address = decodeURIComponent(address);
    } catch {
      /* keep raw */
    }
    if (isErgoAddressChecksumValid(address.trim())) return next();
    cacheNoStore(res);
    res.status(400).json({ error: "bad_address", reason: "checksum" });
    return;
  }
  next();
});

let balls = new Map<string, BallProps>();
let feeHist: FeeHistogram = {
  ts: Date.now(),
  buckets: [],
  p50: 1000,
  p90: 5000,
  recommend: { economy: 500, normal: 1000, turbo: 5000 },
};
let blockEta: BlockEta = {
  avgIntervalMs: 120_000,
  lastBlockTs: Date.now(),
  nextEtaMs: 120_000,
  nextEtaSec: 120,
  samples: 0,
};
let nodeInfo: NodeInfoLite = { network: NETWORK };
/** Last /info blob from the background poll. User GETs read this, not :9053. */
let nodeInfoRaw: Record<string, unknown> = {};
let usingMock = FORCE_MOCK;
let lastPollOk = false;
let lastError: string | null = null;
/** raw mempool txs for detail endpoints */
const rawMempool = new Map<string, RawTx>();

const clients = new Set<WebSocket>();

function broadcast(ev: WsServerEvent) {
  const raw = JSON.stringify(ev);
  for (const c of clients) {
    if (c.readyState === 1) c.send(raw);
  }
}

let lastChainTip: ChainTip | null = null;

async function tickChainTip() {
  const tip = await peekChainTip();
  if (!tip) return;
  const same =
    lastChainTip != null &&
    lastChainTip.height === tip.height &&
    lastChainTip.headerId === tip.headerId;
  if (same) return;
  lastChainTip = tip;
  broadcast({ type: "chain.tip", data: tip } as WsServerEvent);
}

function snapshot(): MempoolSnapshot {
  const list = [...balls.values()];
  return {
    ts: Date.now(),
    network: NETWORK,
    balls: list,
    count: list.length,
    totalSize: list.reduce((s, b) => s + b.size, 0),
    totalFees: list.reduce((s, b) => s + b.fee, 0),
  };
}

function withEta(h: Omit<FeeHistogram, "ts" | "eta"> | ReturnType<typeof buildFeeHistogram>): FeeHistogram {
  // recompute ETA countdown from last sealed block
  const now = Date.now();
  const elapsed = Math.max(0, now - blockEta.lastBlockTs);
  const nextEtaMs = Math.max(0, blockEta.avgIntervalMs - elapsed);
  blockEta = { ...blockEta, nextEtaMs, nextEtaSec: Math.floor(nextEtaMs / 1000) };
  return { ts: now, ...h, eta: { ...blockEta } };
}

function dropSealedBalls(ids: readonly string[]) {
  const drop = ids.filter((id) => balls.has(id));
  if (!drop.length) return;
  for (const id of drop) {
    balls.delete(id);
    rawMempool.delete(id);
    broadcast({ type: "mempool.remove", data: { id, reason: "confirmed" } });
  }
  recomputeFees();
  const list = [...balls.values()];
  pushMempoolSample({
    ts: Date.now(),
    count: list.length,
    totalSize: list.reduce((s, b) => s + b.size, 0),
    totalFees: list.reduce((s, b) => s + b.fee, 0),
    p50: feeHist.p50,
    p90: feeHist.p90,
    height: nodeInfo.fullHeight ?? null,
  });
  broadcast({ type: "mempool.snapshot", data: snapshot() });
  broadcast({ type: "fees.histogram", data: feeHist });
}

function recomputeFees() {
  const list = [...balls.values()];
  const h = buildFeeHistogram(list);
  feeHist = withEta(h);
  for (const b of list) {
    balls.set(b.id, {
      ...b,
      color: b.color,
    });
  }
}

async function refreshBlockEta(): Promise<void> {
  if (etaInFlight) return;
  etaInFlight = true;
  try {
    const headers = await nodeGet<{ id: string; height: number; timestamp: number }[]>(
      "/blocks/lastHeaders/12",
      6000
    );
    if (!Array.isArray(headers) || headers.length < 2) return;
    // sort newest-first by height (API order can vary)
    const sorted = [...headers].sort((a, b) => b.height - a.height);
    const intervals: number[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const d = Math.abs(sorted[i].timestamp - sorted[i + 1].timestamp);
      if (d > 5_000 && d < 30 * 60_000) intervals.push(d); // ignore micro/crazy gaps
    }
    if (!intervals.length) return;
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const lastBlockTs = sorted[0].timestamp;
    const elapsed = Math.max(0, Date.now() - lastBlockTs);
    const nextEtaMs = Math.max(0, avg - elapsed);
    blockEta = {
      avgIntervalMs: Math.round(avg),
      lastBlockTs,
      nextEtaMs: Math.round(nextEtaMs),
      nextEtaSec: Math.floor(nextEtaMs / 1000),
      samples: intervals.length,
    };
    feeHist = { ...feeHist, ts: Date.now(), eta: { ...blockEta } };
    broadcast({ type: "fees.histogram", data: feeHist });
    // keep sub-block planner aligned with tip + interval
    const tip = nodeInfo.fullHeight ?? nodeInfo.headersHeight;
    if (tip != null) {
      subblocks.resync({
        tipHeight: tip,
        lastBlockTs: blockEta.lastBlockTs,
        avgIntervalMs: blockEta.avgIntervalMs,
      });
    }
    // chart series from recent headers (richer set) — only every other success to cut load
    try {
      const rich = await nodeGet<
        { height: number; timestamp: number; difficulty?: string | number; size?: number }[]
      >("/blocks/lastHeaders/24", 8000);
      if (Array.isArray(rich)) pushBlockPoints(rich);
    } catch {
      pushBlockPoints(sorted.map((h) => ({ ...h, difficulty: undefined, size: undefined })));
    }
  } catch {
    /* non-fatal */
  } finally {
    etaInFlight = false;
  }
}

/**
 * Parse Ergo node JSON without JS Number precision loss on large amounts.
 * Integers with 16+ digits become strings (LP/token raw, some nanoERG).
 */
function parseErgoJson<T = unknown>(text: string): T {
  const quoted = text.replace(
    /([:\[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g,
    '$1"$2"'
  );
  return JSON.parse(quoted) as T;
}

async function nodeGet<T = unknown>(path: string, timeoutMs = 8000): Promise<T> {
  const res = await fetch(`${ERGO_NODE_URL}${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`node ${res.status} ${path} ${text.slice(0, 120)}`);
  }
  const text = await res.text();
  return parseErgoJson<T>(text);
}

async function nodePost<T = unknown>(path: string, body: unknown, timeoutMs = 10000): Promise<T> {
  const res = await fetch(`${ERGO_NODE_URL}${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`node ${res.status} POST ${path} ${text.slice(0, 120)}`);
  }
  const text = await res.text();
  return parseErgoJson<T>(text);
}

async function fetchNodeInfo(): Promise<void> {
  if (infoInFlight) return;
  infoInFlight = true;
  try {
    const j = await nodeGet<Record<string, unknown>>("/info", 5000);
    nodeInfoRaw = j;
    nodeInfo = {
      network: NETWORK,
      name: String(j.name ?? ""),
      headersHeight: (j.headersHeight as number) ?? null,
      fullHeight: (j.fullHeight as number) ?? null,
      peersCount: Number(j.peersCount ?? 0),
      isMining: Boolean(j.isMining),
      appVersion: String(j.appVersion ?? ""),
    };
    const params = j.parameters as { subblocksPerBlock?: number } | undefined;
    // slots constant from protocol params — visual only on mainnet (NOT Matrix IBs)
    if (params?.subblocksPerBlock) {
      subblocks.setParams(params.subblocksPerBlock, "synthetic");
    }
    lastError = null;
    broadcast({ type: "node.info", data: nodeInfo });

    // seal detection on tip advance
    const seal = await seals.check(nodeInfo.fullHeight);
    if (seal) {
      broadcast({ type: "block.sealed", data: seal });
      dropSealedBalls(seal.txIds);
      // force planner window to new tip
      subblocks.resync({
        tipHeight: seal.height,
        lastBlockTs: seal.timestamp,
        avgIntervalMs: blockEta.avgIntervalMs,
      });
    }
  } catch (e) {
    lastError = String(e);
  } finally {
    infoInFlight = false;
  }
}

function tickSubblocks() {
  for (const p of subblocks.tick()) {
    broadcast({ type: "subblock.pulse", data: p });
  }
}

async function pollMempool(): Promise<void> {
  // Never stack polls: overlapping unconfirmed dumps + address enrich flood :9053
  if (pollInFlight) return;
  if (pollBackoffMs > 0 && Date.now() < pollBackoffMs) return;
  if (FORCE_MOCK) {
    applyMock();
    return;
  }
  pollInFlight = true;
  try {
    const txs = await nodeGet<RawTx[]>(
      "/transactions/unconfirmed",
      MEMPOOL_TIMEOUT_MS
    );
    lastPollOk = true;
    lastError = null;
    pollFailStreak = 0;
    pollBackoffMs = 0;

    if (!Array.isArray(txs) || txs.length === 0) {
      if (balls.size > 0 && emptyKeep < 3) {
        emptyKeep += 1;
        // Node often returns [] for a poll or two while it applies a block.
        // That is not an empty mempool. Wiping here rebirths every stayer.
        console.warn("[gateway] unconfirmed empty; keep", balls.size, emptyKeep);
        return;
      }
      emptyKeep = 0;
      rawMempool.clear();
      if (MOCK_FALLBACK) {
        applyMock();
        return;
      }
      usingMock = false;
      if (balls.size > 0) {
        for (const id of balls.keys()) {
          broadcast({ type: "mempool.remove", data: { id, reason: "confirmed" } });
        }
      }
      balls = new Map();
      recomputeFees();
      pushMempoolSample({
        ts: Date.now(),
        count: 0,
        totalSize: 0,
        totalFees: 0,
        p50: feeHist.p50,
        p90: feeHist.p90,
        height: nodeInfo.fullHeight ?? null,
      });
      broadcast({ type: "mempool.snapshot", data: snapshot() });
      broadcast({ type: "fees.histogram", data: feeHist });
      return;
    }

    emptyKeep = 0;
    usingMock = false;
    rawMempool.clear();
    await refreshSpectrumPoolNfts();
    // Node dump has trees, not Base58. Encode locally so v3 (88/fee) sees addresses.
    // Do not turn on ENRICH_ADDRESSES.
    const filled = txs.map((t) => txWithTreeAddresses(t, NETWORK));
    await stampTemplateHashes(filled.flatMap((t) => [...(t.inputs ?? []), ...(t.outputs ?? [])]));
    const next = new Map<string, BallProps>();
    const prelim = filled.map((t) => txToBall(t, balls.get(t.id)?.firstSeen ?? Date.now()));
    const hist = buildFeeHistogram(prelim);

    // Address enrich hits /utils/ergoTreeToAddress per tree — multiplies REST load.
    // Soft mode (default): only addresses already on the tx + previous ball cache.
    const enrich = await Promise.all(
      filled.map(async (tx) => {
        if (!tx?.id) return null;
        rawMempool.set(tx.id, tx);
        const prev = balls.get(tx.id);
        const ball = txToBall(tx, prev?.firstSeen ?? Date.now(), hist.p90);
        let addresses = ball.addresses;
        if (ENRICH_ADDRESSES && !addresses?.length) {
          try {
            addresses = await addressesFromTx(tx, nodeGet, nodePost);
          } catch {
            addresses = undefined;
          }
        }
        // reuse previous resolved addresses if new resolve empty
        if (!addresses?.length && prev?.addresses?.length) {
          addresses = prev.addresses;
        }
        const lock = pickTxLock(tx, cachedDexLockHints());
        const action = pickTxAction(
          { inputs: tx.inputs, outputs: tx.outputs },
          asTxShape(ball.category)
        );
        return {
          ball: {
            ...ball,
            addresses: addresses?.length ? addresses : undefined,
            platform: lock?.id ?? ball.platform,
            action: action ?? undefined,
          },
          isNew: !prev,
        };
      })
    );
    for (const row of enrich) {
      if (!row) continue;
      next.set(row.ball.id, row.ball);
      if (row.isNew) broadcast({ type: "mempool.add", data: row.ball });
    }
    for (const id of balls.keys()) {
      if (!next.has(id)) {
        broadcast({ type: "mempool.remove", data: { id, reason: "confirmed" } });
      }
    }
    balls = next;
    feeHist = withEta(hist);
    pushMempoolSample({
      ts: Date.now(),
      count: balls.size,
      totalSize: [...balls.values()].reduce((s, b) => s + b.size, 0),
      totalFees: [...balls.values()].reduce((s, b) => s + b.fee, 0),
      p50: feeHist.p50,
      p90: feeHist.p90,
      height: nodeInfo.fullHeight ?? null,
    });
    broadcast({ type: "mempool.snapshot", data: snapshot() });
    broadcast({ type: "fees.histogram", data: feeHist });
  } catch (e) {
    lastPollOk = false;
    lastError = String(e);
    pollFailStreak += 1;
    // 6s → 12s → 24s → cap 60s (do not hammer stalled REST)
    const wait = Math.min(60_000, POLL_MS * Math.pow(2, Math.min(pollFailStreak, 4)));
    pollBackoffMs = Date.now() + wait;
    if (FORCE_MOCK || (MOCK_FALLBACK && balls.size === 0)) applyMock();
    console.warn("[gateway] poll failed", String(e), `backoff=${wait}ms`);
  } finally {
    pollInFlight = false;
  }
}

function applyMock() {
  usingMock = true;
  const list = generateMockBalls(52);
  balls = new Map(list.map((b) => [b.id, b]));
  rawMempool.clear();
  recomputeFees();
  if (Math.random() > 0.4 && list.length) {
    const drop = list[Math.floor(Math.random() * list.length)];
    balls.delete(drop.id);
    const extra = generateMockBalls(1)[0];
    balls.set(extra.id, extra);
  }
  broadcast({ type: "mempool.snapshot", data: snapshot() });
  broadcast({ type: "fees.histogram", data: feeHist });
}

// ─── REST ───────────────────────────────────────────────────────────

const matrixCfg = matrixConfigFromEnv();

async function opsHealthBody(): Promise<OpsHealth> {
  let indexer: unknown = { enabled: false };
  try {
    const { indexerStatus } = await import("./lib/indexDb.js");
    indexer = await indexerStatus(nodeInfo.fullHeight ?? null);
  } catch {
    /* optional */
  }
  return {
    ok: true,
    mock: usingMock,
    forceMock: FORCE_MOCK,
    mockFallback: MOCK_FALLBACK,
    node: ERGO_NODE_URL,
    network: NETWORK,
    lastPollOk,
    lastError,
    balls: balls.size,
    height: nodeInfo.fullHeight ?? null,
    gateway: "ergoscan/1.0.0",
    indexer,
    orderingWindow: {
      mode: "synthetic",
      note: "Not Matrix input blocks. Mainnet has no live IB stream (Matrix/devnet only).",
    },
    matrix: {
      enabled: matrixCfg.enabled,
      url: matrixCfg.url ?? null,
    },
  };
}

app.get("/v1/health", async (_req, res) => {
  cacheNoStore(res);
  res.json(toPublicHealth(await opsHealthBody()));
});

/** Localhost ops only. Caddy returns 404 for `/v1/ops/*`. */
app.get("/v1/ops/health", async (_req, res) => {
  cacheNoStore(res);
  res.json(await opsHealthBody());
});

app.get("/v1/info", async (_req, res) => {
  const params = mapEpochParams(
    (nodeInfoRaw.parameters as Record<string, unknown>) ?? null
  );
  const height = nodeInfo.fullHeight ?? nodeInfo.headersHeight ?? lastChainTip?.height ?? null;
  const gix = await readGixWatermark();
  res.json({
    ...nodeInfo,
    mock: usingMock,
    gateway: "ergoscan/1.0.0",
    // Official NetworkState names (additive). Amounts/ids unchanged.
    lastBlockId: lastChainTip?.headerId ?? (nodeInfoRaw.bestFullHeaderId as string) ?? null,
    height,
    maxBoxGix: gix.maxBoxGix,
    maxTxGix: gix.maxTxGix,
    params,
  });
});

/** Best-effort: ball.addresses, box.address, or raw JSON contains address string */
function rawMentionsAddress(tx: RawTx, address: string): boolean {
  for (const side of [tx.inputs, tx.outputs]) {
    for (const box of side ?? []) {
      const a = (box as { address?: string }).address;
      if (a && a === address) return true;
    }
  }
  try {
    return JSON.stringify(tx).includes(address);
  } catch {
    return false;
  }
}

app.get("/v1/mempool", async (req, res) => {
  cacheNoStore(res);
  const address = String(req.query.address ?? "").trim();
  if (!address) {
    res.json(snapshot());
    return;
  }
  // Soft poll leaves ball.addresses empty — resolve on-demand (capped) for this query only.
  const candidates = [...balls.values()].slice(0, 40);
  const matched: typeof candidates = [];
  for (const b of candidates) {
    if (b.addresses?.includes(address)) {
      matched.push(b);
      continue;
    }
    const raw = rawMempool.get(b.id);
    if (!raw) continue;
    if (rawMentionsAddress(raw, address)) {
      matched.push(b);
      continue;
    }
    const filled = txWithTreeAddresses(raw, NETWORK === "testnet" ? "testnet" : "mainnet");
    if (rawMentionsAddress(filled, address)) matched.push(b);
  }
  // HARD RULE: never return global balls when address is set
  res.json({
    ts: Date.now(),
    network: NETWORK,
    balls: matched,
    items: matched,
    count: matched.length,
    totalSize: matched.reduce((s, b) => s + b.size, 0),
    totalFees: matched.reduce((s, b) => s + b.fee, 0),
    filteredBy: address,
    source: "stage-gateway",
    note: "only txs that touch address (inputs/outputs after resolve)",
  });
});

app.get("/v1/mempool/:id", (req, res, next) => {
  // Let official /mempool/transactions/* and /mempool/boxes/* register after this.
  if (!/^[0-9a-fA-F]{64}$/.test(req.params.id)) return next();
  cacheNoStore(res);
  const b = balls.get(req.params.id);
  if (!b) return res.status(404).json({ error: "not_found" });
  res.json(b);
});

app.get("/v1/fees/histogram", (_req, res) => {
  res.json(feeHist);
});

app.get("/v1/fees/recommend", (_req, res) => {
  res.json(feeHist.recommend);
});

app.get("/v1/fees/eta", (_req, res) => {
  // live countdown
  const elapsed = Math.max(0, Date.now() - blockEta.lastBlockTs);
  const nextEtaMs = Math.max(0, blockEta.avgIntervalMs - elapsed);
  res.json({
    ...blockEta,
    nextEtaMs: Math.round(nextEtaMs),
    nextEtaSec: Math.floor(nextEtaMs / 1000),
    now: Date.now(),
  });
});

// Market first so /v1/tokens/search is not captured by /v1/tokens/:id
registerMarketRoutes(app, {
  getRawMempool: () => rawMempool,
});

// Official explorer path aliases (before /v1/tokens/:id and /v1/boxes/:id)
registerCompatRoutes(app, {
  getRawMempool: () => rawMempool,
  getNodeInfoRaw: () => nodeInfoRaw,
  submitTx: (body) => nodePost("/transactions", body, 20_000),
  apiContour: process.env.API_CONTOUR === "1",
});

registerMediaRoutes(app);

registerExplorerRoutes(app, {
  getRawMempool: () => rawMempool,
  subblocks,
  getFullHeight: () => nodeInfo.fullHeight,
});

registerChainRoutes(app, {
  getRawMempool: () => rawMempool,
  getBalls: () => balls,
  getFullHeight: () => nodeInfo.fullHeight,
  getNodeInfoRaw: () => nodeInfoRaw,
  getOrbit: () => orbitPeers.get(),
  blocksLimit: BLOCKS_LIMIT,
});

registerMetricsRoutes(app, {
  getBalls: () => balls,
  getRawMempool: () => rawMempool,
  getNodeInfo: () => nodeInfo,
  getNodeInfoRaw: () => nodeInfoRaw,
  getFeeHist: () => feeHist,
  getBlockEta: () => blockEta,
  network: NETWORK,
  mock: () => usingMock,
});

// Phase 5.7d — DeFi overlay (reads schema defi only; no node spam)
registerDefiRoutes(app, {
  getFullHeight: () => nodeInfo.fullHeight,
});

registerLithosRoutes(app);
registerRosenRoutes(app);
registerOracleRoutes(app);
registerBuybackRoutes(app);
registerNamesRoutes(app);

registerGraphqlRoutes(app, {
  getRawMempool: () => rawMempool,
  getFullHeight: () => nodeInfo.fullHeight,
  submitTx: (body) => nodePost("/transactions", body, 20_000),
  checkTx: (body) => nodePost("/transactions/check", body, 20_000),
  network: NETWORK,
});

app.get("/v1/resolve", async (req, res) => {
  const q = String(req.query.q ?? "");
  cacheList(res);
  try {
    res.json(await resolveFromIndex(q));
  } catch {
    res.json({ q, hits: [], source: "index" });
  }
});

app.get("/v1/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  cacheList(res);
  const hits: { type: string; id: string; label?: string; path?: string }[] = [];
  if (!q) return res.json({ q, hits, source: "index" });

  if (/^[0-9a-fA-F]{64}$/.test(q) && (balls.has(q) || rawMempool.has(q))) {
    hits.push({ type: "tx", id: q, label: "mempool", path: `/tx/${q}` });
  }

  try {
    const resolved = await resolveFromIndex(q);
    for (const h of resolved.hits) {
      if (!hits.some((x) => x.type === h.type && x.id === h.id)) {
        hits.push({ type: h.type, id: h.id, label: h.label, path: h.path });
      }
    }
  } catch {
    /* index miss */
  }

  const ql = q.toLowerCase();
  if (ql.length >= 4) {
    for (const b of balls.values()) {
      if (hits.length >= 28) break;
      if (b.txId.toLowerCase().includes(ql) && !hits.some((h) => h.type === "tx" && h.id === b.txId)) {
        hits.push({ type: "tx", id: b.txId, label: b.category, path: `/tx/${b.txId}` });
      }
    }
  }

  res.json({ q, hits: hits.slice(0, 28), source: "index" });
});

// ─── WS ─────────────────────────────────────────────────────────────

const server = createServer(app);
/**
 * Live browser handshakes send Origin (seen: https://ergoscan.me).
 * An empty Origin is not a page. The API process does not use this gate.
 */
const STREAM_ALLOW_EMPTY_ORIGIN = false;
const wss = new WebSocketServer({
  server,
  path: "/v1/stream",
  verifyClient: (info, cb) => {
    const origin = headerOrigin(info.req.headers.origin);
    if (allowStreamOrigin(origin, STREAM_ALLOW_EMPTY_ORIGIN)) {
      cb(true);
      return;
    }
    cb(false, 403, "origin");
  },
});

let streamOriginLogged = false;
wss.on("connection", (ws, req) => {
  if (!streamOriginLogged) {
    streamOriginLogged = true;
    const origin = headerOrigin(req.headers.origin);
    console.log(`[ergoscan-gateway] stream origin ${origin ?? "(none)"}`);
  }
  clients.add(ws);
  const hello: WsServerEvent = { type: "hello", data: { version: "1.0.0", mock: usingMock } };
  ws.send(JSON.stringify(hello));
  ws.send(JSON.stringify({ type: "mempool.snapshot", data: snapshot() } satisfies WsServerEvent));
  ws.send(JSON.stringify({ type: "fees.histogram", data: feeHist } satisfies WsServerEvent));
  ws.send(JSON.stringify({ type: "node.info", data: nodeInfo } satisfies WsServerEvent));
  if (lastChainTip) {
    ws.send(JSON.stringify({ type: "chain.tip", data: lastChainTip } as WsServerEvent));
  }

  ws.on("message", (buf) => {
    try {
      const msg = JSON.parse(String(buf)) as { op?: string };
      if (msg.op === "ping") {
        ws.send(
          JSON.stringify({
            type: "hello",
            data: { version: "1.0.0", mock: usingMock },
          } satisfies WsServerEvent)
        );
      }
    } catch {
      /* ignore */
    }
  });
  ws.on("close", () => clients.delete(ws));
});

server.listen(PORT, BIND, () => {
  console.log(
    `[ergoscan-gateway] ${BIND}:${PORT} node=${ERGO_NODE_URL} mock=${FORCE_MOCK} fallback=${MOCK_FALLBACK}`
  );
  void refreshSpectrumPoolNfts();
  warmErgoTreeParser();
  startTemplateHashFill();
  void pollMempool();
  void fetchNodeInfo();
  void refreshBlockEta();
  void tickChainTip();
  setInterval(() => void pollMempool(), POLL_MS);
  setInterval(() => void fetchNodeInfo(), 10_000);
  setInterval(() => void refreshBlockEta(), 15_000);
  setInterval(() => tickSubblocks(), 2_000);
  setInterval(() => void tickChainTip(), 2_000);
});
