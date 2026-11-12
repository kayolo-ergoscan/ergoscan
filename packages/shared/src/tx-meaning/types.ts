/**
 * What a transaction did, computed at read time from its boxes. Additive API field `meaning`.
 * Nothing here is stored: the gateway keeps an in-memory cache keyed by tx id + TX_MEANING_VERSION.
 */
import type { MeaningActionId, MeaningFamily } from "./vocab.js";

/** One box as the classifier needs it. Order of boxes and of assets is never trusted. */
export type MeaningBox = {
  boxId?: string | null;
  address?: string | null;
  ergoTree?: string | null;
  /** SHA-256 of the ErgoTree template bytes, 64 hex (packed.script.template_hash). */
  templateHash?: string | null;
  value?: string | number | bigint | null;
  assets?: ReadonlyArray<{ tokenId?: string | null; amount?: string | number | bigint | null }> | null;
  /** Optional: only the tx page has them. Used to name a bridge chain. */
  additionalRegisters?: Record<string, unknown> | null;
};

export type MeaningTx = {
  id: string;
  /** First tx of the block. */
  coinbase?: boolean;
  inputs: readonly MeaningBox[];
  outputs: readonly MeaningBox[];
  /** Read-only inputs. They never name the protocol. */
  dataInputs?: readonly MeaningBox[] | null;
  /** Storage-rent mark from the rent writer ("rent" collected, "rent-renew" renewed). */
  rent?: string | null;
  /** Real counts when the boxes above were cut short (huge txs). */
  inputCount?: number | null;
  outputCount?: number | null;
};

export type MeaningTokenMeta = { name?: string | null; decimals?: number | null };

/** A display name for a wallet or service address (exchange, mining pool, foundation). */
export type MeaningName = { name: string; category?: string | null };

export type MeaningCtx = {
  token?: (tokenId: string) => MeaningTokenMeta | null | undefined;
  nameOf?: (address: string) => MeaningName | null | undefined;
  /** Pool NFT ids from defi.pool_registry: a tx that mints one created that pool. */
  poolNftIds?: ReadonlySet<string>;
};

/** token null = ERG. amount = raw integer string (nanoERG / token units). */
export type MeaningAsset = {
  token: string | null;
  amount: string;
  name?: string | null;
  decimals?: number;
};

export type MeaningConf = "exact" | "flow" | "guess" | "unknown";

/**
 * Facts for the «Как определили» line. k is a fixed key; v / n carry the value.
 * spent: a known contract was spent (v = registry label); created: paid into one;
 * minted / burned: token id; data: read-only input; fee-payer; multisig: "k/n"; truncated.
 */
export type WhyFact = { k: string; v?: string; n?: number };

export type MeaningExtra = {
  to: string;
  asset: MeaningAsset;
  /** Only a role the registry knows (reemission, executor). Never guessed. */
  role?: string;
  name?: string | null;
};

export type TxMeaning = {
  v: number;
  action: MeaningActionId;
  family: MeaningFamily;
  /** Fold on lists by default. */
  service: boolean;
  /** Protocol id (see PROTOCOL_NAMES); null for plain wallet moves and unknown contracts. */
  protocol: string | null;
  conf: MeaningConf;
  actor: string | null;
  actorName?: string | null;
  counterparty: string | null;
  counterpartyName?: string | null;
  /** Receivers, miners, oracle posts, merged boxes: whatever the phrase counts. */
  count?: number;
  gave: MeaningAsset[];
  got: MeaningAsset[];
  fee: { payer: string | null; nano: string };
  /** Pools and venues a swap went through, display names, sorted. */
  venues: string[];
  /** Third-party payments made by the actor (beyond the counterparty). */
  extra: MeaningExtra[];
  secondary: MeaningActionId[];
  why: WhyFact[];
  /** The order the executor filled (swap / add / remove by order). */
  viaOrder?: boolean;
  /** Bridge chain on the other side, when the registers were read. */
  chain?: string | null;
  /** The boxes were cut short; amounts may be partial. */
  truncated?: boolean;
  /** Which rule answered (consensus, oracle, pools, wallets…), for «Как определили». */
  rule: string;
  say: { ru: string; en: string };
};
