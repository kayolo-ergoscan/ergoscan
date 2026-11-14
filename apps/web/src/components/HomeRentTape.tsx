"use client";

/**
 * Home rent: two tiles in one grid slot, one thought each.
 * «Rent this epoch» keeps the crate yard and the miner, says how much and from how many
 * boxes, and signs the address the miner is at. «Tokens at risk» lists tokens sitting in
 * boxes that hold less ERG than the rent, one row per token, soonest first.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Tip, TipFigure, TipHead, TipNote } from "./Tip";
import Link from "next/link";
import clsx from "clsx";
import { useReducedMotion } from "framer-motion";
import { KpiNum } from "@/components/KpiGrid";
import { ReelText } from "@/components/ReelText";
import { RentBelt } from "@/components/RentBelt";
import { TokenLogo } from "@/components/TokenBadge";
import { listPip } from "@/lib/address-pips";
import { formatErgFixed, formatScaledGlance, formatUsd, shortId } from "@/lib/format";
import { rentYardDemoPack, RENT_DEMO_MS } from "@/lib/rent-miner-patrol";
import { HOME, INK_TEXT } from "@/lib/palette";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { countText } from "@/lib/i18n/messages";
import { groupRentDanger, type RentDangerGroup, type RentDangerRow } from "@/lib/rent-danger";
import { resolveTokenMeta } from "@/lib/token-meta";
import {
  headerEpochBlocksLeft,
  rentTapeClock,
  rentTapeTone,
  type RentTapeRow,
} from "@ergoscan/shared";

/** Home yard shows eight crates. The snapshot may carry more. */
const HOME_YARD = 8;
/** The clock counts two minutes a block. */
const CLOCK_BLOCK_MS = 120_000;
/** One token row. The desktop tile fits as many as its height allows. */
const DANGER_ROW_PX = 26;
/** Below the desktop grid the tile grows with its list, so cap it. */
const DANGER_STACK_ROWS = 8;

type T = (k: string) => string;

function clockText(blocks: number, t: T): string {
  const clock = rentTapeClock(blocks);
  if (clock.due) return t("home.rentDue");
  return t(`rent.clock.${clock.unit}`).replace("{n}", String(clock.n));
}

function whenText(blocks: number, t: T): string {
  const clock = rentTapeClock(blocks);
  return clock.due ? t("home.rentDue") : t("home.rentIn").replace("{t}", clockText(blocks, t));
}

function toneColor(blocksUntilRent: number): string | undefined {
  const tone = rentTapeTone(blocksUntilRent);
  if (tone === "due") return INK_TEXT.coral;
  if (tone === "soon") return INK_TEXT.gold;
  return undefined;
}

function countLabel(t: T, locale: string, key: string, n: number): string {
  return countText(t, locale, key, n, n.toLocaleString(locale === "ru" ? "ru-RU" : "en-US"));
}

function usdText(usd: number): string {
  if (usd >= 0.01) return formatUsd(usd);
  if (usd > 0) return "<$0.01";
  return "—";
}

export function HomeRentTape({
  rows,
  epochRentNano,
  epochBoxes = null,
  height = null,
  avgBlockMs = null,
  danger = [],
  dangerReady = false,
  previewShare = false,
  enter = 0,
}: {
  rows: RentTapeRow[];
  epochRentNano?: string | null;
  /** Boxes that turn four years old before this header epoch ends. */
  epochBoxes?: number | null;
  height?: number | null;
  avgBlockMs?: number | null;
  danger?: RentDangerRow[];
  dangerReady?: boolean;
  previewShare?: boolean;
  enter?: number;
}) {
  return (
    <section
      className="home-tile-enter grid h-full min-h-0 min-w-0 grid-cols-1 gap-2 max-lg:order-4 sm:grid-cols-2 lg:h-full"
      style={{ "--enter": enter } as CSSProperties}
    >
      <RentEpochTile
        rows={rows}
        epochRentNano={epochRentNano}
        epochBoxes={epochBoxes}
        height={height}
        avgBlockMs={avgBlockMs}
        previewShare={previewShare}
      />
      <DangerTile rows={danger} ready={dangerReady} />
    </section>
  );
}

function RentEpochTile({
  rows,
  epochRentNano,
  epochBoxes,
  height,
  avgBlockMs,
  previewShare,
}: {
  rows: RentTapeRow[];
  epochRentNano?: string | null;
  epochBoxes: number | null;
  height: number | null;
  avgBlockMs: number | null;
  previewShare: boolean;
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
    epochRentNano != null && /^\d+$/.test(epochRentNano) ? formatErgFixed(epochRentNano, loc) : null;
  const byAddr = useMemo(() => new Map(pack.map((r) => [r.address, r])), [pack]);
  const focus = hover ?? lead ?? pack[0]?.address ?? null;
  const focusRow = focus ? byAddr.get(focus) : undefined;

  let leftLabel: string | null = null;
  if (height != null && height >= 0) {
    const blockMs = avgBlockMs && avgBlockMs > 0 ? avgBlockMs : CLOCK_BLOCK_MS;
    const left = Math.max(1, Math.round((headerEpochBlocksLeft(height) * blockMs) / CLOCK_BLOCK_MS));
    leftLabel = t("home.rentEpochLeftShort").replace("{t}", clockText(left, t));
  }

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
    <article className="mod flex h-full min-h-0 min-w-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)]">
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[20px] px-4 py-3">
        <div className="flex min-h-[22px] shrink-0 items-center justify-between gap-3">
          <h2 className="m-0 shrink-0 whitespace-nowrap text-[13px] leading-none" style={{ color: HOME.forming }}>
            {t("home.rentEpochTitle")}
          </h2>
          {leftLabel ? (
            <span className="min-w-0 truncate text-[12px] tabular-nums text-[var(--muted-2)]">{leftLabel}</span>
          ) : null}
        </div>

        <div className="mt-2.5 shrink-0">
          <p className="m-0 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 leading-none">
            {rentLabel ? (
              <span className="text-[15px] font-medium text-[var(--muted-2)]">{t("home.rentUpTo")}</span>
            ) : null}
            <span
              className={clsx(
                "whitespace-nowrap text-[26px] font-semibold tabular-nums tracking-tight lg:max-xl:text-[20px]",
                !rentLabel && "text-[var(--muted)]"
              )}
              style={rentLabel ? { color: INK_TEXT.coral } : undefined}
            >
              <ReelText text={rentLabel ?? "—"} />
            </span>
          </p>
          {epochBoxes != null && epochBoxes > 0 ? (
            <p className="m-0 mt-1.5 text-[12px] leading-[1.3] text-[var(--muted-2)]">
              {t("home.rentEpochFrom").replace("{boxes}", countLabel(t, locale, "home.rentFromBoxes", epochBoxes))}
            </p>
          ) : null}
        </div>

        <div className="mt-2 flex min-h-[176px] min-w-0 flex-1 flex-col sm:min-h-[120px]">
          {pack.length === 0 ? (
            <p className="m-0 flex flex-1 items-center justify-center text-[13px] text-[var(--muted-2)]">
              {t("home.rentEmpty")}
            </p>
          ) : (
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
          )}
        </div>

        {focus && focusRow ? (
          <QueueLine key={focus} address={focus} row={focusRow} reduce={!!reduce} />
        ) : null}

        <div className="mt-2 flex shrink-0 items-baseline">
          <Link prefetch={false} href="/rent" className="text-[13px] text-[var(--muted)] hover:text-[var(--text)]">
            {t("home.rentAll")}
          </Link>
        </div>
      </div>
    </article>
  );
}

function DangerTile({ rows, ready }: { rows: RentDangerRow[]; ready: boolean }) {
  const t = useT();
  const { locale } = useI18n();
  const loc = locale === "ru" ? "ru-RU" : "en-US";
  const groups = useMemo(() => groupRentDanger(rows), [rows]);
  const total = useMemo(() => groups.reduce((sum, g) => sum + g.usd, 0), [groups]);
  const listRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(DANGER_STACK_ROWS);
  const hasRows = groups.length > 0;

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    const measure = () => {
      setFit(wide.matches ? Math.max(1, Math.floor(el.clientHeight / DANGER_ROW_PX)) : DANGER_STACK_ROWS);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    wide.addEventListener("change", measure);
    return () => {
      ro.disconnect();
      wide.removeEventListener("change", measure);
    };
  }, [hasRows]);

  const boxes = rows.length;

  return (
    <article
      className="mod flex h-full min-h-0 min-w-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)]"
      style={{ "--tag": "var(--f-token)" } as CSSProperties}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[20px] px-4 py-3">
        <div className="flex min-h-[22px] shrink-0 items-center justify-between gap-3">
          <h2 className="m-0 shrink-0 whitespace-nowrap text-[13px] leading-none" style={{ color: HOME.forming }}>
            {t("home.dangerTitle")}
          </h2>
          <span className="min-w-0 truncate text-[12px] tabular-nums text-[var(--muted-2)]">
            {t("home.dangerWindow")}
          </span>
        </div>

        {groups.length === 0 ? (
          ready ? (
            <p className="m-0 mt-3 text-[13px] leading-snug text-[var(--muted)]">{t("home.rentDangerEmpty")}</p>
          ) : (
            <div className="min-h-[220px] flex-1" />
          )
        ) : (
          <>
            <div className="mt-2.5 shrink-0">
              <p className="m-0 text-[26px] font-semibold leading-none tabular-nums tracking-tight text-[var(--text)] lg:max-xl:text-[20px]">
                {total > 0 ? `≈ ${usdText(total)}` : countLabel(t, locale, "home.rentBoxes", boxes)}
              </p>
              <p className="m-0 mt-1.5 text-[12px] leading-[1.3] text-[var(--muted-2)]">
                {t("home.dangerWhy").replace("{boxes}", countLabel(t, locale, "home.dangerInBoxes", boxes))}
              </p>
            </div>

            <div className="mt-2 grid h-[18px] shrink-0 grid-cols-[minmax(0,1fr)_3.75rem_2.75rem] lg:max-xl:grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-2 px-1 text-[11px] text-[var(--muted-2)]">
              <span>{t("home.dangerColToken")}</span>
              <span className="text-right lg:max-xl:hidden">≈ $</span>
              <span className="text-right">{t("home.dangerColWhen")}</span>
            </div>
            <div
              ref={listRef}
              className="min-h-0 shrink-0 divide-y divide-[var(--border-soft)] overflow-hidden lg:flex-1"
              aria-label={t("home.dangerTitle")}
            >
              {groups.slice(0, fit).map((g) => (
                <DangerRow key={g.tokenId} group={g} loc={loc} locale={locale} t={t} />
              ))}
            </div>
          </>
        )}

        <div className="mt-auto flex shrink-0 items-baseline pt-2">
          <Link
            prefetch={false}
            href="/rent#danger"
            className="text-[13px] text-[var(--muted)] hover:text-[var(--text)]"
          >
            {boxes > 0
              ? t("home.dangerAll").replace("{boxes}", countLabel(t, locale, "home.rentBoxes", boxes))
              : t("home.rentAll")}
          </Link>
        </div>
      </div>
    </article>
  );
}

function DangerRow({ group, loc, locale, t }: { group: RentDangerGroup; loc: string; locale: string; t: T }) {
  const meta = resolveTokenMeta(group.tokenId, group.name, group.name);
  const glance = formatScaledGlance(group.amount, group.decimals ?? 0, loc);
  const ink = toneColor(group.soonest);
  return (
    <Tip
      tap={false}
      content={() => (
        <>
          <TipHead chip={meta.symbol} ink="var(--c-token, #5b8dff)">
            {meta.name && meta.name !== meta.symbol ? meta.name : null}
          </TipHead>
          <TipFigure>{glance.exact}</TipFigure>
          <TipNote>{countLabel(t, locale, "home.rentBoxes", group.boxes)}</TipNote>
        </>
      )}
    >
    <Link
      prefetch={false}
      href={`/token/${group.tokenId}`}
      className="grid h-[26px] grid-cols-[minmax(0,1fr)_3.75rem_2.75rem] lg:max-xl:grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-2 rounded-[6px] px-1 text-[13px] hover:bg-[var(--wash)]"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <TokenLogo tokenId={group.tokenId} size={16} />
        <span className="min-w-0 truncate font-medium tracking-[-0.02em]">{meta.symbol}</span>
        {group.boxes > 1 ? (
          <span className="shrink-0 text-[11px] tabular-nums text-[var(--muted-2)]">×{group.boxes}</span>
        ) : null}
      </span>
      <span className="text-right tabular-nums text-[var(--text)] lg:max-xl:hidden">{usdText(group.usd)}</span>
      <span
        className={clsx("whitespace-nowrap text-right tabular-nums", !ink && "text-[var(--muted)]")}
        style={ink ? { color: ink } : undefined}
      >
        {group.soonest <= 0 ? t("home.dangerNow") : clockText(group.soonest, t)}
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

/** The address the miner is at, signed: who, when, how many boxes, and the rent it floats. */
function QueueLine({ address, row, reduce }: { address: string; row: RentTapeRow; reduce: boolean }) {
  const t = useT();
  const { locale } = useI18n();
  const loc = locale === "ru" ? "ru-RU" : "en-US";
  const meta = listPip(address, row.valueNano);
  const named = Boolean(meta.name);
  const label = meta.name || shortId(address, 6);
  const typed = useTyped(label, reduce);
  const done = label.length > 0 && typed.length >= label.length;
  const ink = toneColor(row.blocksUntilRent);
  const [feePre, feePost = ""] = t("home.rentFee").split("{n}");
  return (
    <div className="mt-2 shrink-0 text-[12px] leading-[1.35]" aria-live="polite" data-rent-caption>
      <p className="m-0 flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 text-[var(--muted-2)]">{t("home.rentQueue")}</span>
        <Link
          prefetch={false}
          href={`/address/${encodeURIComponent(address)}`}
          className={clsx("inline-flex min-w-0 items-baseline", !named && "font-mono")}
        >
          <span className="min-w-0 truncate">{typed}</span>
          {done ? null : <span className="type-caret" />}
        </Link>
      </p>
      <KpiNum className="mt-0.5 min-w-0">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 tabular-nums text-[var(--muted)]">
          <span style={ink ? { color: ink } : undefined}>{whenText(row.blocksUntilRent, t)}</span>
          <span className="text-[var(--muted-2)]">·</span>
          <span>{countLabel(t, locale, "home.rentBoxes", row.boxCount)}</span>
          <span className="text-[var(--muted-2)]">·</span>
          <span>
            {feePre}
            <span style={{ color: INK_TEXT.coral }}>{formatErgFixed(row.rentNano, loc)}</span>
            {feePost}
          </span>
        </span>
      </KpiNum>
    </div>
  );
}
