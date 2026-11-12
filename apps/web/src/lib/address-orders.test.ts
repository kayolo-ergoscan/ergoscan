import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { linkOrders, type OrderRowIn } from "./address-orders";

const ME = "9fYVe8FpdUEZRwmVgDtFGbhB3JBSoNYVx8f7U3cYofrcUBYreou";
const UI = "9gvvy8e3Mj6LBJeomJnszw1tDsFeewZ122YK3PTJRpdkpuADDPB";
const POOL = "5vSUZRZbdVbnk4sJWjg2uhL94VZWRg4iatK9VgMChufzUgdihgvhR8yWSUEJKszz";
const ORDER_A = "6XN7PVhQoAorderContractAddressThatIsLongerThanAWallet0000000000000";
const ORDER_B = "4jDxre1SHdorderContractAddressThatIsLongerThanAWallet0000000000000";

const order = (id: string, height: number, contract: string): OrderRowIn => ({
  id,
  height,
  meaning: { action: "order-place", actor: ME },
  from: [ME],
  to: [contract, UI],
});
const fill = (id: string, height: number, contract: string): OrderRowIn => ({
  id,
  height,
  meaning: { action: "swap", actor: ME, viaOrder: true },
  from: [contract, POOL],
  to: [ME],
});

describe("address orders", () => {
  it("an order and its swap in the same block, listed in the gateway's order", () => {
    // Newest first, the order above its fill (as /v1/addresses lists one block).
    const rows = [order("037f", 1915271, ORDER_A), fill("b99d", 1915271, ORDER_A)];
    const links = linkOrders(rows, ME);
    assert.deepEqual(links.get("037f"), { side: "order", kind: "filled", other: "b99d", otherHeight: 1915271, sameBlock: true });
    assert.deepEqual(links.get("b99d"), { side: "fill", other: "037f", sameBlock: true });
  });

  it("the same order contract twice: each fill takes the latest order before it", () => {
    const rows = [
      fill("f2", 1726361, ORDER_B),
      order("o2", 1726361, ORDER_B),
      fill("f1", 1725578, ORDER_B),
      order("o1", 1725578, ORDER_B),
    ];
    const links = linkOrders(rows, ME);
    assert.equal(links.get("f1")?.other, "o1");
    assert.equal(links.get("f2")?.other, "o2");
    assert.equal(links.get("o1")?.other, "f1");
  });

  it("a fill in a later block and a cancel", () => {
    const rows = [
      { id: "c1", height: 120, meaning: { action: "order-cancel" as const, actor: ME }, from: [ORDER_B], to: [ME] },
      fill("f1", 110, ORDER_A),
      order("o2", 105, ORDER_B),
      order("o1", 100, ORDER_A),
    ];
    const links = linkOrders(rows, ME);
    assert.deepEqual(links.get("o1"), { side: "order", kind: "filled", other: "f1", otherHeight: 110, sameBlock: false });
    assert.deepEqual(links.get("o2"), { side: "order", kind: "cancelled", other: "c1", otherHeight: 120, sameBlock: false });
  });

  it("wallets are never the link; someone else's order is not ours; no order on the page = no link", () => {
    const theirs: OrderRowIn = { ...order("x", 100, ORDER_A), meaning: { action: "order-place", actor: UI } };
    assert.equal(linkOrders([fill("f", 101, ORDER_A), theirs], ME).size, 0);
    // Only the UI wallet in common.
    const viaWallet: OrderRowIn = { ...fill("f", 101, "none"), from: [UI, POOL] };
    assert.equal(linkOrders([viaWallet, order("o", 100, ORDER_A)], ME).size, 0);
    assert.equal(linkOrders([fill("f", 101, ORDER_A)], ME).size, 0);
  });
});
