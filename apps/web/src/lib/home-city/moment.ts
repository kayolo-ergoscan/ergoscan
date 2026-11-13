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
 * any other takes the block read's kind at that index when it is there, else stays unlit.
 */
export function sealStoreys(txIds: readonly string[], yard: readonly YardTx[], read: readonly CityTx[] | null): { txs: CityTx[]; kinds: string[] } {
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
