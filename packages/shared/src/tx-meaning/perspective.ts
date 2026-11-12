/**
 * The same tx through one address's eyes (address page, token page): the word changes,
 * the facts do not. «Перевод» → «Отправлено» / «Получено», a pool payout → «Выплата от пула».
 */
import type { TxMeaning } from "./types.js";
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

/**
 * `ergDelta` = the address's own ERG change in this tx (nanoERG, string or bigint) when the caller
 * knows it (address activity does); else the sign comes from the meaning alone.
 */
export function meaningView(m: TxMeaning, address: string, ergDelta?: string | bigint | null): MeaningView {
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
  if (sign === 0 && role === "actor") sign = m.gave.length && !m.got.length ? -1 : m.got.length && !m.gave.length ? 1 : 0;
  if (sign === 0 && role !== "actor" && ["send", "multisend", "miner-payout"].includes(m.action)) sign = 1;
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
    default:
      if (role === "other" && sign > 0 && m.extra.some((e) => e.to === address)) return t("Получено", "Received");
      return t(base.ru, base.en);
  }
}
