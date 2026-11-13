"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import { compactFigure, KpiGrid } from "@/components/KpiGrid";
import { KpiMark } from "@/components/kpi-marks";
import { TokenAvatar } from "@/components/TokenBadge";
import { RankWindow } from "@/components/RankWindow";
import { INK } from "@/lib/palette";
import { formatCompact, formatErg, formatGroupedNumber, shortId } from "@/lib/format";
import { resolveTokenMeta, tokenTickerInk } from "@/lib/token-meta";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";
import { ENTER_MS, SNAPSHOT_FETCH, enteringIds, useEnterIds } from "@/lib/keyed-enter";
import { Feed, FeedBoard, FeedCount, FeedEmpty, FeedPlate } from "@/components/feed/Feed";
import { FeedSwapTape, FeedTraderRow, swapEventId } from "@/components/feed/FeedSwapRow";
import { getGateway } from "@/lib/config";
import { LITHOS_LINKS } from "@/lib/lithos-links";
import {
  VOL_RANGES,
  fillVolumeGaps,
  volRangeById,
  type DefiVolPoint,
  type VolRangeId,
} from "@/lib/defi-volume";
import { isErgBase, sortDefiPoolsByTvl, type DefiPool } from "@/lib/defi-pools";
import type { LithosDexSnap } from "@/lib/list-snapshots";

const DualLineChart = dynamic(() => import("@/components/DualLineChart"), {
  ssr: false,
  loading: () => <div className="h-[168px] w-full" />,
});

const VOL_LINE = "#86a6f0";
const SWAP_LINE = "#e799b7";
const TAPE_PACK = 25;

type TapeSort = "time" | "ticker" | "amount";
type TapeDir = "asc" | "desc";

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}


function fmtErgFull(n: number, locale?: string): string {
  if (!Number.isFinite(n)) return "—";
  return `${formatGroupedNumber(n, 2, 2, locale)} ERG`;
}

function poolLabel(p: DefiPool): string {
  const meta = resolveTokenMeta(p.tokenId, p.symbol);
  const sym = meta?.symbol || p.symbol || shortId(p.tokenId, 4);
  if (isErgBase(p.baseId, p.baseSymbol)) return `${sym}/ERG`;
  return `${sym}/${p.baseSymbol || shortId(p.baseId || "", 4)}`;
}

export function LithosView({
  initial,
  initialVolume = [],
}: {
  initial: LithosDexSnap | null;
  initialVolume?: DefiVolPoint[];
}) {
  const t = useT();
  const { locale } = useI18n();
  const { markSynced } = usePageSync();
  const miss = t("home.unavailable");
  const [snap, setSnap] = useState<LithosDexSnap | null>(initial);
  const [sort, setSort] = useState<TapeSort>("time");
  const [dir, setDir] = useState<TapeDir>("desc");
  const [eventsOffset, setEventsOffset] = useState(0);
  const [tradersOffset, setTradersOffset] = useState(0);
  const [pending, setPending] = useState(false);
  const [rangeId, setRangeId] = useState<VolRangeId>("7d");
  const [volRows, setVolRows] = useState<DefiVolPoint[]>(initialVolume);
  const [shownRange, setShownRange] = useState<VolRangeId>("7d");
  const [, setChartPending] = useState(false);
  const volCache = useRef<Partial<Record<VolRangeId, DefiVolPoint[]>>>({
    "7d": initialVolume,
  });
  const rangeIdRef = useRef(rangeId);
  rangeIdRef.current = rangeId;
  // Rows the server already has go into the first HTML, with the same entry animation.
  const seedEvents = (initial?.events ?? []).map((row) => swapEventId(row));
  const seedTraders = (initial?.topTraders ?? []).map((row) => row.trader);
  const seeded = seedEvents.length > 0 || seedTraders.length > 0;
  const eventsEnter = useEnterIds(ENTER_MS, seedEvents);
  const eventsPack = useEnterIds(ENTER_MS, seedEvents.length ? ["pack"] : []);
  const tradersEnter = useEnterIds(ENTER_MS, seedTraders);
  const tradersPack = useEnterIds(ENTER_MS, seedTraders.length ? ["pack"] : []);
  const [listReady, setListReady] = useState(seeded);
  const opened = useRef(seeded);
  const eventsPrev = useRef<{ id: string }[]>(seedEvents.map((id) => ({ id })));
  const tradersPrev = useRef<{ id: string }[]>(seedTraders.map((id) => ({ id })));

  const pull = useCallback(async (silent = false) => {
    try {
      const qs = new URLSearchParams({
        limit: String(TAPE_PACK),
        eventsOffset: String(eventsOffset),
        tradersOffset: String(tradersOffset),
        eventsSort: sort,
        eventsDir: dir,
      });
      const r = await fetch(`${getGateway()}/v1/defi/lithos?${qs}`, SNAPSHOT_FETCH);
      if (!r.ok) return;
      const next = (await r.json()) as LithosDexSnap;
      if (opened.current) {
        const events = (next.events ?? []).map((row) => ({ id: swapEventId(row) }));
        const traders = (next.topTraders ?? []).map((row) => ({ id: row.trader }));
        const freshEvents = enteringIds(eventsPrev.current, events);
        const freshTraders = enteringIds(tradersPrev.current, traders);
        eventsEnter.mark(freshEvents);
        tradersEnter.mark(freshTraders);
        if (!silent && freshEvents.length) eventsPack.mark(["pack"]);
        if (!silent && freshTraders.length) tradersPack.mark(["pack"]);
        eventsPrev.current = events;
        tradersPrev.current = traders;
      }
      setSnap(next);
    } catch {
      /* keep */
    } finally {
      markSynced();
      setPending(false);
    }
  }, [
    dir,
    eventsEnter.mark,
    eventsOffset,
    eventsPack.mark,
    markSynced,
    sort,
    tradersEnter.mark,
    tradersOffset,
    tradersPack.mark,
  ]);
  useKeepFresh(pull);

  const loadVol = useCallback(
    (silent = false) => {
      const want = rangeId;
      const cached = volCache.current[want];
      if (cached) {
        setVolRows(cached);
        setShownRange(want);
      } else if (!silent) {
        setChartPending(true);
      }
      const r = volRangeById(want);
      const qs = new URLSearchParams({ days: String(r.days), venue: "lithos_dex" });
      void fetch(`${getGateway()}/v1/defi/volume-history?${qs}`, SNAPSHOT_FETCH)
        .then(async (res) => {
          if (!res.ok) {
            if (volCache.current[want] === undefined) volCache.current[want] = [];
            if (rangeIdRef.current === want) {
              setVolRows(volCache.current[want] ?? []);
              setShownRange(want);
            }
            return;
          }
          const j = (await res.json()) as { points?: DefiVolPoint[]; venue?: string | null };
          if (!Array.isArray(j.points)) return;
          const venue = String(j.venue || "").toLowerCase();
          const ok = venue === "lithos_dex" || venue === "lithos";
          const points = ok ? j.points : [];
          volCache.current[want] = points;
          if (rangeIdRef.current !== want) return;
          setVolRows(points);
          setShownRange(want);
        })
        .finally(() => {
          if (rangeIdRef.current === want) setChartPending(false);
        });
    },
    [rangeId]
  );

  const skipFirst = useRef(true);
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    setPending(true);
    void pull();
  }, [pull]);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    const events = (snap?.events ?? []).map((row) => ({ id: swapEventId(row) }));
    const traders = (snap?.topTraders ?? []).map((row) => ({ id: row.trader }));
    eventsPrev.current = events;
    tradersPrev.current = traders;
    eventsEnter.mark(events.map((row) => row.id));
    tradersEnter.mark(traders.map((row) => row.id));
    if (events.length) eventsPack.mark(["pack"]);
    if (traders.length) tradersPack.mark(["pack"]);
    setListReady(true);
  }, [eventsEnter.mark, eventsPack.mark, snap, tradersEnter.mark, tradersPack.mark]);

  const rangeSeen = useRef(rangeId);
  useEffect(() => {
    const silent = rangeSeen.current === rangeId;
    rangeSeen.current = rangeId;
    loadVol(silent);
  }, [loadVol, rangeId]);

  const range = volRangeById(shownRange);
  const volSeries = useMemo(
    () => fillVolumeGaps(volRows, range.days, range.binMs),
    [volRows, range.days, range.binMs]
  );
  const volPts = useMemo(
    () => volSeries.map((p) => ({ t: p.t, txs: p.volErg, feesErg: p.swaps })),
    [volSeries]
  );
  const showVolChart = volPts.length >= 2 && volPts.some((p) => p.txs > 0 || p.feesErg > 0);

  const rows = snap?.events ?? [];
  const topTraders = snap?.topTraders ?? [];
  const pools = sortDefiPoolsByTvl(snap?.pools ?? []);
  const tvl = snap?.tvlErg != null && Number.isFinite(snap.tvlErg) ? snap.tvlErg : null;
  const vol = snap?.volErg != null && Number.isFinite(snap.volErg) ? snap.volErg : null;

  const onSort = (k: TapeSort) => {
    if (sort === k) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(k);
      setDir(k === "time" || k === "amount" ? "desc" : "asc");
    }
    setEventsOffset(0);
  };

  const kpis = [
    {
      label: t("lithos.tvl"),
      value: tvl != null && tvl > 0 ? fmtErgFull(tvl, locale) : miss,
      compact: compactFigure(tvl, "ERG"),
      unavailable: tvl == null || tvl <= 0,
      sub: t("lithos.tvlSub"),
      mark: <KpiMark id="pool" tone={INK.gold} />,
      ink: INK.gold,
      enter: 0,
    },
    {
      label: t("lithos.volume"),
      value: vol != null && vol > 0 ? fmtErgFull(vol, locale) : miss,
      compact: compactFigure(vol, "ERG"),
      unavailable: vol == null || vol <= 0,
      sub: t("lithos.volumeSub"),
      mark: <KpiMark id="volume" tone={INK.cyan} />,
      ink: INK.cyan,
      enter: 1,
    },
    {
      label: t("lithos.traders"),
      value:
        snap?.tradersCount != null ? snap.tradersCount.toLocaleString(loc(locale)) : miss,
      compact: compactFigure(snap?.tradersCount),
      unavailable: snap?.tradersCount == null,
      sub: t("lithos.tradersSub"),
      mark: <KpiMark id="trader" tone={INK.violet} />,
      ink: INK.violet,
      enter: 2,
    },
    {
      label: t("lithos.trades"),
      value:
        snap?.tradesCount != null ? snap.tradesCount.toLocaleString(loc(locale)) : miss,
      compact: compactFigure(snap?.tradesCount),
      unavailable: snap?.tradesCount == null,
      sub: t("lithos.tradesSub"),
      mark: <KpiMark id="swap" tone={INK.gold} />,
      ink: INK.gold,
      enter: 3,
    },
  ];

  return (
    <Shell>
      <KpiGrid items={kpis} dense className="mb-4 sm:grid-cols-4" />

      <div className="mb-2 grid min-w-0 items-stretch gap-2 md:grid-cols-3">
        <article
          className="home-tile-enter min-w-0 max-w-full overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3"
          style={{ "--enter": 4 } as CSSProperties}
        >
          <h2 className="text-[13px] font-medium text-[var(--muted)]">{t("lithos.protocol")}</h2>
          <div className="mt-2 flex items-center gap-2">
            <img
              src="/lithos-mark.png"
              alt=""
              width={36}
              height={36}
              className="h-9 w-9 shrink-0 object-contain"
            />
            <span className="text-[14px] font-semibold">Lithos</span>
          </div>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--text)]">
            {t("lithos.protocolBody")}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
            {LITHOS_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] text-accent hover:underline"
              >
                {t(link.key)}
              </a>
            ))}
          </div>
        </article>
        <article
          className="home-tile-enter flex min-h-0 min-w-0 max-w-full flex-col overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3"
          style={{ "--enter": 5 } as CSSProperties}
        >
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="m-0 text-[13px] font-medium leading-none text-[var(--muted)]">
                {t("defi.chartVol")}
              </h2>
              <div className="mt-2 flex items-center gap-3 text-[12px] text-[var(--muted)]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: VOL_LINE }} />
                  {t("defi.chartVol")}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: SWAP_LINE }} />
                  {t("defi.chartSwaps")}
                </span>
              </div>
            </div>
            <div className="inline-grid grid-cols-3 gap-1">
              {VOL_RANGES.map((r) => {
                const on = rangeId === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setRangeId(r.id)}
                    className={clsx(
                      "chip-press inline-flex h-6 w-full items-center justify-center rounded-[9px] px-2.5 text-[12px] font-medium tabular-nums",
                      "transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                      on
                        ? "is-pressed bg-[var(--panel-hover)] text-[var(--text)]"
                        : "text-[var(--muted)] hover:bg-[var(--wash)] hover:text-[var(--text)]"
                    )}
                  >
                    {t(`defi.range.${r.id}`)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="min-h-[168px] min-w-0 flex-1">
            {showVolChart ? (
              <DualLineChart
                points={volPts}
                compact
                skipBin
                binMs={range.binMs}
                revealKey={shownRange}
                colorTxs={VOL_LINE}
                colorFees={SWAP_LINE}
                nameTxs={t("defi.chartVol")}
                nameFees={t("defi.chartSwaps")}
                locale={loc(locale)}
                formatTxs={(v) => {
                  if (!Number.isFinite(v) || v <= 0) return "0";
                  if (v >= 1000) return formatCompact(v, 1, locale);
                  return formatErg(v, 1);
                }}
                formatFees={(v) => {
                  if (!Number.isFinite(v) || v <= 0) return "0";
                  return formatCompact(v, 0, locale);
                }}
              />
            ) : (
              <p className="flex h-[168px] items-center justify-center text-[13px] text-[var(--muted)]">
                {t("defi.chartWait")}
              </p>
            )}
          </div>
        </article>
        <article
          className="home-tile-enter flex min-h-0 min-w-0 max-w-full flex-col overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3"
          style={{ "--enter": 6 } as CSSProperties}
        >
          <h2 className="text-[13px] font-medium text-[var(--muted)]">{t("lithos.pools")}</h2>
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:thin]">
            {!pools.length ? (
              <p className="text-[13px] text-[var(--muted)]">{t("lithos.emptyPools")}</p>
            ) : (
              pools.map((p) => (
                <Link
                  prefetch={false}
                  key={p.poolId || p.tokenId}
                  href={`/token/${p.tokenId}`}
                  className="chip-press flex w-full items-center gap-2 overflow-hidden rounded-[10px] px-1.5 py-1.5 text-[13px] hover:bg-[var(--wash)]"
                >
                  <TokenAvatar tokenId={p.tokenId} symbol={p.symbol} size={22} />
                  <span
                    className="min-w-0 flex-1 truncate font-semibold"
                    style={{ color: tokenTickerInk(p.tokenId) }}
                  >
                    {poolLabel(p)}
                  </span>
                  <span className="shrink-0 tabular-nums text-[12px] text-[var(--muted)]">
                    {p.tvlErg > 0 ? fmtErgFull(p.tvlErg, locale) : "—"}
                  </span>
                </Link>
              ))
            )}
          </div>
        </article>
      </div>

      <div className="grid min-w-0 items-start gap-2 xl:grid-cols-4">
        <div className="min-w-0 xl:col-span-3">
          {!listReady ? null : !rows.length ? (
            <Feed>
              <FeedEmpty k="swap" title={t("lithos.emptyTape")} />
            </Feed>
          ) : (
            <div className="feed-sheet">
              <Feed busy={pending} className={sort === "time" ? undefined : "is-rank"} enterClass={eventsPack.enterClass("pack")}>
                <FeedSwapTape
                  rows={rows}
                  tag={t("lithos.trades")}
                  total={snap?.tradesCount ?? null}
                  sort={sort}
                  dir={dir}
                  timeKey="time"
                  sorts={[
                    { key: "time", label: t("defi.time") },
                    { key: "amount", label: t("defi.amount") },
                    { key: "ticker", label: t("defi.token") },
                  ]}
                  onSort={onSort}
                  pending={pending}
                  offset={eventsOffset}
                  enterClass={eventsEnter.enterClass}
                />
              </Feed>
              <RankWindow
                offset={eventsOffset}
                pageSize={TAPE_PACK}
                shown={rows.length}
                total={snap?.tradesCount ?? null}
                loc={loc(locale)}
                ofLabel={t("addresses.packOf")}
                prevLabel={t("addresses.packPrev")}
                nextLabel={t("addresses.packNext")}
                tapeLabel={t("lithos.packTape")}
                hint={t("lithos.packHint")}
                disabled={pending}
                onOffset={setEventsOffset}
              />
            </div>
          )}
        </div>
        <div className="min-w-0 xl:col-span-1">
          {!listReady ? null : !topTraders.length ? (
            <Feed>
              <FeedEmpty k="addr" title={t("lithos.emptyTop")} />
            </Feed>
          ) : (
            <div className="feed-sheet">
              <Feed busy={pending} className="is-rank is-side" enterClass={tradersPack.enterClass("pack")}>
                <FeedBoard
                  plate={
                    <FeedPlate
                      tag={t("stable.topTraders")}
                      count={snap?.tradersCount != null ? <FeedCount k="feed.traders" n={snap.tradersCount} /> : undefined}
                    />
                  }
                >
                  {topTraders.map((row, i) => (
                    <FeedTraderRow
                      key={row.trader}
                      trader={row.trader}
                      erg={row.erg}
                      deals={row.deals}
                      rank={tradersOffset + i + 1}
                      enterClass={tradersEnter.enterClass(row.trader)}
                    />
                  ))}
                </FeedBoard>
              </Feed>
              <RankWindow
                offset={tradersOffset}
                pageSize={TAPE_PACK}
                shown={topTraders.length}
                total={snap?.tradersCount ?? null}
                loc={loc(locale)}
                ofLabel={t("addresses.packOf")}
                prevLabel={t("addresses.packPrev")}
                nextLabel={t("addresses.packNext")}
                tapeLabel={t("lithos.packTraders")}
                hint={t("lithos.packHint")}
                disabled={pending}
                onOffset={setTradersOffset}
              />
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}
