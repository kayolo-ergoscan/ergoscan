/**
 * One plain sentence per tx, RU and EN, from the draft. Amounts use the token's decimals:
 * at or above a million — whole units; at or above 1 — two decimals; below 1 — four
 * significant digits. Thousands are split with a space. Unknown owners stay short addresses.
 */
import { ERG, shortAddr, type AssetKey } from "./facts.js";
import { PROTOCOL_NAMES } from "./registry.js";
import type { Draft } from "./rules.js";
import type { MeaningAsset, MeaningCtx } from "./types.js";

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

export function tokenLabel(key: AssetKey, ctx: MeaningCtx): string {
  if (key === ERG) return "ERG";
  const name = ctx.token?.(key)?.name?.trim();
  if (!name) return `${key.slice(0, 6)}…`;
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

function amt(key: AssetKey, v: bigint, ctx: MeaningCtx): string {
  const dec = key === ERG ? 9 : (ctx.token?.(key)?.decimals ?? 0);
  return `${formatAmount(v, dec)} ${tokenLabel(key, ctx)}`;
}

function list(items: Array<[AssetKey, bigint]> | undefined, ctx: MeaningCtx, lang: "ru" | "en"): string {
  const xs = items ?? [];
  if (!xs.length) return lang === "ru" ? "ничего" : "nothing";
  const shown = xs.slice(0, 2).map(([k, v]) => amt(k, v, ctx));
  const and = lang === "ru" ? " и " : " and ";
  if (xs.length <= 2) return shown.join(and);
  const more = xs.length - 2;
  return lang === "ru" ? `${shown.join(", ")} и ещё ${more}` : `${shown.join(", ")} and ${more} more`;
}

export function who(addr: string | null | undefined, ctx: MeaningCtx): string | null {
  if (!addr) return null;
  const n = ctx.nameOf?.(addr)?.name;
  return n || shortAddr(addr);
}

function proto(d: Draft, lang: "ru" | "en"): string {
  return d.protocol ? PROTOCOL_NAMES[d.protocol][lang] : "";
}

function venues(d: Draft, lang: "ru" | "en"): string {
  const v = d.venues?.length ? d.venues : d.protocol ? [PROTOCOL_NAMES[d.protocol][lang]] : [];
  return v.join(" + ");
}

function extraTail(d: Draft, ctx: MeaningCtx, lang: "ru" | "en"): string {
  const xs = d.extra ?? [];
  if (!xs.length) return "";
  // One entry per receiver: «ещё 0.001 ERG и 1 HNS → 9eed…BgzL».
  const by = new Map<string, { role?: string; items: Array<[AssetKey, bigint]> }>();
  for (const e of xs) {
    const k = `${e.role ?? ""}|${e.to}`;
    const row = by.get(k) ?? { role: e.role, items: [] };
    row.items.push([e.key, e.amount]);
    by.set(k, row);
  }
  const rows = [...by].map(([k, v]) => ({ to: k.slice(k.indexOf("|") + 1), ...v }));
  const parts = rows.slice(0, 2).map((r) => {
    const to = r.role === "reemission" ? (lang === "ru" ? "реэмиссия" : "reemission") : who(r.to, ctx);
    return `${list(r.items, ctx, lang)} → ${to}`;
  });
  const left = rows.length - 2;
  const more = left > 0 ? (lang === "ru" ? ` и ещё ${left}` : ` and ${left} more`) : "";
  return lang === "ru" ? `; ещё ${parts.join(", ")}${more}` : `; also ${parts.join(", ")}${more}`;
}

type Lines = { ru: string; en: string };

export function sayDraft(d: Draft, ctx: MeaningCtx): Lines {
  const A = who(d.actor, ctx);
  const ru = A ?? "Кто-то";
  const en = A ?? "Someone";
  const P = { ru: proto(d, "ru"), en: proto(d, "en") };
  const V = { ru: venues(d, "ru"), en: venues(d, "en") };
  const gave = { ru: list(d.gave, ctx, "ru"), en: list(d.gave, ctx, "en") };
  const got = { ru: list(d.got, ctx, "ru"), en: list(d.got, ctx, "en") };
  const to = who(d.counterparty, ctx) ?? "?";
  const tail = { ru: extraTail(d, ctx, "ru"), en: extraTail(d, ctx, "en") };
  const n = d.count ?? 0;
  const pair = d.pair ? ` ${d.pair}` : "";

  switch (d.action) {
    case "send":
      if (d.sub === "own") {
        return { ru: `${ru} перевёл ${gave.ru} между своими адресами${tail.ru}`, en: `${en} moved ${gave.en} between its own addresses${tail.en}` };
      }
      return { ru: `${ru} отправил ${gave.ru} → ${to}${tail.ru}`, en: `${en} sent ${gave.en} to ${to}${tail.en}` };
    case "multisend":
      return { ru: `${ru} отправил ${gave.ru} адресам (${n})`, en: `${en} sent ${gave.en} to ${n} addresses` };
    case "self":
      return { ru: `${ru} перевёл средства себе`, en: `${en} moved funds to itself` };
    case "consolidate":
      return { ru: `${ru} объединил боксы: ${n} → ${d.count2 ?? 0}`, en: `${en} merged ${n} boxes into ${d.count2 ?? 0}` };
    case "block-reward":
      return { ru: `Майнер ${ru} получил ${got.ru} за блок`, en: `Miner ${en} got ${got.en} for the block` };
    case "fee-collect":
      return { ru: `Майнер ${ru} забрал комиссии блока: ${got.ru}`, en: `Miner ${en} took the block fees: ${got.en}` };
    case "miner-payout":
      if (d.sub === "claim") {
        return { ru: `Майнер ${ru} забрал награду: ${got.ru}${tail.ru}`, en: `Miner ${en} claimed the reward: ${got.en}${tail.en}` };
      }
      return { ru: `${ru} выплатил ${gave.ru} майнерам (${n})${tail.ru}`, en: `${en} paid ${gave.en} to ${n} miners${tail.en}` };
    case "rent":
      return {
        ru: `Майнер ${ru} взял плату за хранение со старых боксов (${n}): ${got.ru}`,
        en: `Miner ${en} took storage rent from ${n} old boxes: ${got.en}`,
      };
    case "token-issue":
      return { ru: `${ru} выпустил ${got.ru}`, en: `${en} issued ${got.en}` };
    case "nft-mint": {
      const [k] = d.got?.[0] ?? [""];
      const name = tokenLabel(k, ctx);
      return { ru: `${ru} выпустил NFT «${name}»`, en: `${en} minted NFT “${name}”` };
    }
    case "burn":
      return { ru: `${ru} сжёг ${gave.ru}`, en: `${en} burned ${gave.en}` };
    case "name-register":
      if (d.sub === "commit") {
        return { ru: `${ru} подал заявку на имя · ${P.ru}`, en: `${en} requested a name on ${P.en}` };
      }
      return d.label
        ? { ru: `${ru} зарегистрировал имя ${d.label} · ${P.ru}`, en: `${en} registered the name ${d.label} on ${P.en}` }
        : { ru: `${ru} зарегистрировал имя · ${P.ru}`, en: `${en} registered a name on ${P.en}` };
    case "swap": {
      const by = d.viaOrder ? { ru: " по заявке", en: " by order" } : { ru: "", en: "" };
      return {
        ru: `${ru} обменял ${gave.ru} на ${got.ru} · ${V.ru}${by.ru}${tail.ru}`,
        en: `${en} swapped ${gave.en} for ${got.en} on ${V.en}${by.en}${tail.en}`,
      };
    }
    case "lp-add": {
      const by = d.viaOrder ? { ru: " по заявке", en: " by order" } : { ru: "", en: "" };
      const g = d.gave?.length ? d.gave : [];
      return {
        ru: `${ru} вложил ${list(g, ctx, "ru")} в пул · ${V.ru}${by.ru}${tail.ru}`,
        en: `${en} added ${list(g, ctx, "en")} to a pool on ${V.en}${by.en}${tail.en}`,
      };
    }
    case "lp-remove": {
      const by = d.viaOrder ? { ru: " по заявке", en: " by order" } : { ru: "", en: "" };
      return {
        ru: `${ru} забрал ${got.ru} из пула · ${V.ru}${by.ru}${tail.ru}`,
        en: `${en} removed ${got.en} from a pool on ${V.en}${by.en}${tail.en}`,
      };
    }
    case "pool-create":
      return { ru: `${ru} создал пул${pair} · ${V.ru}`, en: `${en} created a${pair} pool on ${V.en}` };
    case "order-place":
      return { ru: `${ru} создал заявку на обмен ${gave.ru} · ${P.ru}`, en: `${en} placed a swap order with ${gave.en} on ${P.en}` };
    case "order-cancel":
      if (d.sub === "loan") {
        return { ru: `${ru} отменил заявку на заём, вернулось ${got.ru} · ${P.ru}`, en: `${en} cancelled a loan request, ${got.en} returned · ${P.en}` };
      }
      return { ru: `${ru} отменил заявку, вернулось ${got.ru} · ${P.ru}`, en: `${en} cancelled an order, ${got.en} returned · ${P.en}` };
    case "stable-mint":
      return { ru: `${ru} выпустил ${got.ru} за ${gave.ru} · ${P.ru}${tail.ru}`, en: `${en} minted ${got.en} for ${gave.en} on ${P.en}${tail.en}` };
    case "stable-redeem":
      return { ru: `${ru} погасил ${gave.ru} и получил ${got.ru} · ${P.ru}${tail.ru}`, en: `${en} redeemed ${gave.en} for ${got.en} on ${P.en}${tail.en}` };
    case "loan":
      switch (d.sub) {
        case "lend":
          return { ru: `${ru} выдал заём ${gave.ru}${d.counterparty ? ` → ${to}` : ""} · ${P.ru}`, en: `${en} lent ${gave.en}${d.counterparty ? ` to ${to}` : ""} on ${P.en}` };
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
      if (d.sub === "open") {
        return { ru: `${ru} открыл резерв ${gave.ru} · ${P.ru}`, en: `${en} opened a reserve with ${gave.en} · ${P.en}` };
      }
      return { ru: `${ru} внёс ${gave.ru} · ${P.ru}`, en: `${en} deposited ${gave.en} on ${P.en}` };
    case "unstake":
      return { ru: `${ru} вывел ${got.ru} · ${P.ru}`, en: `${en} withdrew ${got.en} from ${P.en}` };
    case "payout":
      if (d.sub === "reserve") {
        return { ru: `${ru} получил ${got.ru} из резерва · ${P.ru}`, en: `${en} received ${got.en} from a reserve · ${P.en}` };
      }
      return { ru: `${ru} получил выплату ${got.ru} · ${P.ru}`, en: `${en} received ${got.en} from ${P.en}` };
    case "auction":
      if (d.sub === "list") return { ru: `${ru} выставил лот на аукцион · ${P.ru}`, en: `${en} listed a lot on ${P.en}` };
      if (d.sub === "bid") return { ru: `${ru} сделал ставку ${gave.ru} · ${P.ru}`, en: `${en} bid ${gave.en} on ${P.en}` };
      return { ru: `Лот закрыт: ${ru} получил ${got.ru} · ${P.ru}`, en: `Lot settled: ${en} got ${got.en} on ${P.en}` };
    case "bridge-out": {
      const c = d.chain ? { ru: d.chain, en: d.chain } : { ru: "другую сеть", en: "another chain" };
      return { ru: `${ru} отправил ${gave.ru} в ${c.ru} · ${P.ru}${tail.ru}`, en: `${en} sent ${gave.en} to ${c.en} via ${P.en}${tail.en}` };
    }
    case "bridge-in": {
      const c = d.chain ? { ru: d.chain, en: d.chain } : { ru: "другой сети", en: "another chain" };
      return { ru: `${ru} получил ${got.ru} из ${c.ru} · ${P.ru}`, en: `${en} received ${got.en} from ${c.en} via ${P.en}` };
    }
    case "mix":
      return { ru: `Шаг микширования · ${P.ru}`, en: `Mixing step · ${P.en}` };
    case "oracle-post":
      return { ru: `Оператор ${ru} отправил цену в оракул${pair}`, en: `Operator ${en} posted a price to the${pair} oracle` };
    case "oracle-update":
      return n
        ? { ru: `Оракул${pair} обновил курс по ответам операторов (${n})`, en: `The${pair} oracle updated its rate from ${n} operator posts` }
        : { ru: `Оракул${pair} обновил курс`, en: `The${pair} oracle updated its rate` };
    case "service":
      switch (d.sub) {
        case "oracle-round":
          return { ru: `Оракул${pair} начал новый раунд сбора цен`, en: `The${pair} oracle started a new round` };
        case "oracle-governance":
          return { ru: `Голосование за контракт оракула${pair}`, en: `The${pair} oracle contract vote` };
        case "bridge-settle":
          return {
            ru: `Мост закрыл перевод${d.chain ? ` в ${d.chain}` : ""}: награды наблюдателям · ${P.ru}`,
            en: `Bridge settled a transfer${d.chain ? ` to ${d.chain}` : ""}: watcher rewards · ${P.en}`,
          };
        case "watcher-report":
          return { ru: `Наблюдатель ${ru} подтвердил перевод через мост · ${P.ru}`, en: `Watcher ${en} reported a bridge transfer · ${P.en}` };
        default:
          return d.label
            ? { ru: `Служебная операция «${d.label}» · ${P.ru}`, en: `${P.en} upkeep: “${d.label}”` }
            : { ru: `Служебная операция · ${P.ru}`, en: `${P.en} upkeep` };
      }
    case "contract-call":
      if (d.protocol && d.label) {
        return { ru: `${ru} вызвал «${d.label}» · ${P.ru}`, en: `${en} called “${d.label}” · ${P.en}` };
      }
      return d.got?.length
        ? { ru: `${ru} вызвал контракт ${to}, получил ${got.ru}`, en: `${en} called contract ${to} and got ${got.en}` }
        : { ru: `${ru} вызвал контракт ${to}`, en: `${en} called contract ${to}` };
    case "to-contract":
      if (d.protocol && d.label) {
        return { ru: `${ru} отправил ${gave.ru} в «${d.label}» · ${P.ru}`, en: `${en} sent ${gave.en} to “${d.label}” · ${P.en}` };
      }
      return { ru: `${ru} отправил ${gave.ru} в контракт ${to}`, en: `${en} sent ${gave.en} to contract ${to}` };
  }
}
