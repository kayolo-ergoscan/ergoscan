/**
 * GET /og/{tx|address|token}/{id} → 1200×630 PNG for link previews (og:image).
 * GET /og/site/card → the site-wide card (scripts/bake-og.py saves it as public/og.png).
 * Data comes from the same snapshot fetchers as the pages; nothing is stored.
 * Unknown ids fall back to the site-wide /og.png.
 */
import { ImageResponse } from "next/og";
import { lookupAddress } from "@/lib/address-book";
import {
  fetchAddressPage,
  fetchTokenListItem,
  fetchTransaction,
  type TxPageSnapshot,
} from "@/lib/list-snapshots";
import {
  BigFigure,
  Chips,
  ergodexLpLogoData,
  Gap,
  Mono,
  OG,
  OG_SIZE,
  OgFrame,
  OgSiteCard,
  nanoToErg,
  ogClock,
  ogDate,
  ogFonts,
  ogNumber,
  ogShort,
  ogText,
  scaled,
  tokenLogoData,
  type OgChip,
  type OgTile,
} from "@/lib/og-card";
import { getGateway } from "@/lib/config";
import { SITE_OG_CAPTION, SITE_OG_HEADING, SITE_URL } from "@/lib/site-meta";
import { tokenSymbol } from "@/lib/token-meta";
import { groupParties, markFeeOutputIndexes, type TxIo } from "@/lib/tx-flow";
import { toBigIntAmt } from "@/lib/format";
import { parseFullMeaning } from "@/lib/tx-meaning-row";
import {
  assetLabel,
  ERGODEX_LP_ART_SOURCE,
  formatAmount,
  meaningPage,
  type MeaningAssetLike,
  type TxMeaning,
} from "@ergoscan/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEX64 = /^[0-9a-f]{64}$/;
/** 0.01 ERG: at or below this the ERG in a token transfer is the box minimum, not the point. */
const DUST_NANO = 10_000_000n;
const ADDR = /^[1-9A-HJ-NP-Za-km-z]{30,3000}$/;

function fallback(): Response {
  return Response.redirect(new URL("/og.png?v=5", SITE_URL), 302);
}

function who(address: string | null | undefined): string {
  if (!address) return "—";
  let name = ogText(lookupAddress(address)?.name, 60);
  // "Spectrum AMM Pool (ERG/token)" → "Spectrum AMM Pool" when the whole name does not fit.
  if (name && name.length > 24 && name.includes(" (")) name = name.slice(0, name.indexOf(" ("));
  return (name && ogText(name, 26)) || ogShort(address, 6);
}

async function chipsFor(
  list: { tokenId: string; amount: number; label: string }[],
  max = 3
): Promise<{ chips: OgChip[]; more: number }> {
  const shown = list.slice(0, max);
  const chips = await Promise.all(
    shown.map(async (t) => ({
      label: t.label,
      amount: ogNumber(t.amount, 2),
      logo: await tokenLogoData(t.tokenId),
    }))
  );
  return { chips, more: Math.max(0, list.length - shown.length) };
}

type OgLang = "en" | "ru";

const OG_WORDS = {
  block: { en: "Block", ru: "Блок" },
  status: { en: "Status", ru: "Статус" },
  pending: { en: "pending", ru: "в мемпуле" },
  time: { en: "Time · UTC", ru: "Время · UTC" },
  fee: { en: "Network fee", ru: "Комиссия сети" },
  boxes: { en: "Boxes in → out", ru: "Боксы вх → вых" },
  for: { en: "for", ru: "за" },
} as const;

/** The phrase as the card fonts can draw it (no emoji), cut to three lines or so. */
function ogPhrase(s: string, max = 150): string {
  const clean = s
    .replace(/[^\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{N}\p{P}\p{Zs}$+<=>^`|~→−]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function ogAsset(a: MeaningAssetLike): { value: string; unit: string } {
  const dec = a.token ? (a.decimals ?? 0) : 9;
  return { value: formatAmount(a.amount, dec), unit: ogText(assetLabel(a), 14) || "?" };
}

/**
 * A tx with a meaning: the action (and protocol) on the plate, the phrase as the headline, then
 * what the actor got (or gave) as the big figure and what it paid for it. RU or EN by `lang`.
 */
async function meaningCard(tx: TxPageSnapshot, m: TxMeaning, lang: OgLang) {
  const page = meaningPage(m, lang, { feeNano: tx.fee != null ? String(tx.fee) : null });
  const r = page.row;
  const plate = r.where ? `${r.word} · ${r.where}` : r.word;
  const big = r.big ? ogAsset(r.big) : null;
  const paid = r.big && r.gave.length && r.big !== r.gave[0] ? ogAsset(r.gave[0]!) : null;
  const logo = r.big?.token ? await tokenLogoData(r.big.token) : null;
  const ts = tx.timestamp ?? null;
  const day = ogDate(ts);
  const nIn = tx.inputCount ?? (tx.inputs ?? []).length;
  const nOut = tx.outputCount ?? (tx.outputs ?? []).length;
  const w = (k: keyof typeof OG_WORDS) => OG_WORDS[k][lang];
  const tiles: OgTile[] = [
    tx.inclusionHeight != null
      ? { label: w("block"), value: tx.inclusionHeight.toLocaleString("en-US"), color: OG.block }
      : { label: w("status"), value: w("pending"), color: OG.tx },
    { label: day ? `${day} · UTC` : w("time"), value: ogClock(ts) ?? "—" },
    { label: w("fee"), value: ogNumber(nanoToErg(tx.fee ?? 0), 6), unit: "ERG" },
    { label: w("boxes"), value: `${nIn} → ${nOut}` },
  ];
  const phrase = ogPhrase(page.phrase);
  return (
    <OgFrame plate={ogText(plate, 40) ?? plate} plateColor={OG.tx} id={ogShort(tx.id, 8)} tiles={tiles}>
      <div
        style={{
          display: "flex",
          fontSize: phrase.length > 90 ? 34 : 40,
          lineHeight: 1.3,
          color: OG.text,
          fontWeight: 600,
          maxHeight: 160,
          overflow: "hidden",
        }}
      >
        {phrase}
      </div>
      {big ? (
        <>
          <Gap h={26} />
          <div style={{ display: "flex", alignItems: "center" }}>
            {r.big?.token ? (
              logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} width={72} height={72} style={{ borderRadius: 999, marginRight: 22 }} alt="" />
              ) : (
                <div style={{ display: "flex", width: 72, height: 72, borderRadius: 999, background: OG.token, marginRight: 22 }} />
              )
            ) : null}
            <BigFigure value={big.value} unit={big.unit} size={84} unitColor={r.big?.token ? OG.token : OG.muted} />
            {paid ? (
              <div style={{ display: "flex", alignItems: "baseline", marginLeft: 30, fontSize: 34, color: OG.muted }}>
                {w("for")}
                <div style={{ display: "flex", marginLeft: 12, fontFamily: "Plex Mono", fontWeight: 600, color: OG.soft }}>
                  {paid.value}
                </div>
                <div style={{ display: "flex", marginLeft: 10 }}>{paid.unit}</div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </OgFrame>
  );
}

async function txCard(tx: TxPageSnapshot, lang: OgLang = "en") {
  const meaning = parseFullMeaning(tx.meaning);
  if (meaning) return meaningCard(tx, meaning, lang);
  const ins = (tx.inputs ?? []) as TxIo[];
  const outs = (tx.outputs ?? []) as TxIo[];
  const feeIdx = markFeeOutputIndexes(outs, toBigIntAmt(tx.fee));
  const from = groupParties(ins, feeIdx, "in").filter((p) => !p.isFee);
  const to = groupParties(outs, feeIdx, "out").filter((p) => !p.isFee);
  const spent = new Map(from.map((p) => [p.key, p]));
  const got = new Map(to.map((p) => [p.key, p]));

  // Net ERG per party: what it received minus what it put in.
  const receivers = to
    .map((p) => ({ p, net: p.erg - (spent.get(p.key)?.erg ?? 0n) }))
    .filter((x) => x.net > 0n)
    .sort((a, b) => (b.net > a.net ? 1 : b.net < a.net ? -1 : 0));
  const senders = from
    .map((p) => ({ p, net: (got.get(p.key)?.erg ?? 0n) - p.erg }))
    .filter((x) => x.net < 0n)
    .sort((a, b) => (a.net > b.net ? 1 : a.net < b.net ? -1 : 0));
  const movedNano = receivers.reduce((s, x) => s + x.net, 0n);

  // Tokens that ended up with someone who did not put them in.
  const meta = new Map((tx.tokenMeta ?? []).map((m) => [m.tokenId, m]));
  const tokenNet = new Map<string, bigint>();
  for (const p of to) {
    const before = spent.get(p.key)?.tokens;
    for (const [id, amt] of p.tokens) {
      const d = amt - (before?.get(id) ?? 0n);
      if (d > 0n) tokenNet.set(id, (tokenNet.get(id) ?? 0n) + d);
    }
  }
  const tokens = [...tokenNet.entries()].map(([tokenId, raw]) => {
    const m = meta.get(tokenId);
    return {
      tokenId,
      amount: scaled(raw, m?.decimals ?? 0),
      label: ogText(tokenSymbol(tokenId, m?.name), 14) || ogText(m?.name, 14) || ogShort(tokenId, 4),
    };
  });

  const action = (tx as { action?: string | null }).action ?? null;
  const category = (tx as { category?: string | null }).category ?? null;

  // What the card leads with: ERG that changed hands; a token when the ERG is only the
  // box minimum that carries it; the fee when nothing changed hands at all.
  const lead: "erg" | "token" | "fee" =
    category === "coinbase" || movedNano > DUST_NANO || (movedNano > 0n && !tokens.length) ? "erg" : tokens.length ? "token" : "fee";
  const headToken = lead === "token" ? tokens[0]! : null;
  const coinbase = (tx as { category?: string | null }).category === "coinbase";
  // A block reward also moves re-emission tokens; that is plumbing, not news.
  const { chips, more } = coinbase ? { chips: [], more: 0 } : await chipsFor(headToken ? tokens.slice(1) : tokens);
  const headLogo = headToken ? await tokenLogoData(headToken.tokenId) : null;

  const fromLabel = senders[0] ? who(senders[0].p.address) : from[0] ? who(from[0].address) : "—";
  const toLabel = receivers[0] ? who(receivers[0].p.address) : to[0] ? who(to[0].address) : "—";
  const fromMore = Math.max(0, senders.length - 1);
  const toMore = Math.max(0, receivers.length - 1);
  const what =
    action === "oracle-datapoint"
      ? "oracle update"
      : category === "contract"
        ? "contract call, nothing transferred"
        : "sent to itself";
  const ts = tx.timestamp ?? null;
  const day = ogDate(ts);
  const nIn = tx.inputCount ?? ins.length;
  const nOut = tx.outputCount ?? outs.length;
  const tiles: OgTile[] = [
    tx.inclusionHeight != null
      ? { label: "Block", value: tx.inclusionHeight.toLocaleString("en-US"), color: OG.block }
      : { label: "Status", value: "pending", color: OG.tx },
    { label: day ? `${day} · UTC` : "Time · UTC", value: ogClock(ts) ?? "—" },
    // The fee already leads a fee-only card, and a block reward pays none: show the size there.
    lead === "fee" || coinbase
      ? { label: "Size", value: (tx.size ?? 0).toLocaleString("en-US"), unit: "bytes" }
      : { label: "Fee", value: ogNumber(nanoToErg(tx.fee ?? 0), 6), unit: "ERG" },
    { label: "Boxes in → out", value: `${nIn} → ${nOut}` },
  ];
  const party = (label: string) => (
    <div style={{ display: "flex", color: OG.address, fontWeight: 600, maxWidth: 420, overflow: "hidden" }}>{label}</div>
  );
  const plus = (n: number) =>
    n ? <div style={{ display: "flex", marginLeft: 10, color: OG.muted, fontFamily: "Plex Mono" }}>+{n}</div> : null;

  return (
    <OgFrame
      plate={coinbase ? "Block reward" : tx.confirmed ? "Transaction" : "Mempool transaction"}
      plateColor={coinbase ? OG.block : OG.tx}
      id={ogShort(tx.id, 8)}
      tiles={tiles}
    >
      {lead === "fee" ? (
        <div style={{ display: "flex", alignItems: "center", fontSize: 34 }}>
          {party(fromLabel)}
          <div style={{ display: "flex", marginLeft: 20, color: OG.muted }}>{what}</div>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", fontSize: 34 }}>
          {party(fromLabel)}
          {plus(fromMore)}
          <div style={{ display: "flex", marginLeft: 20, marginRight: 20, color: OG.tx }}>→</div>
          {party(toLabel)}
          {plus(toMore)}
        </div>
      )}
      <Gap h={22} />
      {lead === "erg" ? (
        <BigFigure value={ogNumber(nanoToErg(movedNano), 4)} unit="ERG" />
      ) : headToken ? (
        <div style={{ display: "flex", alignItems: "center" }}>
          {headLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={headLogo} width={84} height={84} style={{ borderRadius: 999 }} alt="" />
          ) : (
            <div style={{ display: "flex", width: 84, height: 84, borderRadius: 999, background: OG.token }} />
          )}
          <div style={{ display: "flex", marginLeft: 24 }}>
            <BigFigure value={ogNumber(headToken.amount, 4)} unit={headToken.label} size={96} unitColor={OG.token} />
          </div>
        </div>
      ) : (
        <BigFigure value={ogNumber(nanoToErg(tx.fee ?? 0), 6)} unit="ERG fee" />
      )}
      {chips.length ? <Gap h={24} /> : null}
      <Chips chips={chips} more={more} />
    </OgFrame>
  );
}

type AddrToken = { tokenId: string; amount: string; amountUi?: number | null; name: string | null; decimals: number; valueUsd?: number | null };

/** The page snapshot defers tokens; the address page loads them from this endpoint too. */
async function addressTokens(address: string): Promise<AddrToken[]> {
  try {
    const r = await fetch(`${getGateway()}/v1/addresses/${encodeURIComponent(address)}/tokens`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { tokens?: AddrToken[] };
    return Array.isArray(j.tokens) ? j.tokens : [];
  } catch {
    return [];
  }
}

async function addressCard(address: string) {
  const [data, held] = await Promise.all([fetchAddressPage(address), addressTokens(address)]);
  if (!data) return null;
  const name = ogText(data.name?.name, 32) || ogText(lookupAddress(data.address)?.name, 32);
  const erg = nanoToErg(data.balance?.confirmedNanoErg ?? 0);
  const list = [...held]
    .sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1))
    .map((t) => ({
      tokenId: t.tokenId,
      amount: t.amountUi ?? scaled(t.amount, t.decimals ?? 0),
      label: ogText(tokenSymbol(t.tokenId, t.name), 14) || ogText(t.name, 14) || ogShort(t.tokenId, 4),
    }));
  const { chips } = await chipsFor(list);
  const tokenCount = data.tokenCount ?? list.length;
  const txTotal = data.pagination?.txs.total ?? null;
  const boxes = data.pagination?.boxes;
  const boxTotal = boxes ? (boxes.total ?? (boxes.hasMore ? null : boxes.returned)) : null;
  const tiles: OgTile[] = [
    { label: "Transactions", value: txTotal != null ? txTotal.toLocaleString("en-US") : "—", color: OG.tx },
    { label: "Unspent boxes", value: boxTotal != null ? boxTotal.toLocaleString("en-US") : "—", color: OG.box },
    { label: "First seen", value: ogDate(data.firstTs) ?? "—" },
    { label: "Last seen", value: ogDate(data.lastTs) ?? "—" },
  ];
  return (
    <OgFrame plate="Address" plateColor={OG.address} tiles={tiles}>
      {name ? (
        <div style={{ display: "flex", alignItems: "baseline" }}>
          <div style={{ display: "flex", fontSize: name.length > 20 ? 40 : 50, fontWeight: 600, color: OG.text, lineHeight: 1, maxWidth: 660, overflow: "hidden" }}>
            {name}
          </div>
          <div style={{ display: "flex", marginLeft: 22 }}>
            <Mono size={30} color={OG.address} weight={500}>
              {ogShort(data.address, 8)}
            </Mono>
          </div>
        </div>
      ) : (
        <Mono size={40} color={OG.address} weight={500}>
          {ogShort(data.address, 12)}
        </Mono>
      )}
      <Gap h={24} />
      <BigFigure value={ogNumber(erg, 4)} unit="ERG" />
      {chips.length || tokenCount ? <Gap h={24} /> : null}
      <Chips chips={chips} tail={tokenCount > chips.length ? `${tokenCount.toLocaleString("en-US")} tokens` : null} />
    </OgFrame>
  );
}

async function tokenCard(tokenId: string) {
  const row = await fetchTokenListItem(tokenId);
  if (!row) return null;
  const symbol = ogText(tokenSymbol(row.tokenId, row.name), 20) || ogText(row.name, 20) || ogShort(row.tokenId, 6);
  const fullName = ogText(row.name, 40);
  // A catalog logo first; an ErgoDex liquidity token without art of its own gets the ErgoDex logo.
  const logo =
    (await tokenLogoData(row.tokenId)) ??
    (row.artworkSource === ERGODEX_LP_ART_SOURCE ? await ergodexLpLogoData() : null);
  const supply = row.emission != null ? ogNumber(scaled(row.emission, row.decimals ?? 0), 2) : null;
  const n = (v: number | null) => (v != null ? v.toLocaleString("en-US") : "—");
  const tiles: OgTile[] = [
    { label: "Holders", value: n(row.holders), color: OG.address },
    { label: "Transactions", value: n(row.txCount), color: OG.tx },
    { label: "Supply", value: supply ?? "—" },
    { label: "First minted", value: ogDate(row.firstTs) ?? "—" },
  ];
  const sub = [fullName && fullName !== symbol ? fullName : null, `${row.decimals ?? 0} decimals`].filter(Boolean).join(" · ");
  return (
    <OgFrame plate="Token" plateColor={OG.token} id={ogShort(row.tokenId, 8)} tiles={tiles}>
      <div style={{ display: "flex", alignItems: "center" }}>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} width={136} height={136} style={{ borderRadius: 999 }} alt="" />
        ) : (
          <div style={{ display: "flex", width: 136, height: 136, borderRadius: 999, background: OG.token }} />
        )}
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 36 }}>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 600, color: OG.text, lineHeight: 1, letterSpacing: -1.5 }}>{symbol}</div>
          <div style={{ display: "flex", marginTop: 16, fontSize: 32, color: OG.soft }}>{sub}</div>
        </div>
      </div>
    </OgFrame>
  );
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ kind: string; id: string }> }
): Promise<Response> {
  const { kind, id: raw } = await params;
  const id = decodeURIComponent(raw ?? "").trim();
  try {
    let card: React.ReactElement | null = null;
    let maxAge = 600;
    if (kind === "site" && id === "card") {
      card = <OgSiteCard heading={SITE_OG_HEADING} caption={SITE_OG_CAPTION} />;
      maxAge = 86_400;
    } else if (kind === "tx" && HEX64.test(id.toLowerCase())) {
      const tx = await fetchTransaction(id.toLowerCase());
      if (tx) {
        // The site's public language is English; ?lang=ru draws the Russian card.
        const lang: OgLang = new URL(req.url).searchParams.get("lang") === "ru" ? "ru" : "en";
        card = await txCard(tx, lang);
        // A confirmed tx never changes; a mempool one may confirm any second.
        maxAge = tx.confirmed ? 86_400 : 60;
      }
    } else if (kind === "address" && ADDR.test(id)) {
      card = await addressCard(id);
    } else if (kind === "token" && HEX64.test(id.toLowerCase())) {
      card = await tokenCard(id.toLowerCase());
      maxAge = 3600;
    }
    if (!card) return fallback();
    return new ImageResponse(card, {
      ...OG_SIZE,
      fonts: await ogFonts(),
      headers: {
        "Cache-Control": `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 4}`,
      },
    });
  } catch (e) {
    console.warn("[og]", kind, String(e).slice(0, 200));
    return fallback();
  }
}
