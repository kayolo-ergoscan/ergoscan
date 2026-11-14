/**
 * The shared moment on `block.sealed`, as pure decisions the component and the tests both use:
 * which crates leave the yard (exactly the block's txs that wait there, in block order), what each
 * storey of the new tower is, whether the moment plays at all, and the counts the headers show
 * while it plays.
 */
import { sealPlan, type CityBlock, type CityTx, type YardTx } from "./common";

/** The block's txs that wait in the yard, in block order. A tx the yard never held is not one of them. */
export function sealMatch(txIds: readonly string[], yard: readonly YardTx[]): string[] {
  const have = new Set(yard.map((t) => t.id));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of txIds) {
    if (!have.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Each storey of the new tower, bottom up: a tx that rode in from the yard keeps its crate's kind;
 * any other takes the block read's kind at that index when it is there, else stays unlit. A partial
 * seal (no tx list: the gateway could not read the block) takes the block read whole once it lands.
 */
export function sealStoreys(txIds: readonly string[], yard: readonly YardTx[], read: readonly CityTx[] | null): { txs: CityTx[]; kinds: string[] } {
  if (!txIds.length && read?.length) return { txs: [...read], kinds: read.map((r) => r.category) };
  const byId = new Map(yard.map((t) => [t.id, t]));
  const txs: CityTx[] = [];
  const kinds: string[] = [];
  txIds.forEach((id, i) => {
    const y = byId.get(id);
    const r = read?.[i];
    if (y) {
      txs.push({ color: y.color, category: y.category });
      kinds.push("yard");
    } else {
      txs.push({ color: r?.color ?? "", category: r?.category ?? "" });
      kinds.push(r?.category ?? "");
    }
  });
  return { txs, kinds };
}

/**
 * The yard as it stood when the block came. The stream may drop the block's txs in the same update
 * that brings the seal (a snapshot right behind it); those just left the yard, so they are put back
 * for the moment: the crane takes them from where they stood.
 */
export function sealYard(
  mem: { count: number; txs: readonly YardTx[] },
  gone: ReadonlyMap<string, YardTx>,
  txIds: readonly string[]
): { count: number; txs: YardTx[] } {
  const have = new Set(mem.txs.map((t) => t.id));
  const back: YardTx[] = [];
  for (const id of txIds) {
    if (have.has(id)) continue;
    const t = gone.get(id);
    if (!t) continue;
    have.add(id);
    back.push(t);
  }
  return { count: Math.max(mem.count, mem.txs.length) + back.length, txs: [...mem.txs, ...back] };
}

/** Storey index in the block of each leaving crate (the order the crane lands them). */
export function sealTargets(txIds: readonly string[], ids: readonly string[]): number[] {
  const at = new Map<string, number>();
  txIds.forEach((id, i) => {
    if (!at.has(id)) at.set(id, i);
  });
  return ids.map((id) => at.get(id) ?? 0);
}

/**
 * Whether a seal plays its moment. Not under reduced motion, not while the tab is hidden or the cards
 * are off screen (the final state is shown instead, nothing replays later), and only for a block newer
 * than the street's newest.
 */
export function momentPlays(o: { reduce: boolean; visible: boolean; height: number; newest: number | null }): boolean {
  if (o.reduce || !o.visible) return false;
  return o.newest == null || o.height > o.newest;
}

/** Seals that may wait for the moment playing now; an older one past this just stands (no moment). */
export const SEAL_QUEUE_MAX = 2;

/**
 * A seal that comes while a moment plays waits its turn (two blocks in one breath: the first is not
 * cut short, then the second plays). Past `max` waiting, the oldest leave the queue in `dropped`.
 */
export function queueSeal<T>(queue: readonly T[], s: T, max = SEAL_QUEUE_MAX): { queue: T[]; dropped: T[] } {
  const next = [...queue, s];
  const over = Math.max(0, next.length - max);
  return { queue: next.slice(over), dropped: next.slice(0, over) };
}

/** When the newest block came, for «no new block for a while»: its sighting, else its header time. */
export function arrivedAt(b: { ts: number; seenAt?: number | null } | undefined): number {
  if (!b) return 0;
  return typeof b.seenAt === "number" && Number.isFinite(b.seenAt) && b.seenAt > 0 ? b.seenAt : b.ts;
}

/** How long the moment of a seal with `n` leaving crates lasts, ms. */
export function momentLength(n: number): number {
  return sealPlan(n).end;
}

/**
 * The yard header's count while crates still stand in the yard: the stream's count already dropped
 * the block's txs; the ones the crane has not taken yet are still waiting on screen.
 */
export function waitingShown(o: { streamCount: number; ids: readonly string[]; ms: number; inStream: ReadonlySet<string> }): number {
  const plan = sealPlan(o.ids.length);
  let pending = 0;
  o.ids.forEach((id, k) => {
    if (o.ms < plan.depart(k) && !o.inStream.has(id)) pending++;
  });
  return o.streamCount + pending;
}

/** The new block as the street draws it during its seal. */
export function sealBlock(b: Omit<CityBlock, "txs">, storeys: CityTx[]): CityBlock {
  return { ...b, txs: storeys };
}
