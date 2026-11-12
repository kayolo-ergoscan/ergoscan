/**
 * The top of a tx page from its meaning: the row words (action, protocol), the phrase, the
 * cards «Отдал» / «Получил» / «Куда ушли деньги» / «Комиссия сети · платил X», and the
 * «Как определили» line from the rule and its facts. Pure, RU and EN, no lookups.
 */
import { shortAddr } from "./facts.js";
import { sayMeaning, type Lang } from "./summary.js";
import {
  POOL_ACTIONS,
  WITH_TO,
  asset,
  chainTo,
  enCount,
  meaningRow,
  ruCount,
  ruTo,
  type MeaningParty,
  type MeaningRow,
  type MeaningRowInput,
} from "./row.js";
import type { MeaningAssetLike, MeaningConf, WhyFact } from "./types.js";

/** A full meaning (tx endpoint) or the list form; the page reads the fee from `fee` or `feePayer`. */
export type MeaningPageInput = MeaningRowInput & {
  fee?: { payer: string | null; nano: string };
  feePayer?: string | null;
  why?: readonly WhyFact[];
  rule?: string;
};

/** One line of «Куда ушли деньги»: an amount and where it went (an address, or a word). */
export type MeaningFlow = { asset: MeaningAssetLike; to: MeaningParty | null; word: string | null };

export type MeaningCard =
  | { key: "gave" | "got"; title: string; assets: MeaningAssetLike[]; sign: -1 | 1; note: string | null }
  | { key: "flows"; title: string; flows: MeaningFlow[] }
  | { key: "fee"; title: string; nano: string; payer: MeaningParty | null; note: string };

export type MeaningPage = {
  row: MeaningRow;
  phrase: string;
  cards: MeaningCard[];
  /** «Как определили»: the facts the rule saw, one sentence; "" when there are none. */
  how: string;
  /** The rule that answered, in words («пулы»); null when unknown. */
  rule: string | null;
  /** Addresses the phrase names, with the label it prints, for links. */
  parties: Array<MeaningParty & { label: string }>;
};

const W = {
  gave: { ru: "Отдал", en: "Gave" },
  got: { ru: "Получил", en: "Got" },
  flows: { ru: "Куда ушли деньги", en: "Where the money went" },
  fee: { ru: "Комиссия сети", en: "Network fee" },
  noFee: { ru: "без комиссии сети", en: "network fee not included" },
  paidBy: { ru: "платил", en: "paid by" },
  paidByContract: { ru: "платил контракт", en: "paid by a contract" },
  payout: { ru: "Выплатил майнерам", en: "Paid to miners" },
  lpBack: { ru: "Вернул в пул", en: "Returned to the pool" },
  lpShares: { ru: "доли пула", en: "pool shares" },
  reemission: { ru: "реэмиссия", en: "reemission" },
  executor: { ru: "исполнителю", en: "executor" },
  order: { ru: "в заявку", en: "into an order" },
} as const;

/** The rule names of RULES, in words. */
const RULE_WORDS: Record<string, { ru: string; en: string }> = {
  consensus: { ru: "консенсус", en: "consensus" },
  oracle: { ru: "оракул", en: "oracle" },
  "pool-create": { ru: "новый пул", en: "new pool" },
  pools: { ru: "пулы", en: "pools" },
  orders: { ru: "заявки", en: "orders" },
  banks: { ru: "банки стейблкоинов", en: "stablecoin banks" },
  rosen: { ru: "мост Rosen", en: "Rosen bridge" },
  lithos: { ru: "Lithos", en: "Lithos" },
  lending: { ru: "займы", en: "lending" },
  names: { ru: "имена", en: "names" },
  auction: { ru: "аукцион", en: "auction" },
  mixer: { ru: "миксер", en: "mixer" },
  deposits: { ru: "вклады", en: "deposits" },
  dexy: { ru: "Dexy", en: "Dexy" },
  "known-contract": { ru: "известный контракт", en: "known contract" },
  issue: { ru: "выпуск токена", en: "token issue" },
  burn: { ru: "сжигание", en: "burn" },
  "unknown-contract": { ru: "незнакомый контракт", en: "unknown contract" },
  wallets: { ru: "кошельки", en: "wallets" },
};

export function ruleWord(rule: string | null | undefined, lang: Lang): string | null {
  if (!rule || rule === "none") return null;
  return RULE_WORDS[rule]?.[lang] ?? rule;
}

/** A registry label as is; an address or a script hash cut to 4…4. */
function label(v: string | undefined): string {
  if (!v) return "?";
  return /\s/.test(v) || v.length <= 24 ? v : shortAddr(v);
}

function tokenName(m: MeaningPageInput, id: string | undefined): string {
  if (!id) return "?";
  const a = [...(m.gave ?? []), ...(m.got ?? [])].find((x) => x.token === id);
  return a?.name?.trim() || `${id.slice(0, 6)}…`;
}

function factText(f: WhyFact, m: MeaningPageInput, lang: Lang): string | null {
  const ru = lang === "ru";
  const n = f.n ?? 0;
  switch (f.k) {
    case "spent":
      if (n > 1) return ru ? `потрачено ${ruCount(n, "бокс", "бокса", "боксов")} «${label(f.v)}»` : `spent ${enCount(n, "box", "boxes")} of «${label(f.v)}»`;
      return ru ? `потрачен «${label(f.v)}»` : `spent «${label(f.v)}»`;
    case "created":
      return ru ? `создан «${label(f.v)}»` : `paid into «${label(f.v)}»`;
    case "spent-unknown":
      return ru ? `потрачен незнакомый контракт ${label(f.v)}` : `spent an unknown contract ${label(f.v)}`;
    case "created-unknown":
      return ru ? `деньги ушли в незнакомый контракт ${label(f.v)}` : `paid into an unknown contract ${label(f.v)}`;
    case "minted":
      return ru ? `выпущен токен ${tokenName(m, f.v)}` : `token ${tokenName(m, f.v)} minted`;
    case "burned":
      return ru ? `сожжён токен ${tokenName(m, f.v)}` : `token ${tokenName(m, f.v)} burned`;
    case "order":
      return ru ? `исполнена заявка ${label(f.v)}` : `order ${label(f.v)} filled`;
    case "no-signer":
      if (f.v) return ru ? `кошелёк не подписывал, контракт ${label(f.v)} сработал сам` : `no wallet signed; contract ${label(f.v)} acted on its own`;
      return ru ? "кошелёк не подписывал" : "no wallet signed";
    case "datapoints":
      return ru ? `по ${ruTo(n, "ответу", "ответам")} операторов` : `from ${enCount(n, "operator post", "operator posts")}`;
    case "fee-payer":
      return ru ? "кто — кошелёк, плативший комиссию" : "who: the wallet that paid the fee";
    case "multisig":
      return ru ? `мультиподпись ${f.v ?? ""}`.trim() : `multisig ${f.v ?? ""}`.trim();
    case "no-registers":
      return ru ? "регистры моста не прочитаны" : "bridge registers not read";
    case "rent":
      return ru ? `плата за хранение: ${ruCount(n, "старый бокс", "старых бокса", "старых боксов")}` : `storage rent: ${enCount(n, "old box", "old boxes")}`;
    case "truncated":
      return ru ? `транзакция большая (${ruCount(n, "бокс", "бокса", "боксов")}), прочитаны не все` : `a large tx (${enCount(n, "box", "boxes")}), not all were read`;
    default:
      return null;
  }
}

function confText(conf: MeaningConf | undefined, lang: Lang): string | null {
  const ru = lang === "ru";
  if (conf === "flow") return ru ? "по движению денег" : "by how the money moved";
  if (conf === "guess") return ru ? "вероятно: точного признака нет" : "likely: no exact sign";
  if (conf === "unknown") return ru ? "этот контракт нам не знаком" : "we do not know this contract";
  return null;
}

/** «Потрачен «ErgoDex AMM Pool (ERG/token)»; по движению денег.» — one sentence, or "". */
export function sayHow(m: MeaningPageInput, lang: Lang): string {
  const parts: string[] = [];
  for (const f of m.why ?? []) {
    const s = factText(f, m, lang);
    if (s && !parts.includes(s)) parts.push(s);
  }
  const c = confText(m.conf, lang);
  if (c) parts.push(c);
  if (!parts.length) return "";
  const text = parts.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function partyOf(addr: string | null | undefined, name: string | null | undefined): MeaningParty | null {
  return addr && addr !== "?" ? { addr, name: name ?? null } : null;
}

function flowsOf(m: MeaningPageInput, r: MeaningRow, lang: Lang): MeaningFlow[] {
  const out: MeaningFlow[] = [];
  const gave = (m.gave ?? []).map(asset);
  if (gave.length) {
    if (POOL_ACTIONS.has(m.action) && r.where) {
      const word = lang === "ru" ? `пул ${r.where}` : `${r.where} pool`;
      for (const a of gave) out.push({ asset: a, to: null, word });
    } else if (WITH_TO.has(m.action) && m.counterparty && m.sub !== "own") {
      for (const a of gave) out.push({ asset: a, to: partyOf(m.counterparty, m.counterpartyName), word: null });
    } else if (m.action === "bridge-out") {
      for (const a of gave) out.push({ asset: a, to: null, word: chainTo(m.chain, lang) });
    } else if (m.action === "order-place") {
      for (const a of gave) out.push({ asset: a, to: null, word: W.order[lang] });
    }
  }
  for (const e of m.extra ?? []) {
    const a = asset(e.asset);
    if (e.role === "reemission") out.push({ asset: a, to: null, word: W.reemission[lang] });
    else if (e.role === "executor") out.push({ asset: a, to: partyOf(e.to, e.name), word: W.executor[lang] });
    else out.push({ asset: a, to: partyOf(e.to, e.name), word: null });
  }
  return out;
}

/** One flow of the one asset given, into a word («пул ErgoDex», «в заявку»): the phrase and «Отдал» say it. */
function echoesGave(flows: readonly MeaningFlow[], gave: readonly MeaningAssetLike[]): boolean {
  if (flows.length !== 1 || gave.length !== 1) return false;
  const [f] = flows;
  const [g] = gave;
  return !f!.to && f!.asset.amount === g!.amount && (f!.asset.token ?? null) === (g!.token ?? null);
}

/** Who paid the network fee: the full form has `fee.payer`; the list form only says when it was not the actor. */
function feeOf(m: MeaningPageInput, feeNano: string | null | undefined): { nano: string; payer: string | null } | null {
  const nano = m.fee?.nano ?? feeNano ?? "0";
  if (!/^\d+$/.test(nano) || BigInt(nano) <= 0n) return null;
  const payer = m.fee ? m.fee.payer : m.feePayer !== undefined ? m.feePayer : (m.actor ?? null);
  return { nano, payer };
}

export function meaningPage(m: MeaningPageInput, lang: Lang, opts: { feeNano?: string | null } = {}): MeaningPage {
  const r = meaningRow(m, lang);
  const fee = feeOf(m, opts.feeNano);
  const actorPaid = fee != null && fee.payer != null && fee.payer === m.actor;
  const cards: MeaningCard[] = [];
  const gave = (m.gave ?? []).map(asset);
  const got = (m.got ?? []).map(asset);
  if (gave.length) {
    const payout = m.action === "miner-payout";
    const lp = m.action === "lp-remove";
    const n = m.count ?? 0;
    const note = payout && m.sub === "pool" && n
      ? lang === "ru"
        ? ruTo(n, "майнеру", "майнерам")
        : `to ${enCount(n, "miner", "miners")}`
      : lp
        ? W.lpShares[lang]
        : actorPaid
          ? W.noFee[lang]
          : null;
    cards.push({ key: "gave", title: (payout ? W.payout : lp ? W.lpBack : W.gave)[lang], assets: gave, sign: -1, note });
  }
  if (got.length) {
    cards.push({ key: "got", title: W.got[lang], assets: got, sign: 1, note: m.action === "lp-add" ? W.lpShares[lang] : null });
  }
  const flows = flowsOf(m, r, lang);
  if (flows.length && !echoesGave(flows, gave)) cards.push({ key: "flows", title: W.flows[lang], flows });
  if (fee) {
    const payer = fee.payer
      ? fee.payer === m.actor
        ? partyOf(m.actor, m.actorName)
        : partyOf(fee.payer, null)
      : null;
    cards.push({ key: "fee", title: W.fee[lang], nano: fee.nano, payer, note: payer ? W.paidBy[lang] : W.paidByContract[lang] });
  }
  const parties: Array<MeaningParty & { label: string }> = [];
  const add = (p: MeaningParty | null) => {
    if (!p) return;
    const lbl = p.name || shortAddr(p.addr);
    if (!parties.some((x) => x.label === lbl)) parties.push({ ...p, label: lbl });
  };
  add(partyOf(m.actor, m.actorName));
  add(partyOf(m.counterparty, m.counterpartyName));
  for (const e of m.extra ?? []) if (e.role !== "reemission") add(partyOf(e.to, e.name));
  return {
    row: r,
    phrase: sayMeaning(m, lang),
    cards,
    how: sayHow(m, lang),
    rule: ruleWord(m.rule, lang),
    parties,
  };
}
