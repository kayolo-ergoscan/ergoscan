/**
 * Bookkeeping for the live mempool loop. No I/O: the gateway feeds node answers in.
 *
 * A tx that leaves the node's pool usually went into a block. The block seal can land a
 * moment after the pool changed, so a missing id waits `graceMs` before it is called dropped.
 */

export class VanishClock {
  private at = new Map<string, number>();

  constructor(private readonly graceMs: number) {}

  /**
   * `shown`: ids we still show. `listed`: ids the node lists now.
   * Starts the clock for missing ids, stops it for ids that came back,
   * and returns the shown ids that stayed missing for the whole grace.
   */
  settle(shown: Iterable<string>, listed: ReadonlySet<string>, now: number): string[] {
    const out: string[] = [];
    const still = new Set<string>();
    for (const id of shown) {
      still.add(id);
      if (listed.has(id)) {
        this.at.delete(id);
        continue;
      }
      const since = this.at.get(id);
      if (since == null) {
        this.at.set(id, now);
        continue;
      }
      if (now - since >= this.graceMs) {
        this.at.delete(id);
        out.push(id);
      }
    }
    for (const id of [...this.at.keys()]) {
      if (!still.has(id)) this.at.delete(id);
    }
    return out;
  }

  /** True while this missing id is inside its grace (keep showing it). */
  waiting(id: string, now: number): boolean {
    const since = this.at.get(id);
    if (since == null) {
      this.at.set(id, now);
      return true;
    }
    if (now - since < this.graceMs) return true;
    this.at.delete(id);
    return false;
  }

  forget(ids: Iterable<string>): void {
    for (const id of ids) this.at.delete(id);
  }

  /** Some missing id has used up its grace: worth a look even if the pool stamp did not move. */
  due(now: number): boolean {
    for (const since of this.at.values()) {
      if (now - since >= this.graceMs) return true;
    }
    return false;
  }

  get size(): number {
    return this.at.size;
  }
}

/** Ids seen recently (sealed into a block), kept for `keepMs`. */
export class RecentIds {
  private at = new Map<string, number>();

  constructor(private readonly keepMs: number) {}

  add(ids: Iterable<string>, now: number): void {
    for (const id of ids) this.at.set(id, now);
    this.prune(now);
  }

  has(id: string): boolean {
    return this.at.has(id);
  }

  prune(now: number): void {
    for (const [id, since] of this.at) {
      if (now - since > this.keepMs) this.at.delete(id);
    }
  }
}

/** Ids the node lists that we neither show nor just sealed, oldest listing order kept. */
export function freshIds(
  listed: readonly string[],
  shown: { has(id: string): boolean },
  sealed: { has(id: string): boolean },
  cap: number
): string[] {
  const out: string[] = [];
  for (const id of listed) {
    if (typeof id !== "string" || id.length !== 64) continue;
    if (shown.has(id) || sealed.has(id)) continue;
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

/** Why a shown tx leaves: a block took it, or the node let it go. */
export type PoolExit = { id: string; reason: "confirmed" | "dropped" };

/**
 * A full poll's balls against the shown ones. `found`: the poll's rows (`isNew`: not shown before).
 *
 * A block can seal while the poll reads the node (the seal does not wait for the pool lock): its
 * txs stay out of the result (`late`), and a shown one leaves as confirmed at once, not through
 * the grace. Otherwise as before: a shown tx the poll missed waits its grace in live mode, then
 * leaves as dropped (as confirmed without the live loop, which has no grace).
 */
export function mergePoll<B extends { id: string }>(
  found: readonly ({ ball: B; isNew: boolean } | null)[],
  shown: ReadonlyMap<string, B>,
  o: { sealed: { has(id: string): boolean }; vanish: VanishClock; live: boolean; now: number }
): { next: Map<string, B>; added: B[]; removed: PoolExit[]; late: Set<string> } {
  const next = new Map<string, B>();
  const added: B[] = [];
  const removed: PoolExit[] = [];
  const late = new Set<string>();
  for (const row of found) {
    if (!row) continue;
    if (o.sealed.has(row.ball.id)) {
      late.add(row.ball.id);
      continue;
    }
    next.set(row.ball.id, row.ball);
    if (row.isNew) added.push(row.ball);
  }
  for (const [id, prev] of shown) {
    if (next.has(id)) {
      o.vanish.forget([id]);
      continue;
    }
    if (o.sealed.has(id)) {
      o.vanish.forget([id]);
      removed.push({ id, reason: "confirmed" });
      continue;
    }
    if (o.live && o.vanish.waiting(id, o.now)) {
      next.set(id, prev);
      continue;
    }
    removed.push({ id, reason: o.live ? "dropped" : "confirmed" });
  }
  return { next, added, removed, late };
}
