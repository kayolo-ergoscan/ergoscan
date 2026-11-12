import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  MEANING_ACTION_IDS,
  MEANING_VOCAB,
  PROTOCOL_NAMES,
  TX_MEANING_VERSION,
  classifyTxMeaning,
  compactMeaning,
  formatAmount,
  meaningView,
  multisigOf,
  sayMeaning,
  type MeaningBox,
  type MeaningCtx,
  type MeaningTx,
} from "./index.js";

type Packed = Omit<MeaningBox, "assets"> & { assets?: Array<[string, string]> };
type Golden = {
  id: string;
  height: number;
  coinbase?: boolean;
  rent?: string;
  inputCount: number;
  outputCount: number;
  inputs: Packed[];
  outputs: Packed[];
  dataInputs?: Packed[];
  tokens: Record<string, [string | null, number | null]>;
  names: Record<string, string>;
  expect: { action: string; protocol: string | null; conf: string; ru: string; en: string };
};

/** 50 mainnet txs (Nov 2026), trimmed: long script addresses are cut to 16…8 characters. */
const GOLDEN: Golden[] = JSON.parse(
  fs.readFileSync(new URL("./golden.json", import.meta.url), "utf8")
);

const unpack = (b: Packed): MeaningBox => ({
  ...b,
  assets: (b.assets ?? []).map(([tokenId, amount]) => ({ tokenId, amount })),
});

function txOf(g: Golden): MeaningTx {
  return {
    id: g.id,
    coinbase: g.coinbase,
    rent: g.rent,
    inputCount: g.inputCount,
    outputCount: g.outputCount,
    inputs: g.inputs.map(unpack),
    outputs: g.outputs.map(unpack),
    dataInputs: g.dataInputs?.map(unpack),
  };
}

function ctxOf(g: Golden): MeaningCtx {
  return {
    token: (id) => {
      const t = g.tokens[id];
      return t ? { name: t[0], decimals: t[1] } : null;
    },
    nameOf: (a) => (g.names[a] ? { name: g.names[a]! } : null),
  };
}

function byId(prefix: string): Golden {
  const g = GOLDEN.find((x) => x.id.startsWith(prefix));
  assert.ok(g, prefix);
  return g;
}

describe("tx meaning: golden set", () => {
  it("has at least 40 txs and covers most of the vocabulary", () => {
    assert.ok(GOLDEN.length >= 40);
    const seen = new Set(GOLDEN.map((g) => g.expect.action));
    assert.ok(seen.size >= 28, `actions covered: ${seen.size}`);
  });

  for (const g of GOLDEN) {
    it(`${g.id.slice(0, 8)} → ${g.expect.action}${g.expect.protocol ? ` · ${g.expect.protocol}` : ""}`, () => {
      const m = classifyTxMeaning(txOf(g), ctxOf(g));
      assert.equal(m.action, g.expect.action);
      assert.equal(m.protocol, g.expect.protocol);
      assert.equal(m.conf, g.expect.conf);
      assert.equal(m.say.ru, g.expect.ru);
      assert.equal(m.say.en, g.expect.en);
      assert.equal(m.v, TX_MEANING_VERSION);
      assert.equal(m.family, MEANING_VOCAB[m.action].family);
    });
  }
});

describe("tx meaning: rules", () => {
  it("box order and token order never change the answer", () => {
    for (const g of GOLDEN) {
      const tx = txOf(g);
      const flipped: MeaningTx = {
        ...tx,
        inputs: [...tx.inputs].reverse().map((b) => ({ ...b, assets: [...(b.assets ?? [])].reverse() })),
        outputs: [...tx.outputs].reverse().map((b) => ({ ...b, assets: [...(b.assets ?? [])].reverse() })),
      };
      const a = classifyTxMeaning(tx, ctxOf(g));
      const b = classifyTxMeaning(flipped, ctxOf(g));
      assert.equal(b.action, a.action, g.id);
      assert.equal(b.say.ru, a.say.ru, g.id);
    }
  });

  it("a third-party payment stays a plain short address, no name and no role", () => {
    const m = classifyTxMeaning(txOf(byId("a323e730")), ctxOf(byId("a323e730")));
    assert.equal(m.extra.length, 1);
    const x = m.extra[0]!;
    assert.ok(x.to.startsWith("9gvv") && x.to.endsWith("DDPB"));
    assert.equal(x.role, undefined);
    assert.equal(x.name, undefined);
    assert.equal(x.asset.token, null);
    assert.equal(x.asset.amount, "1771972931");
    assert.deepEqual(m.gave.map((a) => a.token), [null]);
    assert.equal(m.fee.payer, m.actor);
  });

  it("pools carry only our protocol names: ErgoDex, Crux, LithosDex and the rest of the registry", () => {
    const names = new Set(Object.values(PROTOCOL_NAMES).map((n) => n.en));
    const venues = new Set([...names, "ErgoDex V3"]);
    for (const g of GOLDEN) {
      const m = classifyTxMeaning(txOf(g), ctxOf(g));
      assert.ok(m.protocol === null || m.protocol in PROTOCOL_NAMES, g.id);
      for (const v of m.venues) assert.ok(venues.has(v), `${g.id}: ${v}`);
    }
    const routed = classifyTxMeaning(txOf(byId("4f929c15")), ctxOf(byId("4f929c15")));
    assert.deepEqual(routed.venues, ["Crux", "ErgoDex", "ErgoDex V3"]);
  });

  it("oracle, upkeep and bridge settlement rows fold; user actions do not", () => {
    const fold = (p: string) => classifyTxMeaning(txOf(byId(p)), ctxOf(byId(p))).service;
    assert.equal(fold("9a430ec5"), true);
    assert.equal(fold("f9d111fe"), true);
    assert.equal(fold("26d5619a"), true);
    assert.equal(fold("a323e730"), false);
    assert.equal(fold("ed512b15"), false);
  });

  it("an order fill hides the executor's fee from the user", () => {
    const m = classifyTxMeaning(txOf(byId("b99df42b")), ctxOf(byId("b99df42b")));
    assert.equal(m.viaOrder, true);
    assert.equal(m.fee.payer, null);
    assert.equal(m.fee.nano, "50000000");
  });

  it("v1 oracle update counts the datapoints read as data inputs, v2 the spent ones", () => {
    assert.equal(classifyTxMeaning(txOf(byId("39451a3d")), ctxOf(byId("39451a3d"))).count, 4);
    assert.equal(classifyTxMeaning(txOf(byId("f9d111fe")), ctxOf(byId("f9d111fe"))).count, 8);
    const noData = { ...txOf(byId("39451a3d")), dataInputs: undefined };
    const m = classifyTxMeaning(noData, ctxOf(byId("39451a3d")));
    assert.equal(m.action, "oracle-update");
    assert.equal(m.say.ru, "Оракул ERG/USD обновил курс");
  });

  it("a k-of-n key box is a wallet, not a contract", () => {
    const g = byId("85975b44");
    const tree = g.inputs[0]!.ergoTree!;
    assert.deepEqual(multisigOf(tree), { k: 3, n: 5 });
    const m = classifyTxMeaning(txOf(g), ctxOf(g));
    assert.equal(m.action, "send");
    assert.ok(m.why.some((w) => w.k === "multisig" && w.v === "3/5"));
    assert.equal(multisigOf("0008cd02b78225fbf94345e65ac70306b545702fb8fa64862c1e24af3143a35bf2a27842"), null);
  });

  it("a pool payout does not count the pool's own wallet (it spent a box and got change)", () => {
    const g = byId("c787bf08");
    const m = classifyTxMeaning(txOf(g), ctxOf(g));
    const spenders = new Set(g.inputs.filter((b) => b.address.startsWith("9")).map((b) => b.address));
    assert.ok(spenders.size >= 1);
    assert.equal(m.count, 1);
    assert.equal(m.actorName, "2miners");
    assert.equal(m.sub, "pool");
    // 6 ERG left the locks; the pool's own wallet kept its part, the one miner got the rest.
    assert.ok(BigInt(m.gave[0]!.amount) < 3_000_000_000n);
  });

  it("a contract that trades on its own is not named: the venue is the subject", () => {
    const m = classifyTxMeaning(txOf(byId("0b45de0f")), ctxOf(byId("0b45de0f")));
    assert.equal(m.actor, null);
    assert.equal(m.fee.payer, null);
    assert.ok(m.why.some((w) => w.k === "no-signer"));
    assert.ok(m.say.ru.startsWith("LithosDex обменял"));
    assert.ok(m.say.en.startsWith("LithosDex swapped"));
  });

  it("a bridge lock without registers is not exact: the other side is unknown", () => {
    const m = classifyTxMeaning(txOf(byId("7ba689a5")), ctxOf(byId("7ba689a5")));
    assert.equal(m.action, "bridge-out");
    assert.equal(m.conf, "flow");
    assert.ok(!m.chain);
    assert.equal(classifyTxMeaning(txOf(byId("2161fa06")), ctxOf(byId("2161fa06"))).conf, "exact");
  });

  it("a huge cut-short tx is flagged and still counted", () => {
    const g = byId("70e7d6c7");
    const tx = txOf(g);
    const cut: MeaningTx = { ...tx, outputs: tx.outputs.slice(0, 20), outputCount: tx.outputs.length };
    const m = classifyTxMeaning(cut, ctxOf(g));
    assert.equal(m.truncated, true);
    assert.equal(m.action, "multisend");
    assert.ok((m.count ?? 0) >= 90);
  });
});

describe("tx meaning: list form", () => {
  it("the list form gives the same phrase in both languages, also after JSON", () => {
    for (const g of GOLDEN) {
      const m = classifyTxMeaning(txOf(g), ctxOf(g));
      const c = JSON.parse(JSON.stringify(compactMeaning(m)));
      assert.equal(sayMeaning(c, "ru"), m.say.ru, g.id);
      assert.equal(sayMeaning(c, "en"), m.say.en, g.id);
      assert.equal(c.service === true, m.service, g.id);
      for (const k of ["say", "why", "rule", "family", "fee"]) assert.ok(!(k in c), `${g.id}: ${k}`);
    }
  });

  it("the list form is smaller and keeps the fee payer only when it is not the actor", () => {
    let full = 0;
    let slim = 0;
    for (const g of GOLDEN) {
      const m = classifyTxMeaning(txOf(g), ctxOf(g));
      const c = compactMeaning(m);
      full += JSON.stringify(m).length;
      slim += JSON.stringify(c).length;
      if (m.fee.nano === "0" || m.fee.payer === m.actor) assert.ok(!("feePayer" in c), g.id);
      else assert.equal(c.feePayer, m.fee.payer, g.id);
    }
    assert.ok(slim * 2 < full, `${slim} vs ${full}`);
    const fill = compactMeaning(classifyTxMeaning(txOf(byId("b99df42b")), ctxOf(byId("b99df42b"))));
    assert.equal(fill.feePayer, null);
  });

  it("the address view reads the list form the same way", () => {
    for (const g of GOLDEN) {
      const m = classifyTxMeaning(txOf(g), ctxOf(g));
      if (!m.actor) continue;
      assert.deepEqual(meaningView(compactMeaning(m), m.actor), meaningView(m, m.actor), g.id);
    }
  });

  it("the phrase module has no node imports (the browser uses it)", () => {
    const src = fs.readFileSync(new URL("./summary.ts", import.meta.url), "utf8");
    assert.ok(!/from "node:|require\(|process\.|Buffer/.test(src));
  });
});

describe("tx meaning: words and numbers", () => {
  it("34 words, each with RU, EN and a family", () => {
    assert.equal(MEANING_ACTION_IDS.length, 34);
    for (const id of MEANING_ACTION_IDS) {
      const w = MEANING_VOCAB[id];
      assert.ok(w.ru && w.en && w.family, id);
    }
  });

  it("amounts: whole millions, two decimals from 1, four digits below", () => {
    assert.equal(formatAmount(6000570000000n, 9), "6 000.57");
    assert.equal(formatAmount(2339722000000000n, 9), "2 339 722");
    assert.equal(formatAmount(1772000000n, 9), "1.77");
    assert.equal(formatAmount(1100000n, 9), "0.0011");
    assert.equal(formatAmount(999999999n, 9), "1.00");
    assert.equal(formatAmount(1n, 9), "0.000000001");
    assert.equal(formatAmount(8870n, 0), "8 870");
    assert.equal(formatAmount(0n, 9), "0");
  });

  it("address view: the sender sees «Отправлено», the receiver «Получено»", () => {
    const g = byId("ed512b15");
    const m = classifyTxMeaning(txOf(g), ctxOf(g));
    assert.equal(meaningView(m, m.actor!).title.ru, "Отправлено");
    assert.equal(meaningView(m, m.actor!).sign, -1);
    const to = meaningView(m, m.counterparty!);
    assert.equal(to.title.ru, "Получено");
    assert.equal(to.sign, 1);
    const pay = classifyTxMeaning(txOf(byId("d0f6f6f5")), ctxOf(byId("d0f6f6f5")));
    assert.equal(meaningView(pay, "9giHM5F93ZHVsomeminer", "553782771").title.ru, "Выплата от пула");
    const inn = classifyTxMeaning(txOf(byId("e1494456")), ctxOf(byId("e1494456")));
    assert.equal(meaningView(inn, inn.actor!).title.ru, "Получено из Cardano");
    const post = classifyTxMeaning(txOf(byId("9a430ec5")), ctxOf(byId("9a430ec5")));
    assert.equal(meaningView(post, post.actor!).title.ru, "Цена отправлена");
  });
});
