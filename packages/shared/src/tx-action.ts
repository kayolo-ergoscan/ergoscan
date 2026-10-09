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
  | "lithos-swap"
  | "sigmausd"
  | "rosen";

const RANK: Record<TxActionId, number> = {
  "oracle-refresh": 50,
  "oracle-datapoint": 40,
  "spectrum-swap": 30,
  "lithos-swap": 30,
  sigmausd: 20,
  rosen: 20,
};

/** Pool box and the refresh NFT box. Spending either is a refresh. */
const ORACLE_REFRESH = [
  "416babd63f0154df53b3b2f58891fa275048309978b1a1bde7e312f4f13bf2be",
  "cb5001639bacb19fe35f9ea25e56fbe2d2b3b2ff77a2b11e5a0f14e40187fe59",
];
/** Oracle token box. Same template for the USD and gold pools. */
const ORACLE_DATAPOINT = ["fcbf6946412dbc9528b24d134c58c8f06c15cb84b13f38e59caf9fe1bd9ba764"];
const SPECTRUM_SWAP = [
  "83d0e88be351507dde3d6adef042c380af82072fb791ae5c5d4e3b711fd3b4cd",
  "3c09deff3b5f49329149d18e02aab675ef6957bf6559a5c7dba817fee883fb3e",
];
const LITHOS_SWAP = [
  "2de640e37a49cc9d95a08f2678da9f5e9aba56e08dfbc0662a64d225093156e3",
  "a6e7f1bc292ddc7ab8be30d304926fe9cc15760581cc73e995a8c971f1fc63c9",
  "1253a7f2c8fe3c687d16ffe2a296acb826bc2abac6d1c0dfb95f246e438c773c",
  "ec8631e580566f40740ba55c010432955c8539a74e9f60d40a65007c354849d6",
];
/** Bank address script, and the box that holds the ErgUSD bank NFT. */
const SIGMAUSD = [
  "246e14059ac2d7642929d5486007ec55d0522936391ba60564ec84d44b19e430",
  "19e4db35624440663cff2f557a32bc714180a199b9cf4cf52910349e7419c180",
];
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
  return best(tx.inputs ?? []);
}
