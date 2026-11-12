/**
 * GET /og/{tx|address|token}/{id} → 1200×630 PNG for link previews (og:image).
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
  Chips,
  Fact,
  Mono,
  OG,
  OG_SIZE,
  OgFrame,
  nanoToErg,
  ogFonts,
  ogNumber,
  ogShort,
  ogText,
  ogUtc,
  scaled,
  tokenLogoData,
  type OgChip,
} from "@/lib/og-card";
import { getGateway } from "@/lib/config";
import { SITE_URL } from "@/lib/site-meta";
import { tokenSymbol } from "@/lib/token-meta";
import { groupParties, markFeeOutputIndexes, type TxIo } from "@/lib/tx-flow";
import { toBigIntAmt } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEX64 = /^[0-9a-f]{64}$/;
/** 0.01 ERG: at or below this the ERG in a token transfer is the box minimum, not the point. */
const DUST_NANO = 10_000_000n;
const ADDR = /^[1-9A-HJ-NP-Za-km-z]{30,3000}$/;

function fallback(): Response {
  return Response.redirect(new URL("/og.png?v=4", SITE_URL), 302);
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

async function txCard(tx: TxPageSnapshot) {
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
  const when = ogUtc(tx.timestamp ?? null);
  const what =
    action === "oracle-datapoint"
      ? "oracle update"
      : category === "contract"
        ? "contract call, nothing transferred"
        : "sent to itself";

  return (
    <OgFrame
      plate={coinbase ? "Block reward" : tx.confirmed ? "Transaction" : "Mempool transaction"}
      plateColor={coinbase ? OG.block : OG.tx}
      left={[
        tx.inclusionHeight != null ? (
          <Fact label="Block" value={tx.inclusionHeight.toLocaleString("en-US")} color={OG.block} />
        ) : (
          <Fact label="Status" value="pending" color={OG.tx} />
        ),
        when ? <Fact value={when} /> : null,
      ]}
      right={ogShort(tx.id, 8)}
    >
      {lead === "erg" ? (
        <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
          <Mono size={112}>{ogNumber(nanoToErg(movedNano), 4)}</Mono>
          <Mono size={44} color={OG.muted} weight={500}>
            ERG
          </Mono>
        </div>
      ) : headToken ? (
        <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
          {headLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={headLogo} width={92} height={92} style={{ borderRadius: 999 }} alt="" />
          ) : (
            <div style={{ display: "flex", width: 92, height: 92, borderRadius: 999, background: OG.token }} />
          )}
          <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
            <Mono size={104}>{ogNumber(headToken.amount, 4)}</Mono>
            <div style={{ display: "flex", fontSize: 44, fontWeight: 600, color: OG.token }}>{headToken.label}</div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
          <Mono size={112}>{ogNumber(nanoToErg(tx.fee ?? 0), 6)}</Mono>
          <Mono size={44} color={OG.muted} weight={500}>
            ERG fee
          </Mono>
        </div>
      )}
      {lead === "fee" ? (
        <div style={{ display: "flex", alignItems: "center", gap: 22, fontSize: 36 }}>
          <div style={{ display: "flex", color: OG.address, fontWeight: 600 }}>{fromLabel}</div>
          <div style={{ display: "flex", color: OG.muted }}>{what}</div>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 22, fontSize: 36 }}>
          <div style={{ display: "flex", color: OG.address, fontWeight: 600 }}>{fromLabel}</div>
          {fromMore ? <div style={{ display: "flex", color: OG.muted, fontFamily: "Plex Mono" }}>+{fromMore}</div> : null}
          <div style={{ display: "flex", color: OG.muted }}>→</div>
          <div style={{ display: "flex", color: OG.address, fontWeight: 600 }}>{toLabel}</div>
          {toMore ? <div style={{ display: "flex", color: OG.muted, fontFamily: "Plex Mono" }}>+{toMore}</div> : null}
        </div>
      )}
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
  const { chips, more } = await chipsFor(list);
  const tokenCount = (data as { tokenCount?: number }).tokenCount ?? list.length;
  const firstTs = (data as { firstTs?: number | null }).firstTs ?? null;
  const since = ogUtc(firstTs)?.split(",")[0] ?? null;
  return (
    <OgFrame
      plate="Address"
      plateColor={OG.address}
      left={[
        <Fact label="Tokens" value={tokenCount.toLocaleString("en-US")} color={OG.token} />,
        since ? <Fact label="Since" value={since} /> : null,
      ]}
      right={name ? ogShort(data.address, 8) : null}
    >
      <div style={{ display: "flex", fontSize: name ? 52 : 44, fontWeight: 600, color: OG.address, fontFamily: name ? "Plex Sans" : "Plex Mono" }}>
        {name || ogShort(data.address, 12)}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
        <Mono size={104}>{ogNumber(erg, 4)}</Mono>
        <Mono size={44} color={OG.muted} weight={500}>
          ERG
        </Mono>
      </div>
      <Chips chips={chips} more={more} />
    </OgFrame>
  );
}

async function tokenCard(tokenId: string) {
  const row = await fetchTokenListItem(tokenId);
  if (!row) return null;
  const symbol = ogText(tokenSymbol(row.tokenId, row.name), 20) || ogText(row.name, 20) || ogShort(row.tokenId, 6);
  const fullName = ogText(row.name, 40);
  const logo = await tokenLogoData(row.tokenId);
  const supply = row.emission != null ? ogNumber(scaled(row.emission, row.decimals ?? 0), 2) : null;
  const since = row.firstTs != null ? ogUtc(row.firstTs)?.split(",")[0] ?? null : null;
  return (
    <OgFrame
      plate="Token"
      plateColor={OG.token}
      left={[since ? <Fact label="Since" value={since} /> : null]}
      right={ogShort(row.tokenId, 8)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} width={128} height={128} style={{ borderRadius: 999 }} alt="" />
        ) : (
          <div style={{ display: "flex", width: 128, height: 128, borderRadius: 999, background: OG.token }} />
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 600, color: OG.text }}>{symbol}</div>
          {fullName && fullName !== symbol ? (
            <div style={{ display: "flex", fontSize: 32, color: OG.soft }}>{fullName}</div>
          ) : null}
        </div>
      </div>
      <div style={{ display: "flex", gap: 56 }}>
        {row.holders != null ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", fontSize: 26, color: OG.muted }}>Holders</div>
            <Mono size={56} color={OG.address}>{row.holders.toLocaleString("en-US")}</Mono>
          </div>
        ) : null}
        {supply ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", fontSize: 26, color: OG.muted }}>Supply</div>
            <Mono size={56}>{supply}</Mono>
          </div>
        ) : null}
        {row.txCount != null ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", fontSize: 26, color: OG.muted }}>Transactions</div>
            <Mono size={56} color={OG.tx}>{row.txCount.toLocaleString("en-US")}</Mono>
          </div>
        ) : null}
      </div>
    </OgFrame>
  );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ kind: string; id: string }> }
): Promise<Response> {
  const { kind, id: raw } = await params;
  const id = decodeURIComponent(raw ?? "").trim();
  try {
    let card: React.ReactElement | null = null;
    let maxAge = 600;
    if (kind === "tx" && HEX64.test(id.toLowerCase())) {
      const tx = await fetchTransaction(id.toLowerCase());
      if (tx) {
        card = await txCard(tx);
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
