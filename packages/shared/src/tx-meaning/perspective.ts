/**
 * The same tx through one address's eyes (address page, token page): the word changes,
 * the facts do not. «Перевод» → «Отправлено» / «Получено», a pool payout → «Выплата от пула».
 */
import { meaningRow, type MeaningParty, type MeaningRow, type MeaningRowInput } from "./row.js";
import type { Lang } from "./summary.js";
import type { MeaningPhraseInput } from "./types.js";
import { MEANING_VOCAB } from "./vocab.js";

export type MeaningViewRole = "actor" | "counterparty" | "other";

export type MeaningView = {
  role: MeaningViewRole;
  title: { ru: string; en: string };
  /** -1 the address lost value, 1 gained, 0 neither or unknown. */
  sign: -1 | 0 | 1;
};

function chainWord(chain: string | null | undefined, lang: "ru" | "en", into: boolean): string {
  if (chain) return chain;
  if (lang === "ru") return into ? "другую сеть" : "другой сети";
  return "another chain";
}

function isPayout(m: MeaningPhraseInput): boolean {
  return m.action === "contract-call" && m.sub === "payout";
}

/** A contract's payout reached this address: the one receiver, or a gainer that did not set it off. */
function paidTo(m: MeaningPhraseInput, address: string, role: MeaningViewRole, sign: number): boolean {
  if (!isPayout(m) || role === "actor") return false;
  const trigger = m.feePayer !== undefined ? m.feePayer : (m.fee?.payer ?? null);
  return role === "counterparty" || (sign > 0 && address !== trigger);
}

/**
 * `ergDelta` = the address's own ERG change in this tx (nanoERG, string or bigint) when the caller
 * knows it (address activity does); else the sign comes from the meaning alone.
 */
export function meaningView(m: MeaningPhraseInput, address: string, ergDelta?: string | bigint | null): MeaningView {
  const role: MeaningViewRole =
    m.actor === address ? "actor" : m.counterparty === address ? "counterparty" : "other";
  let sign: -1 | 0 | 1 = 0;
  if (ergDelta != null && ergDelta !== "") {
    try {
      const v = typeof ergDelta === "bigint" ? ergDelta : BigInt(String(ergDelta).split(".")[0] || "0");
      sign = v > 0n ? 1 : v < 0n ? -1 : 0;
    } catch {
      sign = 0;
    }
  }
  const gave = m.gave?.length ?? 0;
  const got = m.got?.length ?? 0;
  if (sign === 0 && role === "actor") sign = gave && !got ? -1 : got && !gave ? 1 : 0;
  if (sign === 0 && role !== "actor" && ["send", "multisend", "miner-payout"].includes(m.action)) sign = 1;
  if (sign === 0 && role === "counterparty" && isPayout(m)) sign = 1;
  const base = MEANING_VOCAB[m.action];
  const t = (ru: string, en: string) => ({ role, title: { ru, en }, sign });

  switch (m.action) {
    case "send":
    case "multisend":
      return role === "actor" ? t("Отправлено", "Sent") : t("Получено", "Received");
    case "miner-payout":
      return role === "actor" ? t(base.ru, base.en) : t("Выплата от пула", "Pool payout");
    case "bridge-in":
      return role === "actor"
        ? t(`Получено из ${chainWord(m.chain, "ru", false)}`, `Received from ${chainWord(m.chain, "en", false)}`)
        : t(base.ru, base.en);
    case "bridge-out":
      return role === "actor"
        ? t(`Отправлено в ${chainWord(m.chain, "ru", true)}`, `Sent to ${chainWord(m.chain, "en", true)}`)
        : t(base.ru, base.en);
    case "oracle-post":
      return role === "actor" ? t("Цена отправлена", "Price posted") : t(base.ru, base.en);
    case "contract-call":
      return paidTo(m, address, role, sign) ? t("Получено", "Received") : t(base.ru, base.en);
    default:
      if (role === "other" && sign > 0 && (m.extra ?? []).some((e) => e.to === address)) return t("Получено", "Received");
      return t(base.ru, base.en);
  }
}

/** A list row from one address's seat (address page): its own word, the other side with a direction. */
export type MeaningOwnerRow = MeaningRow & {
  view: MeaningView;
  /** Who the money came from when the owner received: «← Gate.io». `to` is where it went: «→ KuCoin». */
  from: MeaningParty | null;
};

/** Actions where a party that is not the actor and gained value simply received it. */
const RECEIVED: ReadonlySet<string> = new Set(["send", "multisend", "miner-payout"]);

/**
 * The row words for `address`: «Отправлено → KuCoin», «Получено ← Gate.io», «Обмен · ErgoDex»
 * (the owner is not named again), a pool sees the trader («Обмен · ErgoDex · 9fYV…reou»).
 * A payment to the owner is not repeated as «ещё … → him». Amounts stay with the caller: the
 * owner's own net comes from the address activity, not from the actor's gave / got.
 */
export function meaningOwnerRow(
  m: MeaningRowInput,
  address: string,
  lang: Lang,
  ergDelta?: string | bigint | null
): MeaningOwnerRow {
  const view = meaningView(m, address, ergDelta);
  const extra = m.extra ?? [];
  const toOwner = extra.some((e) => e.to === address);
  const r = meaningRow(toOwner ? { ...m, extra: extra.filter((e) => e.to !== address) } : m, lang);
  const base = MEANING_VOCAB[m.action];
  // The base word keeps the row's own choice («Вызов контракта» for a contract we do not know).
  const word = view.title.ru === base.ru ? r.word : view.title[lang];
  const actor: MeaningParty | null = m.actor && m.actor !== "?" ? { addr: m.actor, name: m.actorName ?? null } : null;
  const notMe = (p: MeaningParty | null) => (p && p.addr !== address ? p : null);
  if (view.role === "actor") return { ...r, word, view, who: null, to: notMe(r.to), from: null };
  const received =
    view.role === "counterparty" || (view.sign > 0 && (RECEIVED.has(m.action) || toOwner)) || paidTo(m, address, view.role, view.sign);
  if (received) return { ...r, word, view, who: null, to: null, from: notMe(actor) };
  return { ...r, word, view, who: notMe(actor), to: notMe(r.to), from: null };
}
