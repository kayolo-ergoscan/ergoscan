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
