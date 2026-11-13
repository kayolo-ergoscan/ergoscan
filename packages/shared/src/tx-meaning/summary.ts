/**
 * One plain sentence per tx, RU and EN, built from the meaning itself: the full form (tx page)
 * or the list form (CompactMeaning). Pure: no node imports and no lookups, so the browser
 * builds list phrases with this same code. Amounts use the asset's decimals: at or above a
 * million — whole units; at or above 1 — two decimals; below 1 — four significant digits.
 * Thousands are split with a space. Unknown owners stay short addresses.
 */
import { ERG, shortAddr, type AssetKey } from "./facts.js";
import { PROTOCOL_NAMES, type ProtocolId } from "./registry.js";
import type { MeaningAsset, MeaningAssetLike, MeaningCtx, MeaningExtraLike, MeaningPhraseInput } from "./types.js";
function group(int: bigint): string {
  const s = int.toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function formatAmount(raw: bigint | string, decimals: number): string {
  let v = typeof raw === "bigint" ? raw : BigInt(String(raw || "0"));
  if (v < 0n) v = -v;
  if (v === 0n) return "0";
  const d = Math.max(0, Math.min(30, Math.trunc(decimals || 0)));
  const unit = 10n ** BigInt(d);
  if (d === 0) return group(v);
  if (v >= unit * 1_000_000n) return group((v + unit / 2n) / unit);
  if (v >= unit) {
    const shown = Math.min(2, d);
    const scale = 10n ** BigInt(d - shown);
    const scaled = (v + scale / 2n) / scale;
    const p = 10n ** BigInt(shown);
    return `${group(scaled / p)}.${(scaled % p).toString().padStart(shown, "0")}`;
  }
  const x = Number(v) / 10 ** d;
  if (Number(x.toPrecision(4)) >= 1) return "1.00";
  let s = x.toPrecision(4);
  if (s.includes("e")) s = x.toFixed(Math.min(20, -Math.floor(Math.log10(x)) + 3));
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

/** The short name of an asset: ERG, the token name (cut to 24) or the token id head. */
export function assetLabel(a: MeaningAssetLike): string {
  if (!a.token) return "ERG";
  const name = a.name?.trim();
  if (!name) return `${a.token.slice(0, 6)}…`;
  return name.length > 24 ? `${name.slice(0, 23)}…` : name;
}

export function toAsset(key: AssetKey, amount: bigint, ctx: MeaningCtx): MeaningAsset {
  if (key === ERG) return { token: null, amount: amount.toString(), name: "ERG", decimals: 9 };
  const meta = ctx.token?.(key);
  const asset: MeaningAsset = { token: key, amount: amount.toString() };
  const name = meta?.name?.trim();
  if (name) asset.name = name;
  if (meta?.decimals != null && Number.isFinite(meta.decimals)) asset.decimals = meta.decimals;
  return asset;
}

function amt(a: MeaningAssetLike): string {
  const dec = a.token ? (a.decimals ?? 0) : 9;
  return `${formatAmount(a.amount, dec)} ${assetLabel(a)}`;
}

function list(items: readonly MeaningAssetLike[] | undefined, lang: Lang): string {
  const xs = items ?? [];
  if (!xs.length) return lang === "ru" ? "ничего" : "nothing";
  const shown = xs.slice(0, 2).map(amt);
  const and = lang === "ru" ? " и " : " and ";
  if (xs.length <= 2) return shown.join(and);
  const more = xs.length - 2;
  return lang === "ru" ? `${shown.join(", ")} и ещё ${more}` : `${shown.join(", ")} and ${more} more`;
}

function who(addr: string | null | undefined, name: string | null | undefined): string | null {
  if (!addr) return null;
  return name || shortAddr(addr);
}

export type Lang = "ru" | "en";

/** English count with the right noun; Russian lines put the number in brackets instead. */
function many(n: number, one: string, more: string): string {
  return `${n} ${n === 1 ? one : more}`;
}

function protoName(p: string | null | undefined, lang: Lang): string {
  if (!p) return "";
  return PROTOCOL_NAMES[p as ProtocolId]?.[lang] ?? p;
}

function venues(m: MeaningPhraseInput, lang: Lang): string {
  const v = m.venues?.length ? m.venues : m.protocol ? [protoName(m.protocol, lang)] : [];
  return v.join(" + ");
}

/** «ещё 1.77 ERG → 9gvv…DDPB» / «also …»: third-party payments; "" when none. Lists use it as a note. */
export function extraNote(xs: readonly MeaningExtraLike[] | undefined, lang: Lang): string {
  const tail = extraTail(xs, lang);
  return tail ? tail.slice(2) : "";
}

/** One amount with its label, as the phrases print it: «6.73 ERG», «132.36 RSN». */
export function assetText(a: MeaningAssetLike): string {
  return amt(a);
}

function extraTail(xs: readonly MeaningExtraLike[] | undefined, lang: Lang): string {
  if (!xs?.length) return "";
  // One entry per receiver: «ещё 0.001 ERG и 1 HNS → 9eed…BgzL».
  const by = new Map<string, { to: string; role?: string; name?: string | null; items: MeaningAssetLike[] }>();
  for (const e of xs) {
    const k = `${e.role ?? ""}|${e.to}`;
    const row = by.get(k) ?? { to: e.to, role: e.role, name: e.name, items: [] };
    row.items.push(e.asset);
    by.set(k, row);
  }
  const rows = [...by.values()];
  const parts = rows.slice(0, 2).map((r) => {
    const to = r.role === "reemission" ? (lang === "ru" ? "реэмиссия" : "reemission") : who(r.to, r.name);
    return `${list(r.items, lang)} → ${to}`;
  });
  const left = rows.length - 2;
  const more = left > 0 ? (lang === "ru" ? ` и ещё ${left}` : ` and ${left} more`) : "";
  return lang === "ru" ? `; ещё ${parts.join(", ")}${more}` : `; also ${parts.join(", ")}${more}`;
}

type Lines = { ru: string; en: string };

export function sayLines(m: MeaningPhraseInput): Lines {
  const A = who(m.actor, m.actorName);
  const ru = A ?? "Кто-то";
  const en = A ?? "Someone";
  const P = { ru: protoName(m.protocol, "ru"), en: protoName(m.protocol, "en") };
  const V = { ru: venues(m, "ru"), en: venues(m, "en") };
  const gave = { ru: list(m.gave, "ru"), en: list(m.gave, "en") };
  const got = { ru: list(m.got, "ru"), en: list(m.got, "en") };
  const to = who(m.counterparty, m.counterpartyName) ?? "?";
  const tail = { ru: extraTail(m.extra, "ru"), en: extraTail(m.extra, "en") };
  const n = m.count ?? 0;
  const pair = m.pair ? ` ${m.pair}` : "";

  switch (m.action) {
    case "send":
      if (m.sub === "own") {
        return { ru: `${ru} перевёл ${gave.ru} между своими адресами${tail.ru}`, en: `${en} moved ${gave.en} between its own addresses${tail.en}` };
      }
      return { ru: `${ru} отправил ${gave.ru} → ${to}${tail.ru}`, en: `${en} sent ${gave.en} to ${to}${tail.en}` };
    case "multisend":
      return { ru: `${ru} отправил ${gave.ru} адресам (${n})`, en: `${en} sent ${gave.en} to ${many(n, "address", "addresses")}` };
    case "self":
      return { ru: `${ru} перевёл средства себе`, en: `${en} moved funds to itself` };
    case "consolidate":
      return { ru: `${ru} объединил боксы: ${n} → ${m.count2 ?? 0}`, en: `${en} merged ${n} boxes into ${m.count2 ?? 0}` };
    case "block-reward":
      return { ru: `Майнер ${ru} получил ${got.ru} за блок`, en: `Miner ${en} got ${got.en} for the block` };
    case "fee-collect":
      return { ru: `Майнер ${ru} забрал комиссии блока: ${got.ru}`, en: `Miner ${en} took the block fees: ${got.en}` };
    case "miner-payout":
      if (m.sub === "claim") {
        return { ru: `Майнер ${ru} забрал награду: ${got.ru}${tail.ru}`, en: `Miner ${en} claimed the reward: ${got.en}${tail.en}` };
      }
      return { ru: `${ru} выплатил ${gave.ru} майнерам (${n})${tail.ru}`, en: `${en} paid ${gave.en} to ${many(n, "miner", "miners")}${tail.en}` };
    case "rent":
      return {
        ru: `Майнер ${ru} взял плату за хранение со старых боксов (${n}): ${got.ru}`,
        en: `Miner ${en} took storage rent from ${many(n, "old box", "old boxes")}: ${got.en}`,
      };
    case "token-issue":
      return { ru: `${ru} выпустил ${got.ru}`, en: `${en} issued ${got.en}` };
    case "nft-mint": {
      const name = m.got?.[0] ? assetLabel(m.got[0]) : "?";
      return { ru: `${ru} выпустил NFT «${name}»`, en: `${en} minted NFT “${name}”` };
    }
    case "burn":
      return { ru: `${ru} сжёг ${gave.ru}`, en: `${en} burned ${gave.en}` };
    case "name-register":
      if (m.sub === "commit") {
        return { ru: `${ru} подал заявку на имя · ${P.ru}`, en: `${en} requested a name on ${P.en}` };
      }
      return m.label
        ? { ru: `${ru} зарегистрировал имя ${m.label} · ${P.ru}`, en: `${en} registered the name ${m.label} on ${P.en}` }
        : { ru: `${ru} зарегистрировал имя · ${P.ru}`, en: `${en} registered a name on ${P.en}` };
    case "swap": {
      const by = m.viaOrder ? { ru: " по заявке", en: " by order" } : { ru: "", en: "" };
      if (!A) {
        // No wallet signed (a contract traded on its own): the venue is the subject.
        return {
          ru: `${V.ru} обменял ${gave.ru} на ${got.ru}${by.ru}${tail.ru}`,
          en: `${V.en} swapped ${gave.en} for ${got.en}${by.en}${tail.en}`,
        };
      }
      return {
        ru: `${ru} обменял ${gave.ru} на ${got.ru} · ${V.ru}${by.ru}${tail.ru}`,
        en: `${en} swapped ${gave.en} for ${got.en} on ${V.en}${by.en}${tail.en}`,
      };
    }
    case "lp-add": {
      const by = m.viaOrder ? { ru: " по заявке", en: " by order" } : { ru: "", en: "" };
      if (!A) return { ru: `В пул вложено ${gave.ru} · ${V.ru}${by.ru}`, en: `${gave.en} added to a pool on ${V.en}${by.en}` };
      return {
        ru: `${ru} вложил ${gave.ru} в пул · ${V.ru}${by.ru}${tail.ru}`,
        en: `${en} added ${gave.en} to a pool on ${V.en}${by.en}${tail.en}`,
      };
    }
    case "lp-remove": {
      const by = m.viaOrder ? { ru: " по заявке", en: " by order" } : { ru: "", en: "" };
      if (!A) return { ru: `Из пула забрано ${got.ru} · ${V.ru}${by.ru}`, en: `${got.en} removed from a pool on ${V.en}${by.en}` };
      return {
        ru: `${ru} забрал ${got.ru} из пула · ${V.ru}${by.ru}${tail.ru}`,
        en: `${en} removed ${got.en} from a pool on ${V.en}${by.en}${tail.en}`,
      };
    }
    case "pool-create":
      return { ru: `${ru} создал пул${pair} · ${V.ru}`, en: `${en} created a${pair} pool on ${V.en}` };
    case "order-place":
      if (m.sub === "update") return { ru: `${ru} изменил заявку · ${P.ru}`, en: `${en} updated an order on ${P.en}` };
      if (m.sub === "forward") {
        return { ru: `${ru} выставил предложение форварда на сложность, внёс ${gave.ru} · ${P.ru}${tail.ru}`, en: `${en} posted a difficulty forward offer with ${gave.en} on ${P.en}${tail.en}` };
      }
      if (m.sub === "deposit") {
        return { ru: `${ru} создал заявку на вклад ${gave.ru} в пул · ${P.ru}${tail.ru}`, en: `${en} placed an order to add ${gave.en} to a pool on ${P.en}${tail.en}` };
      }
      if (m.sub === "redeem") {
        return { ru: `${ru} создал заявку на вывод из пула, отдал ${gave.ru} · ${P.ru}${tail.ru}`, en: `${en} placed an order to withdraw from a pool with ${gave.en} on ${P.en}${tail.en}` };
      }
      return { ru: `${ru} создал заявку на обмен ${gave.ru} · ${P.ru}${tail.ru}`, en: `${en} placed a swap order with ${gave.en} on ${P.en}${tail.en}` };
    case "order-cancel":
      if (m.sub === "closed") {
        return { ru: `Заявка ${ru} закрыта, вернулось ${got.ru} · ${P.ru}`, en: `${en}'s order was closed, ${got.en} returned · ${P.en}` };
      }
      if (m.sub === "forward") {
        return { ru: `${ru} отменил предложение форварда, вернулось ${got.ru} · ${P.ru}`, en: `${en} cancelled a difficulty forward offer, ${got.en} returned · ${P.en}` };
      }
      if (m.sub === "loan") {
        return { ru: `${ru} отменил заявку на заём, вернулось ${got.ru} · ${P.ru}`, en: `${en} cancelled a loan request, ${got.en} returned · ${P.en}` };
      }
      return { ru: `${ru} отменил заявку, вернулось ${got.ru} · ${P.ru}`, en: `${en} cancelled an order, ${got.en} returned · ${P.en}` };
    case "stable-mint":
      return { ru: `${ru} выпустил ${got.ru} за ${gave.ru} · ${P.ru}${tail.ru}`, en: `${en} minted ${got.en} for ${gave.en} on ${P.en}${tail.en}` };
    case "stable-redeem":
      return { ru: `${ru} погасил ${gave.ru} и получил ${got.ru} · ${P.ru}${tail.ru}`, en: `${en} redeemed ${gave.en} for ${got.en} on ${P.en}${tail.en}` };
    case "loan":
      switch (m.sub) {
        case "lend":
          return { ru: `${ru} выдал заём ${gave.ru}${m.counterparty ? ` → ${to}` : ""} · ${P.ru}`, en: `${en} lent ${gave.en}${m.counterparty ? ` to ${to}` : ""} on ${P.en}` };
        case "request":
          return { ru: `${ru} создал заявку на заём под залог ${gave.ru} · ${P.ru}`, en: `${en} asked for a loan against ${gave.en} on ${P.en}` };
        case "claim":
          return { ru: `${ru} забрал залог ${got.ru} · ${P.ru}`, en: `${en} claimed the collateral ${got.en} on ${P.en}` };
        case "borrow":
          return { ru: `${ru} взял заём ${got.ru} · ${P.ru}`, en: `${en} borrowed ${got.en} on ${P.en}` };
        default:
          return { ru: `${ru}: операция займа · ${P.ru}`, en: `${en}: loan operation on ${P.en}` };
      }
    case "loan-repay":
      return { ru: `${ru} погасил заём ${gave.ru} · ${P.ru}`, en: `${en} repaid ${gave.en} on ${P.en}` };
    case "stake":
      if (m.sub === "open") {
        return { ru: `${ru} открыл резерв ${gave.ru} · ${P.ru}`, en: `${en} opened a reserve with ${gave.en} · ${P.en}` };
      }
      return { ru: `${ru} внёс ${gave.ru} · ${P.ru}`, en: `${en} deposited ${gave.en} on ${P.en}` };
    case "unstake":
      return { ru: `${ru} вывел ${got.ru} · ${P.ru}`, en: `${en} withdrew ${got.en} from ${P.en}` };
    case "payout":
      if (m.sub === "reserve") {
        return { ru: `${ru} получил ${got.ru} из резерва · ${P.ru}`, en: `${en} received ${got.en} from a reserve · ${P.en}` };
      }
      return { ru: `${ru} получил выплату ${got.ru} · ${P.ru}`, en: `${en} received ${got.en} from ${P.en}` };
    case "auction":
      if (m.sub === "list") return { ru: `${ru} выставил лот на аукцион · ${P.ru}`, en: `${en} listed a lot on ${P.en}` };
      if (m.sub === "bid") return { ru: `${ru} сделал ставку ${gave.ru} · ${P.ru}`, en: `${en} bid ${gave.en} on ${P.en}` };
      return { ru: `Лот закрыт: ${ru} получил ${got.ru} · ${P.ru}`, en: `Lot settled: ${en} got ${got.en} on ${P.en}` };
    case "bridge-out": {
      const c = m.chain ? { ru: m.chain, en: m.chain } : { ru: "другую сеть", en: "another chain" };
      return { ru: `${ru} отправил ${gave.ru} в ${c.ru} · ${P.ru}${tail.ru}`, en: `${en} sent ${gave.en} to ${c.en} via ${P.en}${tail.en}` };
    }
    case "bridge-in": {
      const c = m.chain ? { ru: m.chain, en: m.chain } : { ru: "другой сети", en: "another chain" };
      return { ru: `${ru} получил ${got.ru} из ${c.ru} · ${P.ru}`, en: `${en} received ${got.en} from ${c.en} via ${P.en}` };
    }
    case "mix":
      return { ru: `Шаг микширования · ${P.ru}`, en: `Mixing step · ${P.en}` };
    case "oracle-post":
      return { ru: `Оператор ${ru} отправил цену в оракул${pair}`, en: `Operator ${en} posted a price to the${pair} oracle` };
    case "oracle-update":
      return n
        ? { ru: `Оракул${pair} обновил курс по ответам операторов (${n})`, en: `The${pair} oracle updated its rate from ${many(n, "operator post", "operator posts")}` }
        : { ru: `Оракул${pair} обновил курс`, en: `The${pair} oracle updated its rate` };
    case "service":
      switch (m.sub) {
        case "oracle-round":
          return { ru: `Оракул${pair} начал новый раунд сбора цен`, en: `The${pair} oracle started a new round` };
        case "oracle-governance":
          return { ru: `Голосование за контракт оракула${pair}`, en: `The${pair} oracle contract vote` };
        case "bridge-settle":
          return {
            ru: `Мост закрыл перевод${m.chain ? ` в ${m.chain}` : ""}: награды наблюдателям · ${P.ru}`,
            en: `Bridge settled a transfer${m.chain ? ` to ${m.chain}` : ""}: watcher rewards · ${P.en}`,
          };
        case "watcher-report":
          return { ru: `Наблюдатель ${ru} подтвердил перевод через мост · ${P.ru}`, en: `Watcher ${en} reported a bridge transfer · ${P.en}` };
        default:
          return m.label
            ? { ru: `Служебная операция «${m.label}» · ${P.ru}`, en: `${P.en} upkeep: “${m.label}”` }
            : { ru: `Служебная операция · ${P.ru}`, en: `${P.en} upkeep` };
      }
    case "contract-call":
      if (m.protocol && m.label) {
        const g = m.got?.length ? { ru: `, получил ${got.ru}`, en: ` and got ${got.en}` } : { ru: "", en: "" };
        return { ru: `${ru} вызвал «${m.label}»${g.ru} · ${P.ru}`, en: `${en} called “${m.label}”${g.en} · ${P.en}` };
      }
      return m.got?.length
        ? { ru: `${ru} вызвал контракт ${to}, получил ${got.ru}`, en: `${en} called contract ${to} and got ${got.en}` }
        : { ru: `${ru} вызвал контракт ${to}`, en: `${en} called contract ${to}` };
    case "to-contract":
      if (m.protocol && m.label) {
        return { ru: `${ru} отправил ${gave.ru} в «${m.label}» · ${P.ru}`, en: `${en} sent ${gave.en} to “${m.label}” · ${P.en}` };
      }
      return { ru: `${ru} отправил ${gave.ru} в контракт ${to}`, en: `${en} sent ${gave.en} to contract ${to}` };
  }
}

/** The phrase in one language. The web calls this for list rows (CompactMeaning). */
export function sayMeaning(m: MeaningPhraseInput, lang: Lang): string {
  return sayLines(m)[lang];
}
