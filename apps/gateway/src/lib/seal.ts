/**
 * Detect ordering-block seals via tip height advance.
 */
import { replaySeed, type SealEvent } from "@ergoscan/shared";
import type { NodeClient } from "./node.js";

export class SealWatcher {
  private lastHeight: number | null = null;

  constructor(private node: NodeClient) {}

  /**
   * Returns seal event when height advances, else null.
   * `headerId` (the node's bestFullHeaderId) saves the /blocks/at lookup for the newest block.
   */
  async check(tipHeight: number | null | undefined, headerId?: string | null): Promise<SealEvent | null> {
    if (tipHeight == null || !Number.isFinite(tipHeight)) return null;
    if (this.lastHeight == null) {
      this.lastHeight = tipHeight;
      return null;
    }
    if (tipHeight <= this.lastHeight) return null;

    const height = tipHeight;
    const prev = this.lastHeight;
    this.lastHeight = tipHeight;

    try {
      const id =
        typeof headerId === "string" && headerId.length >= 16
          ? headerId
          : (await this.node.get<string[]>(`/blocks/at/${height}`, 5000))?.[0];
      if (!id) {
        return {
          blockId: `height-${height}`,
          height,
          timestamp: Date.now(),
          txIds: [],
          replaySeed: replaySeed(`h${height}`, height),
          txCount: 0,
        };
      }
      const full = await this.node.get<{
        header: { id: string; height: number; timestamp: number };
        blockTransactions?: { transactions?: { id: string }[] };
        size?: number;
      }>(`/blocks/${id}`, 12000);
      const txs = full.blockTransactions?.transactions ?? [];
      return {
        blockId: full.header.id,
        height: full.header.height,
        timestamp: full.header.timestamp,
        txIds: txs.map((t) => t.id),
        replaySeed: replaySeed(full.header.id, full.header.height),
        size: full.size,
        txCount: txs.length,
      };
    } catch {
      return {
        blockId: `height-${height}`,
        height,
        timestamp: Date.now(),
        txIds: [],
        replaySeed: replaySeed(`h${height}-${prev}`, height),
        txCount: 0,
      };
    }
  }
}
