/** Shared ErgoScan types — balls, mempool, chain objects */

export type NetworkId = "mainnet" | "testnet";

export type TxCategory =
  | "transfer"
  | "token"
  | "nft"
  | "defi"
  | "bridge"
  | "mixer"
  | "oracle"
  | "agent"
  | "stable"
  | "unknown"
  | "contract"
  | "coinbase"
  | "fee-collect"
  | "reward-unlock"
  | "script-pay";

/**
 * LoomThread — visual unit for Parallel Box Loom (was BallProps).
 * BallProps remains an alias for gateway / WS compatibility.
 */
export interface LoomThread {
  id: string;
  txId: string;
  /** visual scale (legacy radius mapping from size) */
  r: number;
  /** size bytes */
  size: number;
  /** fee in nanoERG */
  fee: number;
  /** fee per byte */
  feeRate: number;
  category: TxCategory;
  /** hex color */
  color: string;
  label?: string;
  tokenIds: string[];
  /** Addresses touched by inputs/outputs (when resolvable) */
  addresses?: string[];
  /** Input box ids when available (parallel-set detection) */
  inputBoxIds?: string[];
  outputCount: number;
  inputCount: number;
  /** nanoERG sum of outputs (approx) */
  value: number;
  platform?: string;
  /** Template-hash action. Shape stays on category. */
  action?: string;
  isYours?: boolean;
  firstSeen: number;
}

/** @deprecated use LoomThread — kept for WS/gateway payloads */
export type BallProps = LoomThread;
/** Alias preferred in Stage UI */
export type BoxThread = LoomThread;

export interface MempoolSnapshot {
  ts: number;
  network: NetworkId;
  balls: BallProps[];
  count: number;
  totalSize: number;
  totalFees: number;
}

export interface BlockEta {
  /** average block interval from recent headers (ms) */
  avgIntervalMs: number;
  /** last sealed block timestamp (ms) */
  lastBlockTs: number;
  /** estimated ms until next ordering block */
  nextEtaMs: number;
  /** same in seconds, floored ≥ 0 */
  nextEtaSec: number;
  samples: number;
}

export interface FeeHistogram {
  ts: number;
  buckets: { feeRate: number; count: number; size: number }[];
  p50: number;
  p90: number;
  recommend: { economy: number; normal: number; turbo: number };
  eta?: BlockEta;
}

export interface NodeInfoLite {
  network: NetworkId;
  name?: string;
  headersHeight?: number | null;
  fullHeight?: number | null;
  peersCount?: number;
  isMining?: boolean;
  appVersion?: string;
}

export interface BlockSummary {
  id: string;
  height: number;
  timestamp: number;
  txCount: number;
  size: number;
  miner?: string;
}
