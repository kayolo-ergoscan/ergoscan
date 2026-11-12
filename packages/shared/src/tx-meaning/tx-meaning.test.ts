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
  meaningPage,
  meaningRow,
  meaningView,
  sayHow,
  isFoldedAction,
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

describe("tx meaning: list row", () => {
  const row = (p: string, lang: "ru" | "en" = "ru") => {
    const g = byId(p);
    return meaningRow(compactMeaning(classifyTxMeaning(txOf(g), ctxOf(g))), lang);
  };

  it("the list form and the full form give the same row", () => {
    for (const g of GOLDEN) {
      const m = classifyTxMeaning(txOf(g), ctxOf(g));
      for (const lang of ["ru", "en"] as const) {
        assert.deepEqual(meaningRow(JSON.parse(JSON.stringify(compactMeaning(m))), lang), meaningRow(m, lang), g.id);
      }
    }
  });

  it("a swap: who, the pools, gave left of the arrow, got big, «за …» on a phone", () => {
    const r = row("a323e730");
    assert.equal(r.word, "Обмен");
    assert.equal(r.where, "ErgoDex");
    assert.ok(r.who?.addr.startsWith("9fYV"));
    assert.equal(r.to, null);
    assert.deepEqual(r.gave.map((a) => a.token ?? "ERG"), ["ERG"]);
    assert.equal(r.big?.name, "RSN");
    assert.equal(r.phoneSub, "за 4.95 ERG");
    assert.deepEqual(r.notes, ["ещё 1.77 ERG → 9gvv…DDPB"]);
    assert.equal(row("a323e730", "en").phoneSub, "for 4.95 ERG");
    assert.equal(row("4f929c15").where, "Crux + ErgoDex + ErgoDex V3");
  });

  it("a transfer: who → whom, one figure, nothing on the left", () => {
    const r = row("ed512b15");
    assert.equal(r.to?.name, "KuCoin");
    assert.deepEqual(r.gave, []);
    assert.equal(r.big?.amount, "6000568900000");
    assert.equal(r.phoneSub, null);
    assert.equal(r.fold, false);
    assert.equal(row("b56cd85e").to, null);
    assert.deepEqual(row("b56cd85e").notes, ["между своими адресами"]);
  });

  it("a pool payout counts miners; the reemission share is a note", () => {
    const r = row("d0f6f6f5");
    assert.equal(r.who?.name, "Hero Miners");
    assert.deepEqual(r.notes, ["20 майнерам", "ещё 36.00 ERG → реэмиссия"]);
    assert.equal(r.phoneSub, "20 майнерам");
    assert.equal(row("d0f6f6f5", "en").phoneSub, "to 20 miners");
    assert.equal(r.where, null);
  });

  it("lp remove: the LP chip on the left, two tokens on the right", () => {
    const r = row("c580819c");
    assert.equal(r.gave.length, 1);
    assert.equal(r.big?.name, "GIF");
    assert.equal(r.more.length, 1);
    assert.equal(r.sub, "+ 118 GreasyCex");
    assert.equal(r.phoneSub, "+ 118 GreasyCex");
    assert.deepEqual(r.notes, ["по заявке"]);
  });

  it("machine rows fold and are quiet; people rows do not", () => {
    for (const p of ["9a430ec5", "39451a3d", "2f583c66", "84c4b346", "8733450c"]) {
      const r = row(p);
      assert.equal(r.fold, true, p);
      assert.equal(r.quiet, true, p);
    }
    for (const p of ["a323e730", "ed512b15", "d0f6f6f5", "9162503f"]) assert.equal(row(p).fold, false, p);
    assert.equal(row("9a430ec5").big, null);
    assert.equal(row("9a430ec5").where, "Оракул ERG/USD");
    const v1 = byId("39451a3d");
    const listed = compactMeaning(classifyTxMeaning({ ...txOf(v1), dataInputs: undefined }, ctxOf(v1)));
    assert.deepEqual(meaningRow(listed, "ru").notes, [], "lists have no data inputs: no count");
    assert.deepEqual(row("39451a3d").notes, ["по 4 ответам операторов"]);
    assert.ok(isFoldedAction("block-reward") && !isFoldedAction("miner-payout"));
  });

  it("bridges name the other chain; a guess says so; unknown is a contract call", () => {
    assert.deepEqual(row("e1494456").notes, ["из Cardano"]);
    assert.equal(row("e1494456").phoneSub, "из Cardano");
    assert.deepEqual(row("2161fa06").notes, ["в Cardano"]);
    assert.equal(row("2161fa06", "en").phoneSub, "to Cardano");
    assert.equal(row("fab5371d").guess, "вероятно");
    assert.equal(row("a323e730").guess, null);
    const u = row("67ff4af6");
    assert.equal(u.word, "Вызов контракта");
    assert.ok(u.to?.addr.startsWith("GZYz"));
  });

  it("a contract with no signer: no who, the venue speaks", () => {
    const r = row("0b45de0f");
    assert.equal(r.who, null);
    assert.equal(r.where, "LithosDex");
  });

  it("russian counts agree with the number", () => {
    const c = (n: number, lang: "ru" | "en" = "ru") =>
      meaningRow({ action: "consolidate", actor: "9x", count: n, count2: 1 }, lang).notes[0];
    assert.equal(c(1), "1 бокс → 1");
    assert.equal(c(3), "3 бокса → 1");
    assert.equal(c(12), "12 боксов → 1");
    assert.equal(c(21), "21 бокс → 1");
    assert.equal(c(1, "en"), "1 box → 1");
    const p = (n: number) => meaningRow({ action: "miner-payout", sub: "pool", actor: "88x", count: n }, "ru").notes[0];
    assert.equal(p(1), "1 майнеру");
    assert.equal(p(11), "11 майнерам");
    assert.equal(p(21), "21 майнеру");
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

describe("tx meaning: page header", () => {
  const full = (p: string) => {
    const g = byId(p);
    return classifyTxMeaning(txOf(g), ctxOf(g));
  };
  const page = (p: string, lang: "ru" | "en" = "ru") => meaningPage(full(p), lang);
  const keys = (p: string) => page(p).cards.map((c) => c.key);

  it("a swap: gave without the fee, got, the pool and the extra payment, the fee to who paid it", () => {
    const pg = page("a323e730");
    assert.deepEqual(keys("a323e730"), ["gave", "got", "flows", "fee"]);
    assert.equal(pg.row.word, "Обмен");
    assert.equal(pg.phrase, sayMeaning(full("a323e730"), "ru"));
    const [gave, , flows, fee] = pg.cards;
    assert.ok(gave?.key === "gave" && gave.note === "без комиссии сети" && gave.sign === -1);
    assert.ok(flows?.key === "flows");
    assert.deepEqual(flows.flows.map((f) => f.word ?? f.to?.addr.slice(0, 4)), ["пул ErgoDex", "9gvv"]);
    assert.ok(fee?.key === "fee" && fee.nano === "50000000" && fee.payer?.addr.startsWith("9fYV") && fee.note === "платил");
    assert.equal(pg.how, "Потрачен «ErgoDex AMM Pool (ERG/token)».");
    assert.equal(pg.rule, "пулы");
    assert.deepEqual(pg.parties.map((x) => x.label), ["9fYV…reou", "9gvv…DDPB"]);
    assert.equal(page("a323e730", "en").cards[2]?.title, "Where the money went");
  });

  it("removing liquidity: shares back to the pool, two tokens out, a contract paid the fee, the order is named", () => {
    const pg = page("c580819c");
    const gave = pg.cards[0]!;
    assert.ok(gave.key === "gave" && gave.title === "Вернул в пул" && gave.note === "доли пула");
    const got = pg.cards[1]!;
    assert.ok(got.key === "got" && got.assets.length === 2);
    const fee = pg.cards.find((c) => c.key === "fee")!;
    assert.ok(fee.key === "fee" && fee.payer === null && fee.note === "платил контракт");
    assert.deepEqual(keys("c580819c"), ["gave", "got", "fee"], "LP back into the pool is said once, by «Вернул в пул»");
    assert.match(pg.how, /^Потрачен «ErgoDex AMM Pool \(token\/token\)»; исполнена заявка 3qtA…/);
  });

  it("a miner payout: paid to N miners, reemission is a word, the rule is consensus", () => {
    const pg = page("d0f6f6f5");
    const gave = pg.cards[0]!;
    assert.ok(gave.key === "gave" && gave.title === "Выплатил майнерам" && gave.note === "20 майнерам");
    const flows = pg.cards.find((c) => c.key === "flows")!;
    assert.ok(flows.key === "flows" && flows.flows[0]?.word === "реэмиссия" && flows.flows[0]?.to === null);
    assert.equal(pg.how, "Потрачено 13 боксов «Miner reward lock».");
    assert.equal(pg.rule, "консенсус");
    assert.equal(page("d0f6f6f5", "en").how, "Spent 13 boxes of «Miner reward lock».");
  });

  it("an oracle update moves nothing for anyone: only the fee card; the posts are in «how»", () => {
    assert.deepEqual(keys("39451a3d"), ["fee"]);
    assert.equal(page("39451a3d").how, "Потрачен «Oracle v1 live epoch»; по 4 ответам операторов.");
  });

  it("a transfer goes to the exchange by name; a wallet rule says how it was read", () => {
    const pg = page("ed512b15");
    const flows = pg.cards.find((c) => c.key === "flows")!;
    assert.ok(flows.key === "flows" && flows.flows[0]?.to?.name === "KuCoin");
    assert.equal(pg.how, "Кто — кошелёк, плативший комиссию; по движению денег.");
    assert.deepEqual(pg.parties.map((x) => x.label), ["9hkY…HeMY", "KuCoin"]);
  });

  it("an unknown contract says so; no signer names the contract that acted", () => {
    assert.match(page("67ff4af6").how, /этот контракт нам не знаком\.$/);
    assert.equal(page("67ff4af6").row.word, "Вызов контракта");
    assert.match(page("0b45de0f").how, /кошелёк не подписывал, контракт kFBA…rmzt сработал сам\.$/);
    assert.deepEqual(page("0b45de0f").parties, []);
  });

  it("the list form with the row's fee gives the same cards", () => {
    for (const g of GOLDEN) {
      const m = classifyTxMeaning(txOf(g), ctxOf(g));
      const c = JSON.parse(JSON.stringify(compactMeaning(m)));
      for (const lang of ["ru", "en"] as const) {
        assert.deepEqual(meaningPage(c, lang, { feeNano: m.fee.nano }).cards, meaningPage(m, lang).cards, g.id);
      }
    }
  });

  it("every fact of the golden set has words in both languages", () => {
    for (const g of GOLDEN) {
      const m = classifyTxMeaning(txOf(g), ctxOf(g));
      for (const lang of ["ru", "en"] as const) {
        const how = sayHow(m, lang);
        if (m.why.length || m.conf !== "exact") assert.ok(how.length > 3, `${g.id} ${lang}`);
        assert.ok(!how.includes("undefined"), g.id);
      }
    }
  });
});
