"use client";

import { Tip, TipInfo } from "@/components/Tip";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import {
  Feed,
  FeedAmount,
  FeedChip,
  FeedCount,
  FeedDays,
  FeedEmpty,
  FeedField,
  FeedFields,
  FeedIdLine,
  FeedPhrase,
  FeedRow,
  type FeedKind,
  type FeedLead,
} from "@/components/feed/Feed";
import type { FeedGlyphId } from "@/components/feed/FeedGlyph";
import { compactFigure, KpiGrid } from "@/components/KpiGrid";
import { KpiMark } from "@/components/kpi-marks";
import { RankWindow } from "@/components/RankWindow";
import { lookupAddress } from "@/lib/address-book";
import {
  BUYBACK_PACK,
  applyBuyback,
  emptyBuyback,
  fetchBuyback,
  type BuybackKind,
  type BuybackMove,
  type BuybackMoveKind,
  type BuybackPack,
} from "@/lib/buyback";
import { formatErg, formatErgFixed, formatErgPrecise, formatPct, formatTokenAmount, formatTs, shortId, toEpochMs } from "@/lib/format";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";
import { INK } from "@/lib/palette";

const DualLineChart = dynamic(() => import("@/components/DualLineChart"), {
  ssr: false,
});

const stroke = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.65,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function MarkScroll({ tone }: { tone: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-5 w-5 shrink-0" style={{ color: tone }}>
      <path d="M15 12h-5" {...stroke} />
      <path d="M15 8h-5" {...stroke} />
      <path d="M19 17V5a2 2 0 0 0-2-2H4" {...stroke} />
      <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" {...stroke} />
    </svg>
  );
}

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

function signedErg(nano: string, locale: string): string {
  let n = 0n;
  try {
    n = BigInt(nano);
  } catch {
    return "—";
  }
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const body = formatErgPrecise(abs.toString(), locale);
  if (n === 0n) return body;
  return `${neg ? "−" : "+"}${body}`;
}

function signedToken(raw: string, locale: string): string {
  let n = 0n;
  try {
    n = BigInt(raw);
  } catch {
    return "—";
  }
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const body = formatTokenAmount(abs.toString(), 0, locale);
  if (n === 0n) return body;
  return `${neg ? "−" : "+"}${body}`;
}

export function BuybackView({ kind, initial }: { kind: BuybackKind; initial?: BuybackPack }) {
  const t = useT();
  const { locale } = useI18n();
  const { markSynced } = usePageSync();
  const [pack, setPack] = useState(initial ?? emptyBuyback(kind));
  const [pending, setPending] = useState(false);
  const [offset, setOffset] = useState(0);
  const packRef = useRef(pack);
  packRef.current = pack;
  const skipMount = useRef(!!initial);
  const sym = pack.symbol || (kind === "gort" ? "GORT" : "DORT");

  const load = useCallback(
    async (silent = false) => {
      if (!silent && packRef.current.ready) setPending(true);
      try {
        const incoming = await fetchBuyback(kind);
        setPack((prev) => applyBuyback(prev, incoming));
      } finally {
        setPending(false);
        markSynced();
      }
    },
    [kind, markSynced]
  );

  useKeepFresh(() => void load(true));
  useEffect(() => {
    if (skipMount.current) {
      skipMount.current = false;
      markSynced();
      return;
    }
    void load(true);
  }, [load, markSynced]);


  const points = useMemo(
    () =>
      pack.series
        .filter((p) => Number.isFinite(p.erg) && Number.isFinite(p.token))
        .map((p) => ({ t: p.t, txs: p.erg, feesErg: p.token, feesKnown: true })),
    [pack.series]
  );

  const rows = pack.moves.slice(offset, offset + BUYBACK_PACK);
  const L = loc(locale);
  const bought = formatTokenAmount(pack.totals.bought, 0, locale);
  const sent = formatTokenAmount(pack.totals.sent, 0, locale);
  const backSub =
    pack.giveback === "blocked"
      ? t("buyback.kpiBackSubBlocked")
      : pack.giveback === "used"
        ? fill(t("buyback.kpiBackSubUsed"), { n: sent })
        : t("buyback.kpiBackSubIdle");
  const price = pack.lp ? formatErgPrecise(pack.lp.priceNano, locale) : "—";
  const canBuy = pack.canBuy ? formatTokenAmount(pack.canBuy, 0, locale) : null;

  const facts: string[] = [];
  if (pack.giveback === "blocked") {
    facts.push(
      fill(t("buyback.statusBlocked"), {
        old: shortId(pack.scriptOracleToken, 4),
        live: shortId(pack.pool.oracleToken ?? "", 4),
      })
    );
  } else if (pack.giveback === "used") {
    facts.push(fill(t("buyback.statusUsed"), { n: String(pack.totals.returns) }));
  } else if (pack.ready) {
    facts.push(t("buyback.statusIdle"));
  }
  if (pack.ready) facts.push(t("buyback.hole"));

  const notes: { key: string; label: string; value: string; hint?: string }[] = [];
  if (pack.bank) {
    notes.push({
      key: "bank",
      label: t("buyback.noteBank"),
      value: formatPct(pack.bank.ratioBps / 100, locale, 0, 1),
      hint: t("buyback.noteBankHint"),
    });
  }
  if (pack.coverRefreshes != null && pack.coverRefreshes > 0) {
    notes.push({
      key: "refresh",
      label: t("buyback.noteRefresh"),
      value: `~${pack.coverRefreshes.toLocaleString(L)}`,
    });
  }
  const spareN = Number(pack.spare);
  if (Number.isFinite(spareN) && spareN > 0) {
    notes.push({
      key: "nft",
      label: t("buyback.noteNft"),
      value: spareN.toLocaleString(L),
    });
  }
  if (pack.emission) {
    notes.push({
      key: "dev",
      label: t("buyback.noteDev"),
      value: `${formatTokenAmount(pack.emission.amount, 0, locale)} ${pack.symbol} · #${pack.emission.height.toLocaleString(L)}`,
    });
  }

  return (
    <Shell>
      <div className="flex flex-col">
        {!pack.ready ? (
          <p className="px-1 text-[13px] text-[var(--muted)]">{t("buyback.empty")}</p>
        ) : (
          <>
            <KpiGrid
              dense
              items={[
                {
                  label: t("buyback.kpiErg"),
                  value: pack.box ? formatErgPrecise(pack.box.erg, locale) : "—",
                  unavailable: !pack.box,
                  sub: pack.box
                    ? fill(t("buyback.kpiErgSub"), { h: pack.box.height.toLocaleString(L) })
                    : "—",
                  mark: <KpiMark id="erg" tone={INK.gold} />,
                  ink: INK.gold,
                  enter: 0,
                },
                {
                  label: fill(t("buyback.kpiToken"), { sym }),
                  value: pack.box ? formatTokenAmount(pack.box.token, 0, locale) : "—",
                  compact: pack.box ? compactFigure(Number(pack.box.token)) : undefined,
                  unavailable: !pack.box,
                  sub: fill(t("buyback.kpiTokenSub"), { bought }),
                  mark: <KpiMark id="token" tone={INK.cyan} />,
                  ink: INK.cyan,
                  enter: 1,
                },
                {
                  label: t("buyback.kpiSwaps"),
                  value: pack.totals.swaps.toLocaleString(L),
                  sub: fill(t("buyback.kpiSwapsSub"), {
                    erg: formatErgPrecise(pack.totals.ergOut, locale),
                  }),
                  mark: <KpiMark id="swap" tone={INK.sky} />,
                  ink: INK.sky,
                  enter: 2,
                },
                {
                  label: t("buyback.kpiTop"),
                  value: pack.totals.topups.toLocaleString(L),
                  sub: fill(t("buyback.kpiTopSub"), {
                    erg: formatErgFixed(pack.totals.ergIn, locale),
                  }),
                  mark: <KpiMark id="top-up" tone={INK.violet} />,
                  ink: INK.violet,
                  enter: 3,
                },
                {
                  label: t("buyback.kpiBack"),
                  value: pack.totals.returns.toLocaleString(L),
                  sub: backSub,
                  mark: <KpiMark id="returned" tone={pack.giveback === "blocked" ? INK.coral : INK.teal} />,
                  ink: pack.giveback === "blocked" ? INK.coral : INK.teal,
                  enter: 4,
                },
                {
                  label: t("buyback.kpiPrice"),
                  value: price,
                  unavailable: !pack.lp,
                  sub: canBuy
                    ? fill(t("buyback.kpiPriceSub"), { n: canBuy })
                    : fill(t("buyback.kpiPriceSubEmpty"), { sym }),
                  mark: <KpiMark id="price" tone={INK.green} />,
                  ink: INK.green,
                  enter: 5,
                },
              ]}
            />

            <div className="grid grid-cols-1 items-stretch gap-2 lg:grid-cols-3">
              <section
                className="home-tile-enter mod flex min-w-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-4"
                style={{ "--enter": 6 } as CSSProperties}
              >
                <div className="mb-2 min-w-0">
                  <div className="flex h-[22px] min-w-0 items-center gap-3">
                    <h2 className="m-0 flex min-w-0 items-center gap-1.5 text-[17px] font-semibold leading-[1.15] tracking-tight">
                      <Tip content={t("buyback.chartHint")} tap={false}>
                        <span className="truncate">{t("buyback.chartTitle")}</span>
                      </Tip>
                      <TipInfo content={t("buyback.chartHint")} label={t("buyback.chartHint")} />
                    </h2>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-[12px] text-[var(--muted)]">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: "var(--c-token)" }} />
                      {t("buyback.chartErg")}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: "var(--c-addr)" }} />
                      {fill(t("buyback.chartToken"), { sym })}
                    </span>
                  </div>
                </div>
                {points.length >= 2 ? (
                  <div className="min-h-[168px] flex-1">
                    <DualLineChart
                      points={points}
                      skipBin
                      binMs={0}
                      yRight
                      fillPlot
                      tipPulse
                      nameTxs={t("buyback.chartErg")}
                      nameFees={fill(t("buyback.chartToken"), { sym })}
                      formatTxs={(v) => formatErg(v, v >= 100 ? 0 : 2)}
                      formatFees={(v) => formatTokenAmount(Math.round(v), 0, locale)}
                      locale={L}
                      height={168}
                    />
                  </div>
                ) : (
                  <p className="flex min-h-[168px] flex-1 items-center justify-center text-[13px] text-[var(--muted)]">
                    {t("buyback.chartWait")}
                  </p>
                )}
              </section>

              <section
                className="home-tile-enter mod flex min-w-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-4 lg:col-span-2"
                style={{ "--enter": 7 } as CSSProperties}
              >
                <div className="flex h-[22px] min-w-0 items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <MarkScroll tone={INK.violet} />
                    <h2 className="m-0 truncate text-[17px] font-semibold leading-[1.15] tracking-tight">
                      {t("buyback.protoTitle")}
                    </h2>
                  </div>
                  <p className="m-0 flex shrink-0 items-center gap-x-3 text-[13px]">
                    <Link prefetch={false} href={`/token/${pack.tokenId}`} className="text-accent hover:underline">
                      {fill(t("buyback.linkToken"), { sym })}
                    </Link>
                    <Link prefetch={false} href={`/oracles/${pack.slug}`} className="text-accent hover:underline">
                      {t("buyback.linkPool")}
                    </Link>
                  </p>
                </div>
                <ol className="mt-3 grid gap-3 sm:grid-cols-3">
                  {(
                    [
                      ["buyback.stepTop", "buyback.stepTopBody", INK.violet],
                      ["buyback.stepSwap", "buyback.stepSwapBody", INK.cyan],
                      ["buyback.stepBack", "buyback.stepBackBody", INK.teal],
                    ] as const
                  ).map(([title, body, ink], i) => (
                    <li key={title} className="flex gap-2.5">
                      <span
                        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                        style={{ color: ink, background: `color-mix(in srgb, ${ink} 14%, transparent)` }}
                      >
                        {i + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold leading-[1.2]">{t(title)}</span>
                        <span className="mt-0.5 block text-[13px] leading-[1.35] text-[var(--muted)]">
                          {fill(t(body), { sym })}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="mt-auto border-t border-[var(--border-soft)] pt-3">
                  <div className="grid gap-x-6 gap-y-1 lg:grid-cols-2">
                    {facts.map((line) => (
                      <p key={line} className="m-0 text-[13px] leading-[1.35] text-[var(--muted)]">
                        {line}
                      </p>
                    ))}
                  </div>
                  {notes.length > 0 ? (
                    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] leading-snug">
                      {notes.map((note) => (
                        <Tip key={note.key} content={note.hint}>
                          <li className="min-w-0">
                            <span className="text-[var(--muted-2)]">{note.label} </span>
                            <span className="text-[var(--text)]">{note.value}</span>
                          </li>
                        </Tip>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </section>
            </div>

            <div className="feed-sheet mt-2">
              <Feed busy={pending}>
                {!rows.length ? (
                  <FeedEmpty k="oracle" title={t("buyback.empty")} />
                ) : (
                  <FeedDays
                    items={rows}
                    msOf={(row) => toEpochMs(row.ts)}
                    countOf={(n) => <FeedCount k="feed.actions" n={n} />}
                    render={(row, lead) => (
                      <FeedBuybackRow key={`${row.tx}-${row.kind}`} row={row} lead={lead} sym={sym} />
                    )}
                  />
                )}
              </Feed>
              {pack.moves.length > 0 && (
                <RankWindow
                  offset={offset}
                  pageSize={BUYBACK_PACK}
                  shown={rows.length}
                  total={pack.moves.length}
                  loc={L}
                  ofLabel={t("addresses.packOf")}
                  prevLabel={t("addresses.packPrev")}
                  nextLabel={t("addresses.packNext")}
                  tapeLabel={t("buyback.packTape")}
                  hint={t("buyback.packHint")}
                  disabled={pending}
                  onOffset={setOffset}
                />
              )}
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}

const ACT_TILE: Record<BuybackMoveKind, [FeedKind, FeedGlyphId]> = {
  topup: ["in", "in"],
  swap: ["swap", "swap"],
  return: ["reward", "reward"],
  open: ["box", "box"],
};

function bigOf(raw: string): bigint | null {
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

/** One buyback move: the ERG change is the figure; the token change is a chip; what is left sits under it. */
function FeedBuybackRow({ row, lead, sym }: { row: BuybackMove; lead: FeedLead; sym: string }) {
  const t = useT();
  const { locale } = useI18n();
  const L = loc(locale);
  const [k, g] = ACT_TILE[row.kind];
  const act = t(`buyback.act.${row.kind}`);
  const name = row.who ? lookupAddress(row.who)?.name ?? null : null;
  const derg = bigOf(row.derg);
  const dtok = bigOf(row.dtok);
  const height = row.blockId ? (
    <Link prefetch={false} href={`/block/${row.blockId}`} className="tabular-nums">
      {row.height.toLocaleString(L)}
    </Link>
  ) : (
    <span className="tabular-nums">{row.height.toLocaleString(L)}</span>
  );
  return (
    <FeedRow
      k={k}
      glyph={g}
      tileTitle={act}
      lead={lead}
      leadSub={!lead.same ? height : undefined}
      title={
        <Link prefetch={false} href={`/tx/${row.tx}`} title={row.tx} className="feed-name font-semibold hover:underline">
          {act}
        </Link>
      }
      facts={
        <>
          {row.who ? (
            <Link
              prefetch={false}
              href={`/address/${row.who}`}
              title={row.who}
              className={clsx("feed-kind", !name && "font-mono tabular-nums")}
            >
              {name ?? shortId(row.who, 6)}
            </Link>
          ) : null}
          <span className="feed-phone-only">{height}</span>
          <span className="feed-mid font-mono tabular-nums" title={row.tx}>
            {shortId(row.tx, 6)}
          </span>
          <span className="feed-wide">
            <FeedPhrase
              text={t("feed.left")}
              value={`${formatTokenAmount(row.token, 0, locale)} ${sym}`}
              slot="{v}"
            />
          </span>
        </>
      }
      chips={
        dtok != null && dtok !== 0n ? (
          <FeedChip title={`${signedToken(row.dtok, locale)} ${sym}`}>
            <span className={clsx("tabular-nums", dtok > 0n ? "is-up" : "is-down")}>
              {signedToken(row.dtok, locale)}
            </span>
            <span className="feed-chip-sym">{sym}</span>
          </FeedChip>
        ) : null
      }
      value={<FeedAmount raw={derg} signed />}
      sub={<FeedPhrase text={t("feed.left")} value={formatErgPrecise(row.erg, locale)} slot="{v}" />}
      subMinor
      detail={() => (
        <FeedFields>
          <FeedField label={t("buyback.colTx")} wide>
            <FeedIdLine href={`/tx/${row.tx}`} id={row.tx} />
          </FeedField>
          {row.who ? (
            <FeedField label={t("buyback.colWho")} wide>
              <FeedIdLine href={`/address/${row.who}`} id={row.who} />
            </FeedField>
          ) : null}
          <FeedField label={t("buyback.colHeight")}>
            <span className="tabular-nums">
              {height}
              {row.ts != null ? (
                <span className="text-[var(--muted-2)]" suppressHydrationWarning>
                  {" · "}
                  {formatTs(row.ts)}
                </span>
              ) : null}
            </span>
          </FeedField>
          <FeedField label={t("buyback.colErg")}>
            <span className="tabular-nums">{signedErg(row.derg, locale)}</span>
          </FeedField>
          <FeedField label={fill(t("buyback.colToken"), { sym })}>
            <span className="tabular-nums">{signedToken(row.dtok, locale)}</span>
          </FeedField>
          <FeedField label={t("buyback.colErgLeft")}>
            <span className="tabular-nums">{formatErgPrecise(row.erg, locale)}</span>
          </FeedField>
          <FeedField label={fill(t("buyback.colTokenLeft"), { sym })}>
            <span className="tabular-nums">{formatTokenAmount(row.token, 0, locale)}</span>
          </FeedField>
        </FeedFields>
      )}
    />
  );
}
