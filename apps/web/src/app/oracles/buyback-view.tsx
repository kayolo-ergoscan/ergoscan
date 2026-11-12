"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import { StuckPin } from "@/components/StuckPin";
import { KpiGrid } from "@/components/KpiGrid";
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
import { formatErg, formatErgFixed, formatErgPrecise, formatRelAge, formatTokenAmount, shortId } from "@/lib/format";
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

function Mark({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-9 w-9" style={{ color: tone }}>
      {children}
    </svg>
  );
}

function MarkWallet({ tone }: { tone: string }) {
  return (
    <Mark tone={tone}>
      <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" {...stroke} />
      <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" {...stroke} />
    </Mark>
  );
}

function MarkGem({ tone }: { tone: string }) {
  return (
    <Mark tone={tone}>
      <path d="M10.5 3 8 9l4 13 4-13-2.5-6" {...stroke} />
      <path d="M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z" {...stroke} />
      <path d="M2 9h20" {...stroke} />
    </Mark>
  );
}

function MarkSwap({ tone }: { tone: string }) {
  return (
    <Mark tone={tone}>
      <path d="M8 3 4 7l4 4" {...stroke} />
      <path d="M4 7h16" {...stroke} />
      <path d="m16 21 4-4-4-4" {...stroke} />
      <path d="M20 17H4" {...stroke} />
    </Mark>
  );
}

function MarkPlus({ tone }: { tone: string }) {
  return (
    <Mark tone={tone}>
      <circle cx="12" cy="12" r="10" {...stroke} />
      <path d="M8 12h8" {...stroke} />
      <path d="M12 8v8" {...stroke} />
    </Mark>
  );
}

function MarkReturn({ tone }: { tone: string }) {
  return (
    <Mark tone={tone}>
      <path d="M9 14 4 9l5-5" {...stroke} />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" {...stroke} />
    </Mark>
  );
}

function MarkScale({ tone }: { tone: string }) {
  return (
    <Mark tone={tone}>
      <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" {...stroke} />
      <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" {...stroke} />
      <path d="M7 21h10" {...stroke} />
      <path d="M12 3v18" {...stroke} />
      <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" {...stroke} />
    </Mark>
  );
}

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

const ACT_INK: Record<BuybackMoveKind, string> = {
  topup: INK.gold,
  swap: INK.cyan,
  return: INK.teal,
  open: INK.violet,
};

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

function whoLabel(address: string | null): string {
  if (!address) return "";
  return lookupAddress(address)?.name || shortId(address, 10);
}

export function BuybackView({ kind, initial }: { kind: BuybackKind; initial?: BuybackPack }) {
  const t = useT();
  const { locale } = useI18n();
  const { markSynced } = usePageSync();
  const [pack, setPack] = useState(initial ?? emptyBuyback(kind));
  const [pending, setPending] = useState(false);
  const [offset, setOffset] = useState(0);
  const [stuck, setStuck] = useState(false);
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
      value: `${(pack.bank.ratioBps / 100).toLocaleString(L, { maximumFractionDigits: 1 })}%`,
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
                  mark: <MarkWallet tone={INK.gold} />,
                  ink: INK.gold,
                  enter: 0,
                },
                {
                  label: fill(t("buyback.kpiToken"), { sym }),
                  value: pack.box ? formatTokenAmount(pack.box.token, 0, locale) : "—",
                  unavailable: !pack.box,
                  sub: fill(t("buyback.kpiTokenSub"), { bought }),
                  mark: <MarkGem tone={INK.cyan} />,
                  ink: INK.cyan,
                  enter: 1,
                },
                {
                  label: t("buyback.kpiSwaps"),
                  value: pack.totals.swaps.toLocaleString(L),
                  sub: fill(t("buyback.kpiSwapsSub"), {
                    erg: formatErgPrecise(pack.totals.ergOut, locale),
                  }),
                  mark: <MarkSwap tone={INK.sky} />,
                  ink: INK.sky,
                  enter: 2,
                },
                {
                  label: t("buyback.kpiTop"),
                  value: pack.totals.topups.toLocaleString(L),
                  sub: fill(t("buyback.kpiTopSub"), {
                    erg: formatErgFixed(pack.totals.ergIn, locale),
                  }),
                  mark: <MarkPlus tone={INK.violet} />,
                  ink: INK.violet,
                  enter: 3,
                },
                {
                  label: t("buyback.kpiBack"),
                  value: pack.totals.returns.toLocaleString(L),
                  sub: backSub,
                  mark: <MarkReturn tone={pack.giveback === "blocked" ? INK.coral : INK.teal} />,
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
                  mark: <MarkScale tone={INK.green} />,
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
                    <h2
                      className="m-0 truncate text-[17px] font-semibold leading-[1.15] tracking-tight"
                      title={t("buyback.chartHint")}
                    >
                      {t("buyback.chartTitle")}
                    </h2>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-[12px] text-[var(--muted)]">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: "#86a6f0" }} />
                      {t("buyback.chartErg")}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: "#e799b7" }} />
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
                        <li key={note.key} className="min-w-0" title={note.hint}>
                          <span className="text-[var(--muted-2)]">{note.label} </span>
                          <span className="text-[var(--text)]">{note.value}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </section>
            </div>

            <div className="addr-sheet mt-2">
              <StuckPin onStuck={setStuck} />
              <div className="addr-pan">
                <div
                  className={clsx(
                    "addr-head addr-lane addr-lane-x buyback-lane text-[12px] font-medium",
                    stuck && "is-stuck"
                  )}
                >
                  <div>{t("buyback.colHeight")}</div>
                  <div>{t("buyback.colWhen")}</div>
                  <div>{t("buyback.colAction")}</div>
                  <div className="buyback-num">{t("buyback.colErg")}</div>
                  <div className="buyback-num">{fill(t("buyback.colToken"), { sym })}</div>
                  <div className="buyback-num">{t("buyback.colErgLeft")}</div>
                  <div className="buyback-num">{fill(t("buyback.colTokenLeft"), { sym })}</div>
                  <div>{t("buyback.colTx")}</div>
                  <div>{t("buyback.colWho")}</div>
                </div>
                <div
                  className={clsx(
                    "transition-opacity duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                    pending && "opacity-60"
                  )}
                >
                  {rows.map((row) => (
                    <BuybackRow key={`${row.tx}-${row.kind}`} row={row} locale={locale} t={t} />
                  ))}
                </div>
              </div>
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

function BuybackRow({
  row,
  locale,
  t,
}: {
  row: BuybackMove;
  locale: string;
  t: (key: string) => string;
}) {
  const ink = ACT_INK[row.kind];
  const name = whoLabel(row.who);
  return (
    <div className="addr-lane addr-lane-x buyback-lane border-t border-[var(--border-soft)] text-[13px]">
      <div className="tabular-nums">
        {row.blockId ? (
          <Link prefetch={false} href={`/block/${row.blockId}`} className="text-accent hover:underline">
            #{row.height.toLocaleString(loc(locale))}
          </Link>
        ) : (
          <span>#{row.height.toLocaleString(loc(locale))}</span>
        )}
      </div>
      <div className="truncate text-[var(--muted)]">
        {row.ts != null ? formatRelAge(row.ts, locale) : "—"}
      </div>
      <div className="truncate font-medium" style={{ color: ink }}>
        {t(`buyback.act.${row.kind}`)}
      </div>
      <div
        className={clsx(
          "buyback-num truncate",
          row.derg === "0"
            ? "text-[var(--muted)]"
            : row.derg.startsWith("-")
              ? "text-[var(--down)]"
              : "text-[var(--up)]"
        )}
      >
        {signedErg(row.derg, locale)}
      </div>
      <div
        className={clsx(
          "buyback-num truncate",
          row.dtok.startsWith("-") ? "text-[var(--down)]" : row.dtok === "0" ? "text-[var(--muted)]" : "text-[var(--up)]"
        )}
      >
        {signedToken(row.dtok, locale)}
      </div>
      <div className="buyback-num truncate">{formatErgPrecise(row.erg, locale, false)}</div>
      <div className="buyback-num truncate">{formatTokenAmount(row.token, 0, locale)}</div>
      <div className="truncate">
        <Link prefetch={false} href={`/tx/${row.tx}`} className="font-mono text-[12px] text-accent hover:underline">
          {shortId(row.tx, 10)}
        </Link>
      </div>
      <div className="min-w-0 truncate">
        {row.who ? (
          <Link
            prefetch={false}
            href={`/address/${row.who}`}
            className={clsx(
              "text-accent hover:underline",
              !lookupAddress(row.who)?.name && "font-mono text-[12px]"
            )}
            title={row.who}
          >
            {name || shortId(row.who, 10)}
          </Link>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        )}
      </div>
    </div>
  );
}
