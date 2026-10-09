/**
 * Fill templateHash on boxes the mempool and the tx page already hold.
 * One indexed lookup for the batch, then the existing sigma hash for trees
 * that are not in packed.script yet. The tape does not call this.
 */
import { createHash } from "node:crypto";
import { MINERS_FEE_TREE } from "@ergoscan/shared";
import { ergoTreeTemplateHash } from "./ergoTree.js";
import { getReadPool } from "./indexDb.js";

const CACHE_MAX = 4000;
const cache = new Map<string, string | null>();

function normTree(tree: string | null | undefined): string | null {
  if (!tree) return null;
  const hex = tree.trim().toLowerCase().replace(/^0x/, "");
  if (hex.length < 2 || hex.length > 500_000) return null;
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  return hex;
}

function skipTree(hex: string): boolean {
  return hex.startsWith("0008cd") || hex === MINERS_FEE_TREE;
}

function remember(tree: string, hash: string | null) {
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(tree, hash);
}

type HashBox = { ergoTree?: string | null; templateHash?: string | null };

export async function stampTemplateHashes(boxes: HashBox[]): Promise<void> {
  const pending: Array<{ box: HashBox; tree: string }> = [];
  for (const box of boxes) {
    if (box.templateHash && box.templateHash.length === 64) continue;
    const tree = normTree(box.ergoTree);
    if (!tree || skipTree(tree)) continue;
    const known = cache.get(tree);
    if (known !== undefined) {
      box.templateHash = known;
      continue;
    }
    pending.push({ box, tree });
  }
  if (!pending.length) return;

  const byTree = new Map<string, string>();
  const pool = getReadPool();
  if (pool) {
    const md5s = [...new Set(pending.map((p) => createHash("md5").update(p.tree).digest("hex")))];
    try {
      const found = await pool.query<{ ergo_tree: string; hash: string }>(
        `SELECT ergo_tree, encode(template_hash, 'hex') AS hash
           FROM packed.script
          WHERE tree_md5 = ANY($1::text[])
            AND octet_length(template_hash) = 32`,
        [md5s]
      );
      for (const row of found.rows) {
        const tree = normTree(row.ergo_tree);
        if (tree && row.hash && row.hash.length === 64) byTree.set(tree, row.hash);
      }
    } catch {
      /* Sigma hash below still covers a miss. */
    }
  }

  for (const { box, tree } of pending) {
    const fromDb = byTree.get(tree);
    if (fromDb) {
      remember(tree, fromDb);
      box.templateHash = fromDb;
      continue;
    }
    let hashed: string | null = null;
    try {
      hashed = await ergoTreeTemplateHash(tree);
    } catch {
      hashed = null;
    }
    remember(tree, hashed);
    box.templateHash = hashed;
  }
}
