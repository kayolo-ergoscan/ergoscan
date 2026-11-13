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

/** The amounts of one side, or "" when nothing moved: a phrase then drops the amount, never says «ничего». */
function list(items: readonly MeaningAssetLike[] | undefined, lang: Lang): string {
  const xs = items ?? [];
  if (!xs.length) return "";
  const shown = xs.slice(0, 2).map(amt);
  const and = lang === "ru" ? " и " : " and ";
  if (xs.length <= 2) return shown.join(and);
  const more = xs.length - 2;
  return lang === "ru" ? `${shown.join(", ")} и ещё ${more}` : `${shown.join(", ")} and ${more} more`;
}

/** « 1.00 ERG» with a leading space, or "" when the side is empty. */
function sp(text: string): string {
  return text ? ` ${text}` : "";
}

function who(addr: string | null | undefined, name: string | null | undefined): string | null {
  if (!addr) return null;
  return name || shortAddr(addr);
}

export type Lang = "ru" | "en";

/** Russian noun after a number: 1 адрес, 2 адреса, 5 адресов. */
function ruCountWord(n: number, one: string, few: string, more: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  return `${n} ${a > 10 && a < 20 ? more : b === 1 ? one : b >= 2 && b <= 4 ? few : more}`;
}

/** Russian dative after a number: 1 адресу, 2 адресам, 21 адресу. */
function ruDat(n: number, one: string, more: string): string {
  return `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : more}`;
}

function eachDec(a: MeaningAssetLike): number {
  return a.token ? (a.decimals ?? 0) : 9;
}

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

/** EIP-4 art kinds as the NFT phrase names them. */
const ART_WORD: Readonly<Record<string, Lines>> = {
  image: { ru: "изображение", en: "image" },
  audio: { ru: "аудио", en: "audio" },
  video: { ru: "видео", en: "video" },
};

export function sayLines(m: MeaningPhraseInput): Lines {
  const A = who(m.actor, m.actorName);
  // No wallet signed: the contract is the subject, and the phrase says so.
  const byContract = m.byContract && A && !m.actorName;
  const ru = byContract ? `Контракт ${A}` : (A ?? "Кто-то");
  const en = byContract ? `Contract ${A}` : (A ?? "Someone");
  const P = { ru: protoName(m.protocol, "ru"), en: protoName(m.protocol, "en") };
  const V = { ru: venues(m, "ru"), en: venues(m, "en") };
  const gave = { ru: list(m.gave, "ru"), en: list(m.gave, "en") };
  const got = { ru: list(m.got, "ru"), en: list(m.got, "en") };
  // With a leading space, or "" when that side is empty: the amount clause drops out.
  const gaveS = { ru: sp(gave.ru), en: sp(gave.en) };
  const gotS = { ru: sp(got.ru), en: sp(got.en) };
  const to = who(m.counterparty, m.counterpartyName) ?? "?";
  const tail = { ru: extraTail(m.extra, "ru"), en: extraTail(m.extra, "en") };
  const n = m.count ?? 0;
  const pair = m.pair ? ` ${m.pair}` : "";

  switch (m.action) {
    case "send":
      if (m.sub === "own") {
        return { ru: `${ru} перевёл${gaveS.ru} между своими адресами${tail.ru}`, en: `${en} moved${gaveS.en} between its own addresses${tail.en}` };
      }
      return { ru: `${ru} отправил${gaveS.ru} → ${to}${tail.ru}`, en: `${en} sent${gaveS.en} to ${to}${tail.en}` };
    case "multisend": {
      const toN = { ru: ruDat(n, "адресу", "адресам"), en: many(n, "address", "addresses") };
      const each = m.each ? formatAmount(m.each.amount, eachDec(m.each)) : null;
      switch (m.sub) {
        case "exchange":
          return { ru: `${ru}: выводы ${toN.ru}${gave.ru ? ` — ${gave.ru}` : ""}`, en: `${en}: withdrawals to ${toN.en}${gave.en ? ` — ${gave.en}` : ""}` };
        case "pool":
          return { ru: `${ru} выплатил${gaveS.ru} майнерам (${n})`, en: `${en} paid${gaveS.en} to ${many(n, "miner", "miners")}` };
        case "batch":
          return { ru: `${ru} выплатил${gaveS.ru} ${toN.ru}`, en: `${en} paid${gaveS.en} to ${toN.en}` };
        case "split":
          return {
            ru: `${ru} разделил${gaveS.ru} поровну между ${n} ${n % 10 === 1 && n % 100 !== 11 ? "адресом" : "адресами"}${each ? ` (по ${each})` : ""}`,
            en: `${en} split${gaveS.en} equally between ${n} addresses${each ? ` (${each} each)` : ""}`,
          };
        case "airdrop": {
          // The token handed out; the ERG its boxes carry is in the cards, not in the sentence.
          const tok = (m.gave ?? []).filter((a) => a.token).slice(0, 1);
          const how = each ? { ru: ` (по ${each})`, en: ` (${each} each)` } : { ru: " разными суммами", en: " in different amounts" };
          return { ru: `${ru} раздал ${list(tok, "ru")} ${toN.ru}${how.ru}`, en: `${en} distributed ${list(tok, "en")} to ${toN.en}${how.en}` };
        }
        case "nft": {
          const k = m.count2 ?? 0;
          return { ru: `${ru} разослал ${k} NFT ${toN.ru}`, en: `${en} sent ${many(k, "NFT", "NFTs")} to ${toN.en}` };
        }
        default:
          return { ru: `${ru} отправил${gaveS.ru} адресам (${n})`, en: `${en} sent${gaveS.en} to ${toN.en}` };
      }
    }
    case "self":
      return { ru: `${ru} перевёл средства себе`, en: `${en} moved funds to itself` };
    case "consolidate":
      return { ru: `${ru} объединил боксы: ${n} → ${m.count2 ?? 0}`, en: `${en} merged ${n} boxes into ${m.count2 ?? 0}` };
    case "block-reward":
      if (!got.ru) return { ru: `Майнер ${ru}: награда за блок`, en: `Miner ${en}: block reward` };
      return { ru: `Майнер ${ru} получил ${got.ru} за блок`, en: `Miner ${en} got ${got.en} for the block` };
    case "fee-collect":
      return { ru: `Майнер ${ru} забрал комиссии блока${got.ru ? `: ${got.ru}` : ""}`, en: `Miner ${en} took the block fees${got.en ? `: ${got.en}` : ""}` };
    case "miner-payout":
      if (m.sub === "claim") {
        return { ru: `Майнер ${ru} забрал награду${got.ru ? `: ${got.ru}` : ""}${tail.ru}`, en: `Miner ${en} claimed the reward${got.en ? `: ${got.en}` : ""}${tail.en}` };
      }
      return { ru: `${ru} выплатил${gaveS.ru} майнерам (${n})${tail.ru}`, en: `${en} paid${gaveS.en} to ${many(n, "miner", "miners")}${tail.en}` };
    case "rent": {
      // ERG is the rent; tokens swept out of the old boxes are counted, not listed.
      const erg = (m.got ?? []).filter((a) => !a.token);
      const toks = (m.got ?? []).length - erg.length;
      const each = m.each ? { ru: ` (по ${formatAmount(m.each.amount, eachDec(m.each))})`, en: ` (${formatAmount(m.each.amount, eachDec(m.each))} each)` } : { ru: "", en: "" };
      const amount = {
        ru: [erg.length ? `${list(erg, "ru")}${each.ru}` : "", toks ? `токены (${toks})` : ""].filter(Boolean).join(" и "),
        en: [erg.length ? `${list(erg, "en")}${each.en}` : "", toks ? many(toks, "token", "tokens") : ""].filter(Boolean).join(" and "),
      };
      const k = m.count2 ?? 0;
      if (k >= 2) {
        return {
          ru: `Плату за хранение со старых боксов (${n}) забрали ${ruCountWord(k, "адрес", "адреса", "адресов")}${amount.ru ? `: ${amount.ru}` : ""}`,
          en: `${many(k, "address", "addresses")} took storage rent from ${many(n, "old box", "old boxes")}${amount.en ? `: ${amount.en}` : ""}`,
        };
      }
      return {
        ru: `Майнер ${ru} взял плату за хранение со старых боксов (${n})${amount.ru ? `: ${amount.ru}` : ""}`,
        en: `Miner ${en} took storage rent from ${many(n, "old box", "old boxes")}${amount.en ? `: ${amount.en}` : ""}`,
      };
    }
    case "token-issue":
    case "nft-mint": {
      const name = m.got?.[0] ? assetLabel(m.got[0]) : "?";
      // «→ Z» only when one other address took all of the new token.
      const toZ = m.counterparty ? ` → ${to}` : "";
      switch (m.sub) {
        case "service":
          return { ru: `${ru} выпустил служебный токен «${name}»${toZ}`, en: `${en} issued a service token “${name}”${toZ}` };
        case "collection":
          return { ru: `${ru} создал коллекцию NFT «${name}»${toZ}`, en: `${en} created the NFT collection “${name}”${toZ}` };
        case "id":
          return m.counterparty
            ? { ru: `${ru} создал контракт ${to}: токен-идентификатор ${name}`, en: `${en} created contract ${to}: ID token ${name}` }
            : { ru: `${ru} выпустил токен-идентификатор ${name}`, en: `${en} issued the ID token ${name}` };
        default:
          break;
      }
      if (m.action === "token-issue") return { ru: `${ru} выпустил${gotS.ru || " токен"}${toZ}`, en: `${en} issued${gotS.en || " a token"}${toZ}` };
      const art = m.sub ? ART_WORD[m.sub] : undefined;
      return {
        ru: `${ru} выпустил NFT «${name}»${art ? ` (${art.ru})` : ""}${toZ}`,
        en: `${en} minted NFT “${name}”${art ? ` (${art.en})` : ""}${toZ}`,
      };
    }
    case "burn":
      return { ru: `${ru} сжёг${gaveS.ru || " токены"}`, en: `${en} burned${gaveS.en || " tokens"}` };
    case "name-register":
      if (m.sub === "commit") {
        return { ru: `${ru} подал заявку на имя · ${P.ru}`, en: `${en} requested a name on ${P.en}` };
      }
      return m.label
        ? { ru: `${ru} зарегистрировал имя ${m.label} · ${P.ru}`, en: `${en} registered the name ${m.label} on ${P.en}` }
        : { ru: `${ru} зарегистрировал имя · ${P.ru}`, en: `${en} registered a name on ${P.en}` };
    case "swap": {
      const by = m.viaOrder ? { ru: " по заявке", en: " by order" } : { ru: "", en: "" };
      // One side empty (the pools paid out more than they took): say the side that moved.
      const deal = {
        ru: gave.ru && got.ru ? `обменял ${gave.ru} на ${got.ru}` : got.ru ? `получил ${got.ru}` : gave.ru ? `обменял ${gave.ru}` : "обменял",
        en: gave.en && got.en ? `swapped ${gave.en} for ${got.en}` : got.en ? `got ${got.en}` : gave.en ? `swapped ${gave.en}` : "swapped",
      };
      if (!A) {
        // No wallet signed (a contract traded on its own): the venue is the subject.
        return { ru: `${V.ru} ${deal.ru}${by.ru}${tail.ru}`, en: `${V.en} ${deal.en}${by.en}${tail.en}` };
      }
      return {
        ru: `${ru} ${deal.ru} · ${V.ru}${by.ru}${tail.ru}`,
        en: `${en} ${deal.en} on ${V.en}${by.en}${tail.en}`,
      };
    }
    case "lp-add": {
      const by = m.viaOrder ? { ru: " по заявке", en: " by order" } : { ru: "", en: "" };
      if (!A) return { ru: `В пул вложено${gaveS.ru} · ${V.ru}${by.ru}`, en: `${gave.en || "Liquidity"} added to a pool on ${V.en}${by.en}` };
      return {
        ru: `${ru} вложил${gaveS.ru} в пул · ${V.ru}${by.ru}${tail.ru}`,
        en: `${en} added${gaveS.en || " liquidity"} to a pool on ${V.en}${by.en}${tail.en}`,
      };
    }
    case "lp-remove": {
      const by = m.viaOrder ? { ru: " по заявке", en: " by order" } : { ru: "", en: "" };
      if (!A) return { ru: `Из пула забрано${gotS.ru} · ${V.ru}${by.ru}`, en: `${got.en || "Liquidity"} removed from a pool on ${V.en}${by.en}` };
      return {
        ru: `${ru} забрал${gotS.ru} из пула · ${V.ru}${by.ru}${tail.ru}`,
        en: `${en} removed${gotS.en || " liquidity"} from a pool on ${V.en}${by.en}${tail.en}`,
      };
    }
    case "pool-create":
      return { ru: `${ru} создал пул${pair} · ${V.ru}`, en: `${en} created a${pair} pool on ${V.en}` };
    case "order-place":
      if (m.sub === "update") return { ru: `${ru} изменил заявку · ${P.ru}`, en: `${en} updated an order on ${P.en}` };
      if (m.sub === "forward") {
        return {
          ru: `${ru} выставил предложение форварда на сложность${gave.ru ? `, внёс ${gave.ru}` : ""} · ${P.ru}${tail.ru}`,
          en: `${en} posted a difficulty forward offer${gave.en ? ` with ${gave.en}` : ""} on ${P.en}${tail.en}`,
        };
      }
      if (m.sub === "deposit") {
        return { ru: `${ru} создал заявку на вклад${gaveS.ru} в пул · ${P.ru}${tail.ru}`, en: `${en} placed an order to add${gaveS.en || " liquidity"} to a pool on ${P.en}${tail.en}` };
      }
      if (m.sub === "redeem") {
        return {
          ru: `${ru} создал заявку на вывод из пула${gave.ru ? `, отдал ${gave.ru}` : ""} · ${P.ru}${tail.ru}`,
          en: `${en} placed an order to withdraw from a pool${gave.en ? ` with ${gave.en}` : ""} on ${P.en}${tail.en}`,
        };
      }
      return { ru: `${ru} создал заявку на обмен${gaveS.ru} · ${P.ru}${tail.ru}`, en: `${en} placed a swap order${gave.en ? ` with ${gave.en}` : ""} on ${P.en}${tail.en}` };
    case "order-cancel": {
      const back = { ru: got.ru ? `, вернулось ${got.ru}` : "", en: got.en ? `, ${got.en} returned` : "" };
      if (m.sub === "closed") {
        return { ru: `Заявка ${ru} закрыта${back.ru} · ${P.ru}`, en: `${en}'s order was closed${back.en} · ${P.en}` };
      }
      if (m.sub === "forward") {
        return { ru: `${ru} отменил предложение форварда${back.ru} · ${P.ru}`, en: `${en} cancelled a difficulty forward offer${back.en} · ${P.en}` };
      }
      if (m.sub === "loan") {
        return { ru: `${ru} отменил заявку на заём${back.ru} · ${P.ru}`, en: `${en} cancelled a loan request${back.en} · ${P.en}` };
      }
      return { ru: `${ru} отменил заявку${back.ru} · ${P.ru}`, en: `${en} cancelled an order${back.en} · ${P.en}` };
    }
    case "stable-mint":
      return {
        ru: `${ru} выпустил${gotS.ru || " стейблкоин"}${gave.ru ? ` за ${gave.ru}` : ""} · ${P.ru}${tail.ru}`,
        en: `${en} minted${gotS.en || " a stablecoin"}${gave.en ? ` for ${gave.en}` : ""} on ${P.en}${tail.en}`,
      };
    case "stable-redeem":
      return {
        ru: `${ru} погасил${gaveS.ru || " стейблкоин"}${got.ru ? ` и получил ${got.ru}` : ""} · ${P.ru}${tail.ru}`,
        en: `${en} redeemed${gaveS.en || " a stablecoin"}${got.en ? ` for ${got.en}` : ""} on ${P.en}${tail.en}`,
      };
    case "loan":
      switch (m.sub) {
        case "lend":
          return { ru: `${ru} выдал заём${gaveS.ru}${m.counterparty ? ` → ${to}` : ""} · ${P.ru}`, en: `${en} lent${gaveS.en || " a loan"}${m.counterparty ? ` to ${to}` : ""} on ${P.en}` };
        case "request":
          return {
            ru: `${ru} создал заявку на заём${gave.ru ? ` под залог ${gave.ru}` : ""} · ${P.ru}`,
            en: `${en} asked for a loan${gave.en ? ` against ${gave.en}` : ""} on ${P.en}`,
          };
        case "claim":
          return { ru: `${ru} забрал залог${gotS.ru} · ${P.ru}`, en: `${en} claimed the collateral${gotS.en} on ${P.en}` };
        case "borrow":
          return { ru: `${ru} взял заём${gotS.ru} · ${P.ru}`, en: `${en} borrowed${gotS.en || " a loan"} on ${P.en}` };
        default:
          return { ru: `${ru}: операция займа · ${P.ru}`, en: `${en}: loan operation on ${P.en}` };
      }
    case "loan-repay":
      return { ru: `${ru} погасил заём${gaveS.ru} · ${P.ru}`, en: `${en} repaid${gaveS.en || " a loan"} on ${P.en}` };
    case "stake":
      if (m.sub === "open") {
        return { ru: `${ru} открыл резерв${gaveS.ru} · ${P.ru}`, en: `${en} opened a reserve${gave.en ? ` with ${gave.en}` : ""} · ${P.en}` };
      }
      return { ru: `${ru} ${gave.ru ? `внёс ${gave.ru}` : "сделал вклад"} · ${P.ru}`, en: `${en} deposited${gaveS.en || " funds"} on ${P.en}` };
    case "unstake":
      return { ru: `${ru} вывел${gotS.ru || " вклад"} · ${P.ru}`, en: `${en} withdrew${gotS.en || " a deposit"} from ${P.en}` };
    case "payout":
      if (m.sub === "reserve") {
        return { ru: `${ru} получил${gotS.ru || " выплату"} из резерва · ${P.ru}`, en: `${en} received${gotS.en || " a payout"} from a reserve · ${P.en}` };
      }
      return { ru: `${ru} получил выплату${gotS.ru} · ${P.ru}`, en: `${en} received${gotS.en || " a payout"} from ${P.en}` };
    case "auction":
      if (m.sub === "list") return { ru: `${ru} выставил лот на аукцион · ${P.ru}`, en: `${en} listed a lot on ${P.en}` };
      if (m.sub === "bid") return { ru: `${ru} сделал ставку${gaveS.ru} · ${P.ru}`, en: `${en} bid${gaveS.en} on ${P.en}` };
      if (!got.ru) return { ru: `Лот закрыт: ${ru} · ${P.ru}`, en: `Lot settled: ${en} on ${P.en}` };
      return { ru: `Лот закрыт: ${ru} получил ${got.ru} · ${P.ru}`, en: `Lot settled: ${en} got ${got.en} on ${P.en}` };
    case "bridge-out": {
      const c = m.chain ? { ru: m.chain, en: m.chain } : { ru: "другую сеть", en: "another chain" };
      return { ru: `${ru} отправил${gaveS.ru} в ${c.ru} · ${P.ru}${tail.ru}`, en: `${en} sent${gaveS.en} to ${c.en} via ${P.en}${tail.en}` };
    }
    case "bridge-in": {
      const c = m.chain ? { ru: m.chain, en: m.chain } : { ru: "другой сети", en: "another chain" };
      return { ru: `${ru} получил${gotS.ru || " перевод"} из ${c.ru} · ${P.ru}`, en: `${en} received${gotS.en || " a transfer"} from ${c.en} via ${P.en}` };
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
        return { ru: `${ru} отправил${gaveS.ru} в «${m.label}» · ${P.ru}`, en: `${en} sent${gaveS.en} to “${m.label}” · ${P.en}` };
      }
      return { ru: `${ru} отправил${gaveS.ru} в контракт ${to}`, en: `${en} sent${gaveS.en} to contract ${to}` };
  }
}

/** The phrase in one language. The web calls this for list rows (CompactMeaning). */
export function sayMeaning(m: MeaningPhraseInput, lang: Lang): string {
  return sayLines(m)[lang];
}
