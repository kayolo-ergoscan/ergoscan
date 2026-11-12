/**
 * An order and what became of it, on one address page: the order tx pays into an order contract
 * («Заявка на обмен»), a later tx spends that contract (the swap it asked for, or a cancel).
 * The address activity already lists every tx's input and output addresses, so the link is the
 * contract address both txs share. An order contract with the same terms can repeat, so each fill
 * takes the latest open order before it. Pure; nothing is fetched.
 */
import type { CompactMeaning } from "@ergoscan/shared";

export type OrderRowIn = {
  id: string;
  height: number | null;
  meaning?: Pick<CompactMeaning, "action" | "actor" | "viaOrder"> | null;
  from: readonly string[];
  to: readonly string[];
};

export type OrderLink =
  /** On the order: what happened to it. */
  | { side: "order"; kind: "filled" | "cancelled"; other: string; otherHeight: number | null; sameBlock: boolean }
  /** On the fill or the cancel: the order it came from. */
  | { side: "fill"; other: string; sameBlock: boolean };

/** A wallet (P2PK) is never an order contract: fees and change go to wallets. */
const P2PK = /^9[1-9A-HJ-NP-Za-km-z]{50}$/;

function contracts(list: readonly string[], self: string): string[] {
  return list.filter((a) => a && a !== self && !P2PK.test(a));
}

function isOrder(r: OrderRowIn, self: string): boolean {
  return r.meaning?.action === "order-place" && r.meaning.actor === self;
}

function isFill(r: OrderRowIn): boolean {
  const m = r.meaning;
  return !!m && (m.action === "order-cancel" || m.viaOrder === true);
}

export function linkOrders(rows: readonly OrderRowIn[], self: string): Map<string, OrderLink> {
  const out = new Map<string, OrderLink>();
  // Oldest block first; inside a block the order comes before what spends it.
  const h = (r: OrderRowIn) => r.height ?? Number.MAX_SAFE_INTEGER;
  const sorted = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => isOrder(r, self) || isFill(r))
    .sort((a, b) => h(a.r) - h(b.r) || Number(isFill(a.r)) - Number(isFill(b.r)) || b.i - a.i)
    .map(({ r }) => r);
  const open = new Map<string, OrderRowIn[]>();
  for (const r of sorted) {
    if (isOrder(r, self)) {
      for (const a of contracts(r.to, self)) {
        const list = open.get(a) ?? [];
        list.push(r);
        open.set(a, list);
      }
      continue;
    }
    for (const a of contracts(r.from, self)) {
      const list = open.get(a);
      const order = list?.pop();
      if (!order || out.has(order.id)) continue;
      const sameBlock = order.height != null && order.height === r.height;
      const kind = r.meaning?.action === "order-cancel" ? "cancelled" : "filled";
      out.set(order.id, { side: "order", kind, other: r.id, otherHeight: r.height, sameBlock });
      out.set(r.id, { side: "fill", other: order.id, sameBlock });
      break;
    }
  }
  return out;
}
