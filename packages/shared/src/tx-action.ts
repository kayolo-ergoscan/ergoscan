/**
 * Action name beside the tx shape. Keyed by SHA-256 of the ErgoTree template,
 * the same hash stored on packed.script. Not an ergoTree suffix match.
 * Hashes were read from live boxes that hold the known NFT or sit at the known address.
 */
import { isMinerFeeBox, isMiningRewardLock, type ShapeBox, type TxShape } from "./tx-shape.js";

export type TxActionId =
  | "oracle-datapoint"
  | "oracle-refresh"
  | "spectrum-swap"
  | "pool-deposit"
  | "pool-redeem"
  | "lithos-swap"
  | "sigmausd"
  | "rosen";

const RANK: Record<TxActionId, number> = {
  "oracle-refresh": 50,
  "oracle-datapoint": 40,
  "spectrum-swap": 30,
  "pool-deposit": 30,
  "pool-redeem": 30,
  "lithos-swap": 30,
  sigmausd: 20,
  rosen: 20,
};

/**
 * Spending any of these is a rate update. v2: pool box and refresh NFT box. v1 (ERG/USD v1 and
 * the other v1 pools): live-epoch box (collect datapoints → new rate) and epoch-prep box.
 */
const ORACLE_REFRESH = [
  "416babd63f0154df53b3b2f58891fa275048309978b1a1bde7e312f4f13bf2be",
  "cb5001639bacb19fe35f9ea25e56fbe2d2b3b2ff77a2b11e5a0f14e40187fe59",
  "19e4db35624440663cff2f557a32bc714180a199b9cf4cf52910349e7419c180",
  "f6f982fa50028a18a6459ab046f1f93d05a598dd57c913921c01cf186b9c5cdc",
];
/** Oracle token (datapoint) box. v2 (USD, gold) and v1. */
const ORACLE_DATAPOINT = [
  "fcbf6946412dbc9528b24d134c58c8f06c15cb84b13f38e59caf9fe1bd9ba764",
  "6c4c6cd7754877bc3b3e590209d8c8fa1c70303140cfdf62071c433956037a50",
];
/** ErgoDex CFMM pools: ERG/token (current and older template) and token/token. */
const SPECTRUM_SWAP = [
  "2dcc7830afe8f355b945850c60ff2b41fdb3e8ade07fde0a7c8a3ec498e8c3f6",
  "83d0e88be351507dde3d6adef042c380af82072fb791ae5c5d4e3b711fd3b4cd",
  "3c09deff3b5f49329149d18e02aab675ef6957bf6559a5c7dba817fee883fb3e",
];
const LITHOS_SWAP = [
  "2de640e37a49cc9d95a08f2678da9f5e9aba56e08dfbc0662a64d225093156e3",
  "a6e7f1bc292ddc7ab8be30d304926fe9cc15760581cc73e995a8c971f1fc63c9",
  "1253a7f2c8fe3c687d16ffe2a296acb826bc2abac6d1c0dfb95f246e438c773c",
  "ec8631e580566f40740ba55c010432955c8539a74e9f60d40a65007c354849d6",
];
/** AgeUSD bank box. (19e4db35… is the oracle v1 live epoch, not the bank: see ORACLE_REFRESH.) */
const SIGMAUSD = ["246e14059ac2d7642929d5486007ec55d0522936391ba60564ec84d44b19e430"];
const ROSEN = ["7df7d49c680505ae413376e59e9970df4429741b33f095676bec3e4126de846d"];

function bind(ids: readonly string[], action: TxActionId, into: Map<string, TxActionId>) {
  for (const id of ids) into.set(id, action);
}

const BY_HASH = new Map<string, TxActionId>();
bind(ORACLE_REFRESH, "oracle-refresh", BY_HASH);
bind(ORACLE_DATAPOINT, "oracle-datapoint", BY_HASH);
bind(SPECTRUM_SWAP, "spectrum-swap", BY_HASH);
bind(LITHOS_SWAP, "lithos-swap", BY_HASH);
bind(SIGMAUSD, "sigmausd", BY_HASH);
bind(ROSEN, "rosen", BY_HASH);

export function actionFromTemplateHash(hash: string | null | undefined): TxActionId | null {
  if (!hash) return null;
  const key = hash.trim().toLowerCase();
  if (key.length !== 64) return null;
  return BY_HASH.get(key) ?? null;
}

function best(boxes: readonly ShapeBox[]): TxActionId | null {
  let winner: TxActionId | null = null;
  let rank = -1;
  for (const box of boxes) {
    if (isMinerFeeBox(box) || isMiningRewardLock(box)) continue;
    const hit = actionFromTemplateHash(box.templateHash);
    if (!hit) continue;
    const r = RANK[hit];
    if (r > rank) {
      winner = hit;
      rank = r;
    }
  }
  return winner;
}

function amountOf(v: unknown): bigint | null {
  try {
    return BigInt(String(v ?? "").split(".")[0] || "x");
  } catch {
    return null;
  }
}

/** LP tokens left inside a pool box are close to 2^63; real reserves are far below 10^18 here. */
const LP_FLOOR = 10n ** 18n;

/**
 * A spent CFMM pool box that comes back with a different LP count was a deposit (LP left the
 * pool) or a redeem (LP came back); same LP count is a swap. Box token order is not trusted
 * (Postgres keeps none for old boxes): the pool NFT is the amount-1 token that the new pool box
 * carries again. Anything that does not fit stays a swap, as before.
 */
function poolMove(inputs: readonly ShapeBox[], outputs: readonly ShapeBox[]): TxActionId {
  for (const box of inputs) {
    if (actionFromTemplateHash(box.templateHash) !== "spectrum-swap") continue;
    const held = new Map<string, bigint>();
    for (const a of box.assets ?? []) {
      const id = a.tokenId?.trim().toLowerCase();
      const amt = amountOf(a.amount);
      if (id && amt != null) held.set(id, (held.get(id) ?? 0n) + amt);
    }
    const nfts = [...held].filter(([, amt]) => amt === 1n).map(([id]) => id);
    const next = outputs.find((o) =>
      (o.assets ?? []).some((a) => {
        const id = a.tokenId?.trim().toLowerCase();
        return id != null && nfts.includes(id) && amountOf(a.amount) === 1n;
      })
    );
    if (!next) continue;
    const after = new Map<string, bigint>();
    for (const a of next.assets ?? []) {
      const id = a.tokenId?.trim().toLowerCase();
      const amt = amountOf(a.amount);
      if (id && amt != null) after.set(id, (after.get(id) ?? 0n) + amt);
    }
    // LP candidates: big holdings. A swap leaves the LP count as it was, so one unchanged
    // candidate means swap even when a reserve token is also big (18-decimal tokens).
    const big = [...held].filter(([, amt]) => amt >= LP_FLOOR).sort((a, b) => (a[1] < b[1] ? 1 : -1));
    if (!big.length) continue;
    if (big.some(([id, amt]) => (after.get(id) ?? 0n) === amt)) return "spectrum-swap";
    // The largest is the LP: Ergo amounts stop at 2^63, so no reserve outweighs the LP left inside.
    const [lpId, lpBefore] = big[0]!;
    return (after.get(lpId) ?? 0n) > lpBefore ? "pool-redeem" : "pool-deposit";
  }
  return "spectrum-swap";
}

/**
 * Spent script wins. A payment into a script (no script spent) reads outputs.
 * Fee collection, coinbase, and reward unlock stay unnamed.
 */
export function pickTxAction(
  tx: { inputs?: readonly ShapeBox[] | null; outputs?: readonly ShapeBox[] | null },
  shape: TxShape
): TxActionId | null {
  if (shape === "fee-collect" || shape === "coinbase" || shape === "reward-unlock") return null;
  if (shape === "script-pay") return best(tx.outputs ?? []);
  const hit = best(tx.inputs ?? []);
  if (hit === "spectrum-swap") return poolMove(tx.inputs ?? [], tx.outputs ?? []);
  return hit;
}
