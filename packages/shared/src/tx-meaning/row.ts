/**
 * A list row from a meaning (full or list form): the words of line 1 and 2 and the amounts
 * for the right side. Pure and without lookups, so the browser builds rows with it and every
 * list says the same words in RU and EN.
 *
 *   line 1  word · where              «Обмен · ErgoDex»
 *   line 2  who → to · notes          «9fYV…reou · по заявке · ещё 1.77 ERG → 9gvv…DDPB»
 *   right   gave → big (+ more)       «6.73 ERG → 132.36 RSN»; one side alone; nothing = «—»
 *   phone   big, phoneSub             «132.36 RSN», «за 6.73 ERG»
 */
import { PROTOCOL_NAMES, type ProtocolId } from "./registry.js";
import { assetText, extraNote, type Lang } from "./summary.js";
import type { MeaningAssetLike, MeaningConf, MeaningPhraseInput } from "./types.js";
import { MEANING_VOCAB, isFoldedAction, type MeaningActionId, type MeaningFamily } from "./vocab.js";

export type MeaningRowInput = MeaningPhraseInput & { conf?: MeaningConf; truncated?: boolean };

export type MeaningParty = { addr: string; name: string | null };

export type MeaningRow = {
  action: MeaningActionId;
  family: MeaningFamily;
  /** The action word (MEANING_VOCAB). */
  word: string;
  /** Protocol or pools, muted after the word; null for plain moves and mining. */
  where: string | null;
  who: MeaningParty | null;
  to: MeaningParty | null;
  /** Detail words for line 2, in order. */
  notes: string[];
  /** Grey word for a guess («вероятно»); null when the rule is sure. */
  guess: string | null;
  /** What the actor gave, shown left of the arrow; empty when only one side moved. */
  gave: MeaningAssetLike[];
  /** The big figure on the right; null when nothing moved for the actor («—»). */
  big: MeaningAssetLike | null;
  /** More assets on the big side: «+ 118 GreasyCex». */
  more: MeaningAssetLike[];
  /** Under the figure on a desktop: the rest of the big side. */
  sub: string | null;
  /** Under the figure on a phone: «за 6.73 ERG», «19 майнерам», «из Cardano». */
  phoneSub: string | null;
  /** Quiet title and tile. */
  quiet: boolean;
  /** Folds into «Служебные: N» on a busy list. */
  fold: boolean;
};

/** Russian noun after a number: 1 бокс, 2 бокса, 5 боксов. */
export function ruCount(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  const w = a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
  return `${n} ${w}`;
}

/** Russian dative after a number: 1 майнеру, 2 майнерам, 21 майнеру. */
export function ruTo(n: number, one: string, more: string): string {
  return `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : more}`;
}

export function enCount(n: number, one: string, more: string): string {
  return `${n} ${n === 1 ? one : more}`;
}

export const POOL_ACTIONS: ReadonlySet<MeaningActionId> = new Set(["swap", "lp-add", "lp-remove", "pool-create"]);
/** Actions whose counterparty is the other side of the line: «кто → с кем». */
export const WITH_TO: ReadonlySet<MeaningActionId> = new Set(["send", "loan", "contract-call", "to-contract"]);

function whereOf(m: MeaningRowInput, lang: Lang): string | null {
  const p = m.protocol;
  if (!p || p === "ergo") return null;
  if (POOL_ACTIONS.has(m.action) && m.venues?.length) return m.venues.join(" + ");
  const name = PROTOCOL_NAMES[p as ProtocolId]?.[lang] ?? p;
  return p === "oracle" && m.pair ? `${name} ${m.pair}` : name;
}

export function chainTo(chain: string | null | undefined, lang: Lang): string {
  if (lang === "ru") return chain ? `в ${chain}` : "в другую сеть";
  return chain ? `to ${chain}` : "to another chain";
}

function chainFrom(chain: string | null | undefined, lang: Lang): string {
  if (lang === "ru") return chain ? `из ${chain}` : "из другой сети";
  return chain ? `from ${chain}` : "from another chain";
}

function notesOf(m: MeaningRowInput, lang: Lang): string[] {
  const ru = lang === "ru";
  const n = m.count ?? 0;
  const out: string[] = [];
  const say = (r: string, e: string) => out.push(ru ? r : e);
  switch (m.action) {
    case "send":
      if (m.sub === "own") say("между своими адресами", "between its own addresses");
      break;
    case "multisend":
      if (n) say(ruTo(n, "адресу", "адресам"), `to ${enCount(n, "address", "addresses")}`);
      break;
    case "consolidate":
      say(`${ruCount(n, "бокс", "бокса", "боксов")} → ${m.count2 ?? 0}`, `${enCount(n, "box", "boxes")} → ${m.count2 ?? 0}`);
      break;
    case "miner-payout":
      if (m.sub === "pool" && n) say(ruTo(n, "майнеру", "майнерам"), `to ${enCount(n, "miner", "miners")}`);
      break;
    case "rent":
      if (n) say(ruCount(n, "старый бокс", "старых бокса", "старых боксов"), enCount(n, "old box", "old boxes"));
      break;
    case "name-register":
      if (m.sub === "commit") say("заявка на имя", "name request");
      else if (m.label) out.push(m.label);
      break;
    case "swap":
    case "lp-add":
    case "lp-remove":
      if (m.viaOrder) say("по заявке", "by order");
      break;
    case "pool-create":
      if (m.pair) say(`пул ${m.pair}`, `${m.pair} pool`);
      break;
    case "order-cancel":
      if (m.sub === "loan") say("заявка на заём", "loan request");
      break;
    case "loan":
      if (m.sub === "lend") say("выдан", "lent");
      else if (m.sub === "request") say("заявка на заём", "loan request");
      else if (m.sub === "claim") say("залог забран", "collateral claimed");
      else if (m.sub === "borrow") say("взят", "borrowed");
      break;
    case "stake":
      if (m.sub === "open") say("резерв открыт", "reserve opened");
      break;
    case "payout":
      if (m.sub === "reserve") say("из резерва", "from a reserve");
      break;
    case "auction":
      if (m.sub === "list") say("лот выставлен", "lot listed");
      else if (m.sub === "bid") say("ставка", "bid");
      else say("лот закрыт", "lot settled");
      break;
    case "bridge-out":
      out.push(chainTo(m.chain, lang));
      break;
    case "bridge-in":
      out.push(chainFrom(m.chain, lang));
      break;
    case "oracle-update":
      if (n) say(`по ${ruTo(n, "ответу", "ответам")} операторов`, `from ${enCount(n, "operator post", "operator posts")}`);
      break;
    case "service":
      if (m.sub === "oracle-round") say("новый раунд", "new round");
      else if (m.sub === "oracle-governance") say("голосование за контракт", "contract vote");
      else if (m.sub === "bridge-settle") say(m.chain ? `перевод в ${m.chain} закрыт` : "перевод закрыт", m.chain ? `transfer to ${m.chain} settled` : "transfer settled");
      else if (m.sub === "watcher-report") say("подтверждение перевода", "transfer report");
      else if (m.label) out.push(`«${m.label}»`);
      break;
    case "contract-call":
    case "to-contract":
      if (m.protocol && m.label) out.push(`«${m.label}»`);
      break;
    default:
      break;
  }
  const extra = extraNote(m.extra, lang);
  if (extra) out.push(extra);
  return out;
}

function phoneSubOf(m: MeaningRowInput, gave: MeaningAssetLike[], more: MeaningAssetLike[], lang: Lang): string | null {
  const ru = lang === "ru";
  if (more.length) return moreText(more);
  if (gave.length) return `${ru ? "за" : "for"} ${assetText(gave[0]!)}`;
  const n = m.count ?? 0;
  switch (m.action) {
    case "miner-payout":
      return m.sub === "pool" && n ? (ru ? ruTo(n, "майнеру", "майнерам") : `to ${enCount(n, "miner", "miners")}`) : null;
    case "multisend":
      return n ? (ru ? ruTo(n, "адресу", "адресам") : `to ${enCount(n, "address", "addresses")}`) : null;
    case "order-place":
      return ru ? "в заявку" : "into an order";
    case "order-cancel":
      return ru ? "вернулось" : "returned";
    case "bridge-out":
      return chainTo(m.chain, lang);
    case "bridge-in":
      return chainFrom(m.chain, lang);
    default:
      return null;
  }
}

function moreText(more: MeaningAssetLike[]): string {
  const head = `+ ${assetText(more[0]!)}`;
  return more.length > 1 ? `${head} +${more.length - 1}` : head;
}

/** One shape for both forms: no token = ERG; token name and decimals only when known. */
export function asset(a: MeaningAssetLike): MeaningAssetLike {
  if (!a.token) return { amount: a.amount };
  const out: MeaningAssetLike = { token: a.token, amount: a.amount };
  if (a.name) out.name = a.name;
  if (a.decimals) out.decimals = a.decimals;
  return out;
}

export function meaningRow(m: MeaningRowInput, lang: Lang): MeaningRow {
  // Nothing we know was touched: «Вызов контракта» and the contract's short address.
  const word = MEANING_VOCAB[m.conf === "unknown" ? "contract-call" : m.action];
  const gaveAll = (m.gave ?? []).map(asset);
  const gotAll = (m.got ?? []).map(asset);
  // The figure is what the actor ended up with; what it paid sits left of the arrow.
  let gave: MeaningAssetLike[] = [];
  let big: MeaningAssetLike | null = null;
  let more: MeaningAssetLike[] = [];
  if (gotAll.length) {
    big = gotAll[0]!;
    more = gotAll.slice(1);
    gave = gaveAll;
  } else if (gaveAll.length) {
    big = gaveAll[0]!;
    more = gaveAll.slice(1);
  }
  const to =
    WITH_TO.has(m.action) && m.counterparty && m.sub !== "own"
      ? { addr: m.counterparty, name: m.counterpartyName ?? null }
      : null;
  const fold = isFoldedAction(m.action);
  return {
    action: m.action,
    family: word.family,
    word: word[lang],
    where: whereOf(m, lang),
    who: m.actor ? { addr: m.actor, name: m.actorName ?? null } : null,
    to,
    notes: notesOf(m, lang),
    guess: m.conf === "guess" ? (lang === "ru" ? "вероятно" : "likely") : null,
    gave,
    big,
    more,
    sub: more.length ? moreText(more) : null,
    phoneSub: phoneSubOf(m, gave, more, lang),
    quiet: word.quiet === true || fold,
    fold,
  };
}
