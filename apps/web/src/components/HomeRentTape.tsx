"use client";

/**
 * Home rent: crates ride a three-row snake. The miner stays on the last row and taps each box.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Tip, TipFigure, TipHead } from "./Tip";
import Link from "next/link";
import clsx from "clsx";
import { useReducedMotion } from "framer-motion";
import { KpiNum } from "@/components/KpiGrid";
import { ReelText } from "@/components/ReelText";
import { RentBelt } from "@/components/RentBelt";
import { TokenLogo } from "@/components/TokenBadge";
import { listPip } from "@/lib/address-pips";
import { formatErgFixed, formatErgPrecise, formatScaledGlance, formatUsd, shortId, toBigIntAmt } from "@/lib/format";
import { rentYardDemoPack, RENT_DEMO_MS } from "@/lib/rent-miner-patrol";
import { HOME, INK } from "@/lib/palette";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { countText } from "@/lib/i18n/messages";
import { dangerHoldingUsd, type RentDangerRow } from "@/lib/rent-danger";
import { resolveTokenMeta, tokenTickerInk } from "@/lib/token-meta";
import {
  rentTapeClock,
  rentTapeTone,
  type RentTapeRow,
} from "@ergoscan/shared";

/** Home yard shows eight crates. The snapshot may carry more. */
const HOME_YARD = 8;

function boxesLabel(n: number, t: (k: string) => string, locale: string): string {
  return countText(t, locale, "home.rentBoxes", n);
}

function whenLabel(blocksUntilRent: number, t: (k: string) => string): string {
  const clock = rentTapeClock(blocksUntilRent);
  return clock.due ? t("home.rentDue") : clock.label;
}

function toneColor(blocksUntilRent: number): string | undefined {
  const tone = rentTapeTone(blocksUntilRent);
  if (tone === "due") return INK.coral;
  if (tone === "soon") return INK.gold;
  return undefined;
}

export function HomeRentTape({
  rows,
  epochRentNano,
  danger = [],
  dangerReady = false,
  previewShare = false,
  enter = 0,
}: {
  rows: RentTapeRow[];
  epochRentNano?: string | null;
  danger?: RentDangerRow[];
  dangerReady?: boolean;
  previewShare?: boolean;
  enter?: number;
}) {
  const t = useT();
  const { locale } = useI18n();
  const loc = locale === "ru" ? "ru-RU" : "en-US";
  const reduce = useReducedMotion();
  const [demoTick, setDemoTick] = useState(0);
  const [hover, setHover] = useState<string | null>(null);
  const [lead, setLead] = useState<string | null>(null);

  const base = useMemo(() => rows.slice(0, HOME_YARD), [rows]);
  const pack = useMemo(
    () => (previewShare ? rentYardDemoPack(base, demoTick) : base),
    [base, previewShare, demoTick]
  );
  const rentLabel =
    epochRentNano != null && /^\d+$/.test(epochRentNano)
      ? formatErgPrecise(epochRentNano, loc)
      : null;
  const byAddr = useMemo(() => new Map(pack.map((r) => [r.address, r])), [pack]);
  const focus = hover ?? lead;
  const focusRow = focus ? byAddr.get(focus) : undefined;

  useEffect(() => {
    if (!previewShare || reduce) return;
    const kick = () => setDemoTick((n) => n + 1);
    const first = window.setTimeout(kick, 1100);
    const id = window.setInterval(kick, RENT_DEMO_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [previewShare, reduce]);

  return (
    <section
      className="home-tile-enter flex h-full min-h-0 min-w-0 flex-col max-lg:order-4 lg:h-full"
      style={{ "--enter": enter } as CSSProperties}
    >
      <article className="mod flex h-full min-h-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)]">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[20px] px-4 py-3 sm:px-5">
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
            <div className="flex min-h-0 min-w-0 flex-col">
              <div className="flex min-h-[38px] shrink-0 items-start justify-between gap-3">
                <h2 className="m-0 text-[13px] leading-none" style={{ color: HOME.forming }}>{t("rent.title")}</h2>
                <div className="min-w-0 text-right">
                  <p
                    className={clsx(
                      "m-0 text-[22px] font-semibold leading-none tabular-nums tracking-tight whitespace-nowrap",
                      !rentLabel && "text-[var(--muted)]"
                    )}
                    style={rentLabel ? { color: INK.coral } : undefined}
                  >
                    <ReelText text={rentLabel ?? "—"} />
                  </p>
                  <p className="mt-1 m-0 text-[11px] leading-[1.15] text-[var(--muted-2)]">
                    {t("home.rentEpochCollect")}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex min-h-[200px] min-w-0 flex-1 flex-col">
                <p
                  className="mb-2 flex h-[18px] min-w-0 items-center justify-center text-center text-[13px] leading-[18px] text-[var(--muted-2)]"
                  aria-live="polite"
                  data-rent-caption
                >
                  {pack.length === 0 ? (
                    t("home.rentEmpty")
                  ) : focusRow && focus ? (
                    <Link prefetch={false} href={`/address/${encodeURIComponent(focus)}`} className="rent-caption-link min-w-0 max-w-full">
                      <KpiNum key={focus} className="min-w-0 max-w-full">
                        <CaptionLine address={focus} row={focusRow} reduce={!!reduce} t={t} />
                      </KpiNum>
                    </Link>
                  ) : null}
                </p>
                <div className="relative min-h-0 flex-1" aria-label={t("home.rentAisle")}>
                  <RentBelt
                    rows={pack}
                    reduce={!!reduce}
                    hover={hover}
                    onHover={setHover}
                    onLead={setLead}
                    formatAmount={(nano) => formatErgFixed(nano, loc)}
                  />
                </div>
              </div>
            </div>

            <DangerReel rows={danger} ready={dangerReady} locale={loc} reduce={!!reduce} t={t} />
          </div>

          <div className="mt-auto flex items-baseline justify-between gap-3 pt-3">
            <Link prefetch={false} href="/rent" className="text-[13px] text-[var(--muted)] hover:text-[var(--text)]">
              {t("home.viewAll")}
            </Link>
          </div>
        </div>
      </article>
    </section>
  );
}

function DangerReel({
  rows,
  ready,
  locale,
  reduce,
  t,
}: {
  rows: RentDangerRow[];
  ready: boolean;
  locale: string;
  reduce: boolean;
  t: (k: string) => string;
}) {
  const viewRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const [loop, setLoop] = useState(false);

  useLayoutEffect(() => {
    const view = viewRef.current;
    const copy = copyRef.current;
    if (!view || !copy) return;
    const measure = () => {
      setLoop(!reduce && rows.length > 1 && copy.offsetHeight > view.clientHeight + 4);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(view);
    return () => ro.disconnect();
  }, [reduce, rows]);

  const reel = rows.length ? `${Math.max(16, rows.length * 1.9)}s` : undefined;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <h2 className="m-0 shrink-0 text-[13px] leading-none" style={{ color: HOME.forming }}>
        {t("rent.danger.title")}
      </h2>
      {rows.length === 0 ? (
        ready ? (
          <p className="mt-3 text-[13px] leading-snug text-[var(--muted)]">{t("home.rentDangerEmpty")}</p>
        ) : (
          <div className="mt-3 h-[220px]" />
        )
      ) : (
        <div
          ref={viewRef}
          className={clsx(
            "rent-danger-well mt-3 h-[220px] overflow-hidden sm:h-auto sm:min-h-0 sm:flex-1",
            loop && "is-loop"
          )}
          aria-label={t("rent.danger.title")}
        >
          <div
            className={clsx(loop && "rent-danger-run")}
            style={reel ? ({ "--reel": reel } as CSSProperties) : undefined}
          >
            <div ref={copyRef}>
              {rows.map((row) => (
                <DangerLine key={`${row.boxId}:${row.tokenId}`} row={row} locale={locale} />
              ))}
            </div>
            {loop ? (
              <div aria-hidden inert>
                {rows.map((row) => (
                  <DangerLine key={`copy:${row.boxId}:${row.tokenId}`} row={row} locale={locale} />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function DangerLine({ row, locale }: { row: RentDangerRow; locale: string }) {
  const meta = resolveTokenMeta(row.tokenId, null, row.name);
  const glance = formatScaledGlance(toBigIntAmt(row.amount), row.decimals ?? 0, locale);
  const usd = dangerHoldingUsd(row);
  return (
    <Tip
      tap={false}
      content={() => (
        <>
          <TipHead chip={meta.symbol} ink="var(--c-token, #5b8dff)">
            {meta.name && meta.name !== meta.symbol ? meta.name : null}
          </TipHead>
          <TipFigure>{glance.exact}</TipFigure>
        </>
      )}
    >
    <Link
      prefetch={false}
      href={`/token/${row.tokenId}`}
      className="grid h-8 grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 rounded-[8px] px-1 hover:bg-[var(--wash)]"
    >
      <TokenLogo tokenId={row.tokenId} size={18} />
      <span
        className="min-w-0 truncate text-[13px] font-medium tracking-[-0.02em]"
        style={{ color: tokenTickerInk(row.tokenId) }}
      >
        {meta.symbol}
      </span>
      <span className="flex items-baseline gap-2.5 text-[13px] tabular-nums">
        <span className="text-[var(--muted)]">{glance.text}</span>
        <span className="font-semibold" style={{ color: usd > 0 ? "var(--down)" : "var(--muted)" }}>
          {usd > 0 ? formatUsd(usd) : "—"}
        </span>
      </span>
    </Link>
    </Tip>
  );
}

function useTyped(text: string, reduce: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!text) {
      setN(0);
      return;
    }
    if (reduce) {
      setN(text.length);
      return;
    }
    setN(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setN(Math.min(text.length, i));
      if (i >= text.length) window.clearInterval(id);
    }, 58);
    return () => window.clearInterval(id);
  }, [text, reduce]);
  return text.slice(0, n);
}

function CaptionLine({
  address,
  row,
  reduce,
  t,
}: {
  address: string;
  row: RentTapeRow;
  reduce: boolean;
  t: (k: string) => string;
}) {
  const { locale } = useI18n();
  const meta = listPip(address, row.valueNano);
  const named = Boolean(meta.name);
  const label = meta.name || shortId(address, 10);
  const typed = useTyped(label, reduce);
  const done = label.length > 0 && typed.length >= label.length;
  const ink = toneColor(row.blocksUntilRent);
  return (
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-1.5">
      <span className={clsx("inline-flex min-w-0 items-baseline text-[var(--text)]", !named && "font-mono")}>
        <span className="min-w-0 truncate">{typed}</span>
        {done ? null : <span className="type-caret" />}
      </span>
      {done ? (
        <>
          <span className="shrink-0 text-[var(--muted-2)]">·</span>
          <span className={clsx("shrink-0 tabular-nums", !ink && "text-[var(--muted)]")} style={ink ? { color: ink } : undefined}>
            {whenLabel(row.blocksUntilRent, t)}
          </span>
          <span className="shrink-0 text-[var(--muted-2)]">·</span>
          <span className="shrink-0 tabular-nums">{boxesLabel(row.boxCount, t, locale)}</span>
        </>
      ) : null}
    </span>
  );
}
