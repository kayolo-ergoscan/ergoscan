"use client";

import { Tip } from "@/components/Tip";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import clsx from "clsx";
import {
  RENT_SERIES_DAY_MS,
  fillRentRangeGaps,
  rentNanoToErg,
  rentYearSpan,
  rollupRentSeries,
  type RentSeriesPoint,
} from "@ergoscan/shared";
import { Shell } from "@/components/Shell";
import { AddressPageSkeleton } from "@/components/AddressPageSkeleton";
import { AddrFactCard } from "@/components/AddrFactCard";
import { EvidenceBadge } from "@/components/EvidenceBadge";
import { KpiMark } from "@/components/kpi-marks";
import { compactFigure, KpiNum } from "@/components/KpiGrid";
import { RankWindow } from "@/components/RankWindow";
import {
  formatCompact,
  formatDottedDate,
  formatErg,
  formatErgFixed,
  formatGroupedNumber,
  shortId,
  toEpochMs,
} from "@/lib/format";
import type { RentChartPick } from "@/components/RentHistoryChart";
import { INK } from "@/lib/palette";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { countText } from "@/lib/i18n/messages";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";
import { ENTER_MS, SNAPSHOT_FETCH, enteringIds, useEnterIds } from "@/lib/keyed-enter";
import {
  Feed,
  FeedBoard,
  FeedCount,
  FeedDays,
  FeedEmpty,
  FeedPlate,
  FeedSection,
} from "@/components/feed/Feed";
import { FeedRentClaimRow, FeedRentDangerRow, FeedRentRow } from "@/components/feed/FeedRentRow";
import {
  RENT_PACK,
  type RentBoxRow,
  type RentDangerRow,
  type RentPageData,
  type RentWindow,
} from "@/lib/list-snapshots";
import { getGateway } from "@/lib/config";
import { lookupAddress } from "@/lib/address-book";
import { hasRentMinerRows, formatRentSharePct, rentShareOf } from "@/lib/rent-miner-pools";
import { RentMinerPools } from "@/components/RentMinerPools";

const ERG_LINE = "#5ee0a0";

const RentHistoryChart = dynamic(() => import("@/components/RentHistoryChart"), {
  ssr: false,
  loading: () => <div className="h-full min-h-[168px] w-full" />,
});


function fetchRentPack(params: URLSearchParams): Promise<RentPageData | null> {
  return fetch(`${getGateway()}/v1/page/rent?${params}`, SNAPSHOT_FETCH)
    .then(async (r) => (r.ok ? ((await r.json()) as RentPageData) : null))
    .catch(() => null);
}

function usePagerAfterRows(resetKey: string) {
  const endRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = endRef.current;
    if (!el) return;
    // Open once the list end is on screen. Do not close on a page change:
    // the first observation after Show more is already intersecting, and a
    // "must leave and come back" latch hid the button until the next scroll.
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setOpen(true);
      },
      { threshold: 0.85 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [resetKey]);
  return { endRef, open };
}

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function windowCovered(
  w: RentWindow,
  dueHeight: number,
  indexFloor: number | null
): boolean {
  if (indexFloor == null) return false;
  if (typeof w.inIndex === "boolean" && w.inIndex === false) return false;
  return dueHeight + Math.max(0, w.blocks) >= indexFloor;
}

function windowCaption(
  w: RentWindow,
  covered: boolean,
  minHeight: number | null,
  t: (k: string) => string,
  locale: string
): string {
  if (!covered) {
    const h = (minHeight ?? 0).toLocaleString(loc(locale));
    return t("rent.cap.belowIndex").replace("{h}", h);
  }
  const n = w.boxCount.toLocaleString(loc(locale));
  const held = formatErgFixed(w.valueNano, locale);
  return countText(t, locale, "rent.cap.withRent", w.boxCount, n).replace("{held}", held);
}

export function RentView({
  initial,
  pane = "upcoming",
}: {
  initial: RentPageData | null;
  pane?: "upcoming" | "history";
}) {
  const t = useT();
  const { locale } = useI18n();
  const { markSynced } = usePageSync();
  const [data, setData] = useState<RentPageData | null>(initial);
  const [offset, setOffset] = useState(0);
  /* The server sends the first upcoming page. With nothing due it is the page
     the client would build, so it paints in the first HTML. */
  const [seed] = useState<RentBoxRow[] | null>(() =>
    pane === "upcoming" && initial && (initial.due?.boxCount ?? 0) === 0 && initial.items.length
      ? initial.items.slice(0, RENT_PACK)
      : null
  );
  const [tape, setTape] = useState<RentBoxRow[] | null>(seed);
  const [claimOffset, setClaimOffset] = useState(0);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const enter = useEnterIds(ENTER_MS, seed ? seed.map((row) => row.boxId) : []);
  const packEnter = useEnterIds();
  const [listReady, setListReady] = useState(seed != null);
  const opened = useRef(false);
  const seq = useRef(0);
  const painted = useRef(false);
  const tapeRef = useRef<RentBoxRow[] | null>(seed);

  const load = useCallback(
    (silent = false, nextOff = offset, nextClaim = claimOffset) => {
      const id = ++seq.current;
      const shown = pane === "upcoming" ? (tapeRef.current?.length ?? 0) : (dataRef.current?.items.length ?? 0);
      if (!silent && shown > 0) setPending(true);
      const keepTokens = (prev: RentBoxRow[], next: RentBoxRow[]) => {
        const kept = new Map(
          prev
            .filter((row) => row.tokens && row.tokens.length > 0)
            .map((row) => [row.boxId, row.tokens] as const)
        );
        return next.map((row) =>
          row.tokens && row.tokens.length > 0
            ? row
            : kept.has(row.boxId)
              ? { ...row, tokens: kept.get(row.boxId) }
              : row
        );
      };
      const paint = (prev: RentBoxRow[], next: RentBoxRow[]) => {
        enter.mark(
          prev.length
            ? enteringIds(
                prev.map((row) => ({ id: row.boxId })),
                next.map((row) => ({ id: row.boxId }))
              )
            : next.map((row) => row.boxId)
        );
        return keepTokens(prev, next);
      };

      if (pane !== "upcoming") {
        const params = new URLSearchParams({
          tab: "upcoming",
          limit: String(RENT_PACK),
          offset: String(nextOff),
          claimOffset: String(nextClaim),
        });
        void fetchRentPack(params)
          .then((j) => {
            if (id !== seq.current) return;
            if (!j?.tipHeight) {
              if (!dataRef.current) setFailed(true);
              return;
            }
            const next = j.items ?? [];
            setData((prevData) => {
              const prev = prevData?.items ?? [];
              return { ...j, items: paint(prev, next) };
            });
            setFailed(false);
            markSynced();
          })
          .finally(() => {
            if (id === seq.current) setPending(false);
          });
        return;
      }

      const dueCount = dataRef.current?.due?.boxCount ?? 0;
      const dueTake = Math.min(RENT_PACK, Math.max(0, dueCount - nextOff));
      const aheadTake = RENT_PACK - dueTake;
      const aheadOff = Math.max(0, nextOff - dueCount);
      const aheadParams = new URLSearchParams({
        tab: "upcoming",
        limit: String(aheadTake > 0 ? aheadTake : 1),
        offset: String(aheadTake > 0 ? aheadOff : 0),
        claimOffset: String(nextClaim),
      });
      const dueParams = new URLSearchParams({
        tab: "due",
        limit: String(Math.max(dueTake, 1)),
        offset: String(nextOff),
      });
      void Promise.all([
        dueTake > 0 ? fetchRentPack(dueParams) : Promise.resolve(null),
        fetchRentPack(aheadParams),
      ])
        .then(([dueJ, aheadJ]) => {
          if (id !== seq.current) return;
          if (!aheadJ?.tipHeight) {
            if (!dataRef.current) setFailed(true);
            if (tapeRef.current == null) {
              tapeRef.current = [];
              setTape([]);
            }
            return;
          }
          const dueRows =
            dueTake > 0
              ? (dueJ?.items ?? [])
                  .filter((row) => dueJ?.tab === "due" || row.rentDue || row.blocksUntilRent <= 0)
                  .slice(0, dueTake)
              : [];
          const aheadRows = aheadTake > 0 ? (aheadJ.items ?? []).slice(0, aheadTake) : [];
          const next = [...dueRows, ...aheadRows];
          const merged = paint(tapeRef.current ?? [], next);
          tapeRef.current = merged;
          setTape(merged);
          const dueN = aheadJ.due?.boxCount ?? dueCount;
          const aheadN = aheadJ.next30d?.boxCount ?? 0;
          setData({
            ...aheadJ,
            items: merged,
            pagination: {
              offset: nextOff,
              limit: RENT_PACK,
              hasMore: nextOff + next.length < dueN + aheadN,
              total: dueN + aheadN,
            },
          });
          setFailed(false);
          markSynced();
        })
        .finally(() => {
          if (id === seq.current) setPending(false);
        });
    },
    [offset, claimOffset, enter.mark, markSynced, pane]
  );

  const loadRef = useRef(load);
  loadRef.current = load;
  const packKey = `${offset}:${claimOffset}`;
  const packSeen = useRef(packKey);

  useEffect(() => {
    if (painted.current) return;
    painted.current = true;
    if ((initial?.items.length ?? 0) > 0) markSynced();
    packSeen.current = packKey;
    loadRef.current(seed != null, 0, 0);
  }, [initial, markSynced, packKey, seed]);

  useEffect(() => {
    if (opened.current) return;
    if (!data) return;
    opened.current = true;
    if (seed) return;
    const ids = (data.items ?? []).map((row) => row.boxId);
    enter.mark(ids);
    if (ids.length) packEnter.mark(["pack"]);
    setListReady(true);
  }, [data, enter.mark, packEnter.mark, seed]);

  useEffect(() => {
    if (packSeen.current === packKey) return;
    packSeen.current = packKey;
    loadRef.current();
  }, [packKey]);

  useKeepFresh(() => {
    if (pane === "history") {
      markSynced();
      return;
    }
    loadRef.current(true);
  });


  const settled = data != null;
  const items = pane === "upcoming" ? (tape ?? []) : (data?.items ?? []);
  const historyPager = usePagerAfterRows(
    `${claimOffset}:${data?.collected?.recent?.length ?? 0}`
  );
  const upcomingPager = usePagerAfterRows(`${offset}:${items.length}`);
  const indexFloor =
    data != null ? (data.minHeight ?? data.oldestCreationHeight) : null;
  const fromLabel =
    indexFloor != null ? indexFloor.toLocaleString(loc(locale)) : null;
  return (
    <Shell>
      {!settled && !failed && <AddressPageSkeleton />}
      {failed && !settled && (
        <p className="text-amber-300">{t("rent.err")}</p>
      )}
      {settled && data && (
        <>
          <h1 className="sr-only">
            {t(pane === "history" ? "nav.rentHistory" : "nav.rentUpcoming")}
          </h1>
          {pane === "history" ? (
          <HistoryKpis collected={data.collected} locale={locale} t={t} />
          ) : (
          <div className="addr-lane">
            <RentWindowCard
              enter={1}
              label={t("rent.card.dueNow")}
              ink={INK.teal}
              mark={<KpiMark id="rent" />}
              window={data.due}
              covered={windowCovered(data.due, data.dueHeight, indexFloor)}
              minHeight={indexFloor}
              locale={locale}
              t={t}
            />
            <RentWindowCard
              enter={2}
              label={t("rent.card.soon24")}
              ink={INK.coral}
              mark={<KpiMark id="due-day" />}
              window={data.next24h}
              covered={windowCovered(data.next24h, data.dueHeight, indexFloor)}
              minHeight={indexFloor}
              locale={locale}
              t={t}
            />
            <RentWindowCard
              enter={3}
              label={t("rent.card.soon7")}
              ink={INK.gold}
              mark={<KpiMark id="due-week" />}
              window={data.next7d}
              covered={windowCovered(data.next7d, data.dueHeight, indexFloor)}
              minHeight={indexFloor}
              locale={locale}
              t={t}
            />
            <RentWindowCard
              enter={4}
              label={t("rent.card.soon30")}
              ink={INK.sky}
              mark={<KpiMark id="due-month" />}
              window={data.next30d}
              covered={windowCovered(data.next30d, data.dueHeight, indexFloor)}
              approx
              minHeight={indexFloor}
              locale={locale}
              t={t}
            />
          </div>
          )}

          {pane === "history" && (
          <>
          <p className="mt-3 hidden flex-wrap items-baseline gap-x-3 gap-y-1 px-1 text-[12px] leading-relaxed text-[var(--muted)] lg:flex">
            <EvidenceBadge kind="chain" />
            <span className="min-w-0 flex-1">{t("rent.evidence.body")}</span>
            <Link prefetch={false} href="/learn#evidence" className="shrink-0 text-[var(--accent)] hover:underline">
              {t("rent.evidence.method")}
            </Link>
          </p>

          <div
            className={clsx(
              "mt-2 grid min-w-0 items-stretch gap-2",
              (hasRentMinerRows(data.collected?.miners) ||
                hasRentMinerRows(data.collected?.minersDay) ||
                hasRentMinerRows(data.collected?.minersMonth)) &&
                "lg:grid-cols-2"
            )}
          >
            <RentCollectedChart
              enter={5}
              daily={data.collected?.daily}
              series={data.collected?.series}
              locale={locale}
              t={t}
            />
            {hasRentMinerRows(data.collected?.miners) ||
            hasRentMinerRows(data.collected?.minersDay) ||
            hasRentMinerRows(data.collected?.minersMonth) ? (
              <RentMinerPools
                sheet={6}
                miners={data.collected?.miners}
                minersDay={data.collected?.minersDay}
                minersMonth={data.collected?.minersMonth}
                totalRentNano={data.collected?.rentNano ?? "0"}
                locale={locale}
                t={t}
              />
            ) : null}
          </div>

          <div className="mt-2 min-w-0">
            <div className="feed-sheet">
            <Feed busy={pending}>
              {data.collected?.recent?.length ? (
                <FeedDays
                  items={data.collected.recent}
                  msOf={(row) => toEpochMs(row.spentTs)}
                  countOf={(n) => <FeedCount k="feed.claims" n={n} />}
                  render={(row, lead) => (
                    <FeedRentClaimRow key={row.boxId} row={row} lead={lead} enterClass={enter.enterClass(row.boxId)} />
                  )}
                />
              ) : (
                <FeedEmpty k="rent" title={t("rent.recentEmpty")} />
              )}
            </Feed>
            <div ref={historyPager.endRef} className="h-px w-full" aria-hidden />
            {historyPager.open &&
              ((data.collected?.recentTotal ?? 0) > RENT_PACK || claimOffset > 0) && (
              <RankWindow
                offset={claimOffset}
                pageSize={RENT_PACK}
                shown={data.collected?.recent?.length ?? 0}
                total={data.collected?.recentTotal ?? null}
                loc={loc(locale)}
                ofLabel={t("addresses.packOf")}
                prevLabel={t("rent.packPrev")}
                nextLabel={t("rent.packNext")}
                tapeLabel={t("rent.packTape")}
                hint={t("rent.claimsHint")}
                disabled={pending}
                onOffset={setClaimOffset}
              />
            )}
            </div>
          </div>
          </>
          )}

          {pane === "upcoming" && (
          <>
          <RentDanger rows={data.danger ?? []} settled t={t} />
          {listReady && (
          <div className="mt-2 min-w-0">
            <div className="feed-sheet">
              <Feed className="is-rank" busy={pending} enterClass={packEnter.enterClass("pack")}>
                {items.length ? (
                  <FeedBoard
                    plate={
                      <FeedPlate
                        tag={t("nav.rentUpcoming")}
                        now
                        count={<FeedCount k="feed.boxes" n={data.pagination.total ?? items.length} />}
                      />
                    }
                  >
                    {items.map((row, i) => (
                      <FeedRentRow
                        key={row.boxId}
                        row={row}
                        rank={offset + i + 1}
                        enterClass={enter.enterClass(row.boxId)}
                      />
                    ))}
                  </FeedBoard>
                ) : tape != null && !pending ? (
                  <FeedEmpty k="rent" title={t("rent.emptyTape")} plate={<FeedPlate tag={t("nav.rentUpcoming")} />} />
                ) : null}
              </Feed>
              <div ref={upcomingPager.endRef} className="h-px w-full" aria-hidden />
              {upcomingPager.open && (items.length > 0 || offset > 0) && (
                <RankWindow
                  offset={offset}
                  pageSize={RENT_PACK}
                  shown={items.length}
                  total={data.pagination.total}
                  loc={loc(locale)}
                  ofLabel={t("addresses.packOf")}
                  prevLabel={t("rent.packPrev")}
                  nextLabel={t("rent.packNext")}
                  tapeLabel={t("rent.packTape")}
                  hint={
                    fromLabel != null
                      ? `${t("rent.fromHeight")} #${fromLabel}. ${t("rent.packHint")}`
                      : t("rent.packHint")
                  }
                  disabled={pending}
                  onOffset={setOffset}
                />
              )}
            </div>
          </div>
          )}
          </>
          )}
        </>
      )}
    </Shell>
  );
}

function collectedCaption(
  collected: RentPageData["collected"],
  t: (k: string) => string,
  locale: string
): string {
  if (!collected) return t("rent.cap.collectedWait");
  return t("rent.cap.collected").replace(
    "{n}",
    collected.boxCount.toLocaleString(loc(locale))
  );
}

function toChartPts(rows: readonly RentSeriesPoint[]) {
  return rows.map((p) => ({
    t: p.t,
    boxes: p.boxes,
    rentErg: rentNanoToErg(p.rentNano),
  }));
}

function rentSeriesSig(rows?: readonly RentSeriesPoint[]) {
  return (rows ?? []).map((p) => `${p.t}:${p.boxes}:${p.rentNano}`).join("|");
}

function dropOpenDay(points: RentSeriesPoint[], now: number) {
  if (points.length < 2) return points;
  const last = points[points.length - 1]!;
  if (now < last.t + RENT_SERIES_DAY_MS) return points.slice(0, -1);
  return points;
}

function yearCaption(points: { t: number }[], locale: string): string | null {
  const span = rentYearSpan(points);
  if (!span) return null;
  if (span.lo === span.hi) return String(span.lo);
  return locale === "ru" ? `${span.lo}–${span.hi}` : `${span.lo} – ${span.hi}`;
}

const NO_AHEAD: RentSeriesPoint[] = [];
const NO_CHART_PTS: { t: number; boxes: number; rentErg: number }[] = [];

function RentCollectedChart({
  enter,
  daily,
  series,
  locale,
  t,
}: {
  enter?: number;
  daily?: RentSeriesPoint[];
  series?: RentSeriesPoint[];
  locale: string;
  t: (k: string) => string;
}) {
  const sourceKey = daily && daily.length >= 2 ? rentSeriesSig(daily) : rentSeriesSig(series);
  const past = useMemo(() => {
    const source = daily && daily.length >= 2 ? daily : series ?? [];
    const now = Date.now();
    const rolled = fillRentRangeGaps(rollupRentSeries(source, "day"), "day");
    return dropOpenDay(
      rolled.filter((p) => p.t <= now),
      now
    );
    // sourceKey is the closed daily bins; skip rebuild on a same-content tip bump.
  }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const pastPts = useMemo(() => toChartPts(past), [past]);
  const last = past.length ? past[past.length - 1] : null;
  const show = past.length >= 2;
  const years = yearCaption(past, locale);
  const lastErg = last ? rentNanoToErg(last.rentNano) : 0;
  /** Phone: the day a tap on the chart points at, shown where «yesterday» stands. */
  const [pick, setPick] = useState<RentChartPick | null>(null);
  return (
    <section
      className={clsx(
        "mod flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--module)] max-lg:min-h-[19.25rem] max-md:min-h-0",
        enter != null && "home-tile-enter"
      )}
      style={enter != null ? ({ "--enter": enter } as CSSProperties) : undefined}
    >
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] px-4 py-3 sm:px-5">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex h-[22px] min-w-0 items-center gap-3">
              <h2 className="m-0 text-[17px] font-semibold leading-[1.15] tracking-tight">
                {t("rent.chart")}
              </h2>
              <span className="truncate text-[13px] leading-[1.15] text-[var(--muted)]">
                {years ? `${years} · ` : ""}
                {t("rent.chartHint.day")}
                {` · ${t("rent.chartPan")}`}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-[var(--muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: ERG_LINE }} />
                {t("rent.chartErg")}
              </span>
              {NO_AHEAD.length > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-0 w-3 border-t-[1.5px] border-dashed"
                    style={{ borderColor: ERG_LINE }}
                  />
                  {t("rent.chartAhead")}
                </span>
              )}
            </div>
          </div>
          {pick ? (
            <p className="m-0 flex h-[22px] shrink-0 flex-nowrap items-center justify-end gap-1.5 whitespace-nowrap" aria-live="polite">
              <span className="font-mono text-[12px] leading-[1.15] text-[var(--muted)] tabular-nums">
                {formatDottedDate(pick.t, "UTC")}
                {` · ${t("rent.chartBoxes")} ${formatCompact(pick.boxes, 1, locale)}`}
                {pick.due ? ` · ${t("rent.chartAhead")}` : ""}
              </span>
              <KpiNum className="max-w-none shrink-0 tabular-nums text-[22px] font-semibold leading-[1.15] tracking-tight text-[var(--text)]">
                {`${formatGroupedNumber(pick.rentErg, 2, 2, locale)} ERG`}
              </KpiNum>
            </p>
          ) : last ? (
            <p className="m-0 flex h-[22px] shrink-0 flex-nowrap items-center justify-end gap-1.5 whitespace-nowrap">
              <span className="text-[12px] leading-[1.15] text-[var(--muted)]">
                {t("rent.chartLast.day")}
              </span>
              <KpiNum className="max-w-none shrink-0 tabular-nums text-[22px] font-semibold leading-[1.15] tracking-tight text-[var(--text)]">
                {`${formatGroupedNumber(lastErg, 2, 2, locale)} ERG`}
              </KpiNum>
            </p>
          ) : null}
        </div>
        {show ? (
          <div className="min-h-0 flex-1 max-lg:min-h-[168px] max-md:h-[160px] max-md:min-h-0 max-md:flex-none">
            <RentHistoryChart
              onPick={setPick}
              past={pastPts}
              ahead={NO_CHART_PTS}
              nameBoxes={t("rent.chartBoxes")}
              nameErg={t("rent.chartErg")}
              nameAhead={t("rent.chartAhead")}
              locale={loc(locale)}
              formatBoxes={(v) => formatCompact(v, 1)}
              formatErg={formatErg}
            />
          </div>
        ) : (
          <p className="flex flex-1 items-center justify-center text-[13px] text-[var(--muted)]">
            {t("rent.chartWarm")}
          </p>
        )}
      </div>
    </section>
  );
}

function historyLead(collected: RentPageData["collected"]): { value: string; hint: string } | null {
  const pools = collected?.miners?.pools ?? [];
  if (!collected?.rentNano || !pools.length) return null;
  const top = [...pools].sort((a, b) => {
    try {
      const d = BigInt(b.rentNano) - BigInt(a.rentNano);
      return d > 0n ? 1 : d < 0n ? -1 : 0;
    } catch {
      return 0;
    }
  })[0];
  if (!top) return null;
  return {
    value: formatRentSharePct(rentShareOf(top.rentNano, collected.rentNano)),
    hint: lookupAddress(top.address)?.name?.trim() || shortId(top.address, 10),
  };
}

function HistoryKpis({
  collected,
  locale,
  t,
}: {
  collected: RentPageData["collected"];
  locale: string;
  t: (k: string) => string;
}) {
  const show = Boolean(collected && collected.boxCount > 0);
  const lead = historyLead(collected);
  const claimers = collected?.miners?.claimerCount ?? collected?.miners?.pools.length ?? 0;
  return (
    <div className="addr-lane">
      <AddrFactCard
        enter={1}
        label={t("rent.card.collected")}
        ink={INK.green}
        mark={<KpiMark id="collected" />}
      >
        <div className="mt-0.5 leading-[1.15]">
          <KpiNum
            className="tabular-nums"
            compact={show && collected ? compactFigure(Number(collected.rentNano) / 1e9, "ERG") : undefined}
          >
            {show && collected ? formatErgFixed(collected.rentNano, locale) : "—"}
          </KpiNum>
        </div>
        <Tip content={t("rent.cap.collectedHint")}>
          <p className="mt-0.5 text-[12px] leading-[1.15] text-[var(--muted-2)]">
            {collectedCaption(collected, t, locale)}
          </p>
        </Tip>
      </AddrFactCard>
      <AddrFactCard
        enter={2}
        label={t("rent.kpi.claims")}
        ink={INK.coral}
        mark={<KpiMark id="claim" />}
      >
        <div className="mt-0.5 leading-[1.15]">
          <KpiNum className="tabular-nums" compact={show && collected ? compactFigure(collected.boxCount) : undefined}>
            {show && collected ? collected.boxCount.toLocaleString(loc(locale)) : "—"}
          </KpiNum>
        </div>
        <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
          {t("rent.kpi.claimsHint")}
        </p>
      </AddrFactCard>
      <AddrFactCard
        enter={3}
        label={t("rent.kpi.claimers")}
        ink={INK.teal}
        mark={<KpiMark id="miner" />}
      >
        <div className="mt-0.5 leading-[1.15]">
          <KpiNum className="tabular-nums" compact={compactFigure(claimers)}>
            {claimers > 0 ? claimers.toLocaleString(loc(locale)) : "—"}
          </KpiNum>
        </div>
        <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
          {t("rent.kpi.claimersHint")}
        </p>
      </AddrFactCard>
      <AddrFactCard
        enter={4}
        label={t("rent.kpi.lead")}
        ink={INK.gold}
        mark={<KpiMark id="leader" />}
      >
        <div className="mt-0.5 leading-[1.15]">
          <KpiNum className="tabular-nums">{lead?.value ?? "—"}</KpiNum>
        </div>
        <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
          {lead?.hint ?? t("rent.poolsEmpty.all")}
        </p>
      </AddrFactCard>
    </div>
  );
}

const DANGER_SHOWN = 5;

/** Tokens a short box loses to the collector: a feed section, five rows until opened. */
function RentDanger({
  rows,
  settled,
  t,
}: {
  rows: RentDangerRow[];
  settled: boolean;
  t: (k: string) => string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, DANGER_SHOWN);
  const plate = (
    <FeedPlate
      tag={t("rent.danger.title")}
      count={rows.length ? <FeedCount k="feed.tokens" n={rows.length} /> : undefined}
      end={
        rows.length > DANGER_SHOWN ? (
          <button type="button" className="feed-sort-chip" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? t("feed.showLess") : t("feed.showAll")}
          </button>
        ) : undefined
      }
    />
  );
  return (
    <div id="danger" className="feed-sheet mt-2 scroll-mt-24">
      <Feed className="is-rank">
        {rows.length ? (
          <FeedSection plate={plate}>
            {shown.map((row, i) => (
              <FeedRentDangerRow key={`${row.boxId}:${row.tokenId}`} row={row} rank={i + 1} />
            ))}
          </FeedSection>
        ) : settled ? (
          <FeedEmpty k="rent" title={t("rent.danger.empty")} plate={plate} />
        ) : null}
      </Feed>
      <p className="feed-note">{t("rent.danger.body")}</p>
    </div>
  );
}

function RentWindowCard({
  enter,
  approx = false,
  label,
  ink,
  mark,
  window: w,
  covered,
  minHeight,
  locale,
  t,
}: {
  enter?: number;
  /** «≈»: the 30-day window counts token bytes for its first 7 days only (~2 % low). */
  approx?: boolean;
  label: string;
  ink: string;
  mark: ReactNode;
  window: RentWindow;
  covered: boolean;
  minHeight: number | null;
  locale: string;
  t: (k: string) => string;
}) {
  const showValue = covered && w.boxCount > 0;
  return (
    <AddrFactCard enter={enter} label={label} ink={ink} mark={mark}>
      {/*
        Lead with the rent, not the ERG sitting in the boxes. On a page titled
        "Storage rent" the rent was the one number pushed into the caption,
        where it was also the part that got truncated.
      */}
      {showValue ? (
        <div className="mt-0.5 leading-[1.15]">
          <KpiNum className="tabular-nums">{`${approx ? "≈ " : ""}${formatErgFixed(w.rentNano, locale)}`}</KpiNum>
        </div>
      ) : (
        <p className="mt-0.5 text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight text-[var(--muted)]">
          <KpiNum>—</KpiNum>
        </p>
      )}
      <p className="mt-0.5 hidden text-[12px] leading-[1.15] text-[var(--muted-2)] lg:block">
        {windowCaption(w, covered, minHeight, t, locale)}
      </p>
    </AddrFactCard>
  );
}
