/**
 * Gateway WebSocket (`/v1/stream`) event union.
 */
import type { BallProps, FeeHistogram, MempoolSnapshot, NodeInfoLite } from "./types.js";
import type { SealEvent } from "./sealReplay.js";
import type { SubblockPulse } from "./subblocks.js";
import type { RentCollectedEvent } from "./rent-claims.js";

export type WsHello = {
  type: "hello";
  data: { version: string; mock: boolean };
};

export type WsMempoolSnapshot = {
  type: "mempool.snapshot";
  data: MempoolSnapshot;
};

export type WsMempoolAdd = {
  type: "mempool.add";
  data: BallProps;
};

export type WsMempoolRemove = {
  type: "mempool.remove";
  data: { id: string; reason?: string };
};

export type WsFeesHistogram = {
  type: "fees.histogram";
  data: FeeHistogram;
};

export type WsNodeInfo = {
  type: "node.info";
  data: NodeInfoLite;
};

export type WsChainTip = {
  type: "chain.tip";
  data: { height: number; headerId: string; updatedAt?: string | null };
};

export type WsBlockSealed = {
  type: "block.sealed";
  data: SealEvent;
};

export type WsRentCollected = {
  type: "rent.collected";
  data: RentCollectedEvent;
};

export type WsSubblockPulse = {
  type: "subblock.pulse";
  data: SubblockPulse;
};

export type WsServerEvent =
  | WsHello
  | WsMempoolSnapshot
  | WsMempoolAdd
  | WsMempoolRemove
  | WsFeesHistogram
  | WsNodeInfo
  | WsChainTip
  | WsBlockSealed
  | WsRentCollected
  | WsSubblockPulse;
