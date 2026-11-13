/**
 * `meaning` on tx rows: computed at read time from the boxes, never stored (the DB must not grow).
 * In-memory LRU keyed by tx id + TX_MEANING_VERSION; confirmed txs never change, so entries
 * only leave by size. Mempool meanings live in their own map and leave with the tx.
 *
 * Lists (recent, block, address, token, mempool) get the list form (CompactMeaning: no phrase,
 * no «how»; the web builds the phrase with sayMeaning). They read the same box facts, so one
 * cache of list forms serves them all. The tx page and /v1/mempool/:id get the full meaning;
 * the tx page computes its own copy with registers and data inputs and does not write here.
 */
import {
  TEMPLATES_WITH_REGISTERS,
  TX_MEANING_VERSION,
  classifyTxMeaning,
  compactMeaning,
  type CompactMeaning,
  type MeaningBox,
  type MeaningCtx,
  type MeaningName,
  type MeaningTokenMeta,
  type MeaningTx,
  type TxMeaning,
} from "@ergoscan/shared";
import { cachedDexLockHints, getIndexPool, tokenMetaMany } from "./indexDb.js";
import { namesBook } from "./names.js";
import { isHex64, packedReadEnabled } from "./packedRead.js";

export type { CompactMeaning, TxMeaning };

const CACHE_MAX = Math.max(1000, Number(process.env.TX_MEANING_CACHE ?? 20_000) || 20_000);
/** A tx with more boxes than this is read cut short: inputs and outputs, this many each. */
export const MEANING_FULL_BOXES = 400;

const lru = new Map<string, CompactMeaning>();
let hits = 0;
let misses = 0;

const key = (id: string) => `${id.toLowerCase()}:${TX_MEANING_VERSION}`;

export function meaningCached(id: string): CompactMeaning | null {
  const k = key(id);
  const hit = lru.get(k);
  if (!hit) return null;
  lru.delete(k);
  lru.set(k, hit);
  return hit;
}

function remember(id: string, m: CompactMeaning) {
  const k = key(id);
  lru.delete(k);
  lru.set(k, m);
  while (lru.size > CACHE_MAX) {
    const oldest = lru.keys().next().value;
    if (oldest === undefined) break;
    lru.delete(oldest);
  }
}

export function meaningCacheStats() {
  return { size: lru.size, max: CACHE_MAX, hits, misses, mempool: mempoolMeanings.size, version: TX_MEANING_VERSION };
}

// ── context: token names and decimals, wallet names ─────────────────────────

/** Only owners worth a name in a sentence: exchanges, mining pools, foundations. */
const NAMED_CATEGORIES = new Set(["exchange", "mining-pool", "foundation"]);
let namesFrom: unknown = null;
let namesIndex = new Map<string, MeaningName>();

async function nameIndex(): Promise<Map<string, MeaningName>> {
  const book = await namesBook();
  if (book && book !== namesFrom) {
    const next = new Map<string, MeaningName>();
    for (const it of book.items) {
      if (!NAMED_CATEGORIES.has(it.project.category) || !it.current) continue;
      next.set(it.address, { name: it.project.name, category: it.project.category });
    }
    namesIndex = next;
    namesFrom = book;
  }
  return namesIndex;
}

function tokenIdsOf(txs: Iterable<MeaningTx>): string[] {
  const ids = new Set<string>();
  for (const tx of txs) {
    for (const b of [...tx.inputs, ...tx.outputs]) {
      for (const a of b.assets ?? []) {
        const id = String(a.tokenId ?? "").toLowerCase();
        if (id.length === 64) ids.add(id);
      }
    }
  }
  return [...ids];
}

export async function meaningCtx(
  tokenIds: string[],
  known?: ReadonlyArray<{ tokenId: string; name: string | null; decimals: number | null }>
): Promise<MeaningCtx> {
  const meta = new Map<string, MeaningTokenMeta>();
  for (const t of known ?? []) meta.set(t.tokenId, { name: t.name, decimals: t.decimals });
  const need = tokenIds.filter((id) => !meta.has(id));
  const [rows, names] = await Promise.all([
    need.length ? tokenMetaMany(need).catch(() => new Map()) : Promise.resolve(new Map()),
    nameIndex().catch(() => new Map<string, MeaningName>()),
  ]);
  for (const [id, m] of rows as Map<string, { name: string | null; decimals: number | null }>) {
    meta.set(id, { name: m.name, decimals: m.decimals });
  }
  return {
    token: (id) => meta.get(id) ?? null,
    nameOf: (a) => names.get(a) ?? null,
    poolNftIds: cachedDexLockHints().poolNftIds,
  };
}

/** Never throws: a row without meaning is still a row. */
function safeClassify(tx: MeaningTx, ctx: MeaningCtx): TxMeaning | null {
  try {
    return classifyTxMeaning(tx, ctx);
  } catch {
    return null;
  }
}

/** List forms for txs whose boxes the caller already holds; cached ones are reused. */
export async function meaningsFor(txs: MeaningTx[]): Promise<Map<string, CompactMeaning>> {
  const out = new Map<string, CompactMeaning>();
  const todo: MeaningTx[] = [];
  for (const tx of txs) {
    const hit = meaningCached(tx.id);
    // The rent writer marks a block a little after it lands: a mark beats an older answer.
    if (hit && (!tx.rent || hit.action === "rent")) {
      hits += 1;
      out.set(tx.id, hit);
    } else if (tx.inputs.length || tx.outputs.length) {
      todo.push(tx);
    }
  }
  if (!todo.length) return out;
  misses += todo.length;
  const ctx = await meaningCtx(tokenIdsOf(todo));
  for (const tx of todo) {
    const m = safeClassify(tx, ctx);
    if (!m) continue;
    const c = compactMeaning(m);
    remember(tx.id, c);
    out.set(tx.id, c);
  }
  return out;
}

/** One tx with everything the page has (registers, data inputs). Not cached. */
export async function meaningForPage(
  tx: MeaningTx,
  tokenMeta: ReadonlyArray<{ tokenId: string; name: string | null; decimals: number | null }>
): Promise<TxMeaning | null> {
  // Never fails the tx page: a missing meaning only hides the new line.
  const ctx = await meaningCtx(tokenIdsOf([tx]), tokenMeta).catch(() => null);
  return ctx ? safeClassify(tx, ctx) : null;
}

// ── boxes from the index, by tx id (indexed creation_tx_id / spent_tx_id) ───

/** Registers are read only where a rule needs them (the list lives with the registry). */
const REG_TEMPLATES = [...TEMPLATES_WITH_REGISTERS];

type BoxRow = {
  box_id: string;
  creation_tx_id: string | null;
  spent_tx_id: string | null;
  address: string | null;
  ergo_tree: string | null;
  template_hash: string | null;
  value_nano: string | null;
  registers: unknown;
};

const PACKED_COLS = `encode(b.box_id, 'hex') AS box_id,
       encode(b.creation_tx_id, 'hex') AS creation_tx_id,
       encode(b.spent_tx_id, 'hex') AS spent_tx_id,
       ad.address, sc.ergo_tree,
       CASE WHEN octet_length(sc.template_hash) = 32 THEN encode(sc.template_hash, 'hex') ELSE NULL END AS template_hash,
       b.value_nano::text AS value_nano,
       CASE WHEN encode(sc.template_hash, 'hex') = ANY($2::text[]) THEN b.additional_registers ELSE NULL END AS registers`;

/** Fits both the shape/lock overlay (ShapeBox) and the classifier (MeaningBox). */
export type IoBox = {
  boxId: string;
  address: string | null;
  ergoTree: string | null;
  templateHash: string | null;
  value: string;
  assets: { tokenId: string; amount: string }[];
  additionalRegisters?: Record<string, unknown>;
};
export type TxIo = { inputs: IoBox[]; outputs: IoBox[] };

function regsOf(raw: unknown): Record<string, unknown> | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const o = JSON.parse(raw) as unknown;
      return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function q<T extends Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[] | null> {
  const p = getIndexPool();
  if (!p) return null;
  try {
    return (await p.query<T>(sql, params)).rows;
  } catch {
    return null;
  }
}

async function assetsFor(boxIds: string[]): Promise<Map<string, { tokenId: string; amount: string }[]> | null> {
  const out = new Map<string, { tokenId: string; amount: string }[]>();
  if (!boxIds.length) return out;
  const rows = await q<{ box_id: string; token_id: string; amount: string }>(
    packedReadEnabled()
      ? `SELECT encode(box_id, 'hex') AS box_id, encode(token_id, 'hex') AS token_id, amount::text AS amount
           FROM packed.box_assets
          WHERE box_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)`
      : `SELECT box_id, token_id, amount::text AS amount FROM box_assets WHERE box_id = ANY($1::text[])`,
    [boxIds]
  );
  if (!rows) return null;
  for (const r of rows) {
    const list = out.get(r.box_id) ?? [];
    list.push({ tokenId: r.token_id, amount: r.amount });
    out.set(r.box_id, list);
  }
  return out;
}

function intoIo(ids: string[], boxes: BoxRow[], assets: Map<string, { tokenId: string; amount: string }[]>) {
  const byTx = new Map<string, TxIo>();
  for (const id of ids) byTx.set(id, { inputs: [], outputs: [] });
  for (const b of boxes) {
    const box: IoBox = {
      boxId: b.box_id,
      address: b.address,
      ergoTree: b.ergo_tree,
      templateHash: b.template_hash,
      value: b.value_nano ?? "0",
      assets: assets.get(b.box_id) ?? [],
    };
    const regs = regsOf(b.registers);
    if (regs) box.additionalRegisters = regs;
    if (b.spent_tx_id) byTx.get(b.spent_tx_id)?.inputs.push(box);
    if (b.creation_tx_id) byTx.get(b.creation_tx_id)?.outputs.push(box);
  }
  return byTx;
}

/**
 * Every box a batch of txs created or spent (the list tape already reads the same set).
 * null when the index did not answer.
 */
export async function loadTxIo(ids: string[]): Promise<Map<string, TxIo> | null> {
  const clean = [...new Set(ids.filter(isHex64).map((x) => x.toLowerCase()))];
  if (!clean.length) return new Map();
  const boxes = await q<BoxRow>(
    packedReadEnabled()
      ? `SELECT ${PACKED_COLS}
           FROM (
             SELECT * FROM packed.boxes
              WHERE creation_tx_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)
             UNION
             SELECT * FROM packed.boxes
              WHERE spent_tx_id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)
           ) b
           LEFT JOIN packed.addr ad ON ad.id = b.addr_id
           LEFT JOIN packed.script sc ON sc.id = b.script_id`
      : `SELECT box_id, creation_tx_id, spent_tx_id, address, ergo_tree,
                NULL::text AS template_hash, value_nano::text AS value_nano, NULL AS registers
           FROM boxes
          WHERE (creation_tx_id = ANY($1::text[]) OR spent_tx_id = ANY($1::text[]))
            AND cardinality($2::text[]) >= 0`,
    [clean, REG_TEMPLATES]
  );
  if (!boxes) return null;
  const assets = await assetsFor(boxes.map((b) => b.box_id));
  if (!assets) return null;
  return intoIo(clean, boxes, assets);
}

/** A huge tx (15k outputs exist): at most MEANING_FULL_BOXES inputs and outputs, by index. */
async function loadTxIoCut(id: string): Promise<TxIo | null> {
  if (!packedReadEnabled()) return null;
  const boxes = await q<BoxRow>(
    `SELECT ${PACKED_COLS}
       FROM (
         (SELECT * FROM packed.boxes WHERE spent_tx_id = decode(lower($1), 'hex') LIMIT ${MEANING_FULL_BOXES})
         UNION ALL
         (SELECT * FROM packed.boxes WHERE creation_tx_id = decode(lower($1), 'hex') LIMIT ${MEANING_FULL_BOXES})
       ) b
       LEFT JOIN packed.addr ad ON ad.id = b.addr_id
       LEFT JOIN packed.script sc ON sc.id = b.script_id`,
    [id, REG_TEMPLATES]
  );
  if (!boxes) return null;
  const assets = await assetsFor(boxes.map((b) => b.box_id));
  if (!assets) return null;
  return intoIo([id], boxes, assets).get(id) ?? null;
}

type RentMarks = (ids: string[], minH: number, maxH: number) => Promise<Map<string, { category: string }>>;

/**
 * Meaning for tx ids the caller has only as ids (address history, token txs).
 * Cache first; misses read their boxes by indexed tx id, huge txs cut short.
 */
export async function meaningsByIds(ids: string[], rentMarks?: RentMarks): Promise<Map<string, CompactMeaning>> {
  const out = new Map<string, CompactMeaning>();
  const miss: string[] = [];
  for (const raw of new Set(ids)) {
    if (!isHex64(raw)) continue;
    const id = raw.toLowerCase();
    const hit = meaningCached(id);
    if (hit) {
      hits += 1;
      out.set(raw, hit);
    } else miss.push(id);
  }
  if (!miss.length || !packedReadEnabled()) return out;
  const heads = await q<{ id: string; index_in_block: unknown; height: unknown; input_count: unknown; output_count: unknown }>(
    `SELECT encode(id, 'hex') AS id, index_in_block, height, input_count, output_count
       FROM packed.transactions
      WHERE id IN (SELECT decode(lower(x), 'hex') FROM unnest($1::text[]) AS x)`,
    [miss]
  );
  if (!heads?.length) return out;
  const small: string[] = [];
  const big: string[] = [];
  let minH = Infinity;
  let maxH = -Infinity;
  for (const h of heads) {
    const n = Number(h.input_count ?? 0) + Number(h.output_count ?? 0);
    (n > MEANING_FULL_BOXES ? big : small).push(h.id);
    const height = Number(h.height);
    if (Number.isFinite(height)) {
      minH = Math.min(minH, height);
      maxH = Math.max(maxH, height);
    }
  }
  const [io, cut, rent] = await Promise.all([
    small.length ? loadTxIo(small) : Promise.resolve(new Map<string, TxIo>()),
    Promise.all(big.map(async (id) => [id, await loadTxIoCut(id)] as const)),
    rentMarks && Number.isFinite(minH) ? rentMarks(miss, minH, maxH).catch(() => new Map()) : Promise.resolve(new Map()),
  ]);
  const all = new Map<string, TxIo>(io ?? []);
  for (const [id, x] of cut) if (x) all.set(id, x);
  const txs: MeaningTx[] = [];
  for (const h of heads) {
    const x = all.get(h.id);
    if (!x) continue;
    txs.push({
      id: h.id,
      coinbase: Number(h.index_in_block) === 0,
      inputs: x.inputs,
      outputs: x.outputs,
      rent: (rent as Map<string, { category: string }>).get(h.id)?.category ?? null,
      inputCount: Number(h.input_count ?? x.inputs.length),
      outputCount: Number(h.output_count ?? x.outputs.length),
    });
  }
  const got = await meaningsFor(txs);
  for (const raw of ids) {
    const m = got.get(raw.toLowerCase());
    if (m) out.set(raw, m);
  }
  return out;
}

// ── mempool ─────────────────────────────────────────────────────────────────

const mempoolMeanings = new Map<string, { full: TxMeaning; slim: CompactMeaning }>();
let mempoolBusy = false;

/** Node tx JSON (unconfirmed dump: inputs are full boxes), after addresses and hashes are stamped. */
type NodeTx = {
  id: string;
  inputs?: readonly object[];
  outputs?: readonly object[];
};

function nodeBox(raw: object): MeaningBox {
  const b = raw as Record<string, unknown>;
  return {
    boxId: (b.boxId as string) ?? null,
    address: (b.address as string) ?? null,
    ergoTree: (b.ergoTree as string) ?? null,
    templateHash: (b.templateHash as string) ?? null,
    value: (b.value as string | number) ?? 0,
    assets: (b.assets as MeaningBox["assets"]) ?? [],
    additionalRegisters: (b.additionalRegisters as Record<string, unknown>) ?? null,
  };
}

/** Full meaning (phrase and «how»): /v1/mempool/:id. */
export function mempoolMeaning(id: string): TxMeaning | null {
  return mempoolMeanings.get(id)?.full ?? null;
}

/** List form: mempool lists. */
export function mempoolMeaningSlim(id: string): CompactMeaning | null {
  return mempoolMeanings.get(id)?.slim ?? null;
}

/**
 * After each poll: compute for new mempool txs (node dump has full input boxes), drop the gone.
 * One run at a time; a slow index lookup never stacks polls.
 */
export async function warmMempoolMeanings(txs: readonly NodeTx[]): Promise<void> {
  if (mempoolBusy) return;
  mempoolBusy = true;
  try {
    const live = new Set(txs.map((t) => t.id));
    for (const id of mempoolMeanings.keys()) if (!live.has(id)) mempoolMeanings.delete(id);
    const fresh = txs
      .filter((t) => t?.id && !mempoolMeanings.has(t.id))
      .map((t): MeaningTx => ({
        id: t.id,
        inputs: (t.inputs ?? []).map(nodeBox),
        outputs: (t.outputs ?? []).map(nodeBox),
      }));
    if (!fresh.length) return;
    const ctx = await meaningCtx(tokenIdsOf(fresh));
    for (const tx of fresh) {
      const m = safeClassify(tx, ctx);
      if (m) mempoolMeanings.set(tx.id, { full: m, slim: compactMeaning(m) });
    }
  } finally {
    mempoolBusy = false;
  }
}
