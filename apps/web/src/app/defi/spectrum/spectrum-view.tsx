"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import { KpiGrid } from "@/components/KpiGrid";
import {
  KpiMarkHandshake,
  KpiMarkScrollText,
  KpiMarkTrendingUp,
  KpiMarkVault,
} from "@/components/kpi-marks";
import { TokenAvatar } from "@/components/TokenBadge";
import { PrettyPrice } from "@/components/PrettyNum";
import { ListWhen } from "@/components/ListWhen";
import { RankWindow } from "@/components/RankWindow";
import { INK } from "@/lib/palette";
import { formatCompact, formatErg, formatGroupedNumber, formatRelAge, shortId } from "@/lib/format";
import { resolveTokenMeta, tokenTickerInk } from "@/lib/token-meta";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";
import { SNAPSHOT_FETCH, enteringIds, useEnterIds } from "@/lib/keyed-enter";
import { getGateway } from "@/lib/config";
import { noteRouteNavigation } from "@/lib/route-nav";
import { SPECTRUM_LINKS } from "@/lib/spectrum-links";
import {
  VOL_RANGES,
  fillVolumeGaps,
  volRangeById,
  type DefiVolPoint,
  type VolRangeId,
} from "@/lib/defi-volume";
import {
  defiVenueCaption,
  isErgBase,
  spectrumListedPools,
  type DefiPool,
} from "@/lib/defi-pools";
import type { AgeUsdEvent, AgeUsdTrader, SpectrumDexSnap } from "@/lib/list-snapshots";

const DualLineChart = dynamic(() => import("@/components/DualLineChart"), {
  ssr: false,
  loading: () => <div className="h-[168px] w-full" />,
});

const VOL_LINE = "#8ec8ff";
const SWAP_LINE = "#f472b6";
const TAPE_PACK = 25;
const ERG_ZERO = "0".repeat(64);

type TapeSort = "time" | "ticker" | "amount";
type TapeDir = "asc" | "desc";

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function tapeEventId(row: AgeUsdEvent): string {
  return `${row.txId}:${row.side}:${row.tokenId}`;
}

function shortHash(id: string): string {
  if (!id || id.length <= 10) return id;
  return `${id.slice(0, 5)}..${id.slice(-5)}`;
}

function fmtAmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return formatGroupedNumber(n, 2, 2);
}

function fmtErgFull(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${formatGroupedNumber(n, 2, 2)} ERG`;
}

function poolLabel(p: DefiPool): string {
  const meta = resolveTokenMeta(p.tokenId, p.symbol);
  const sym = meta?.symbol || p.symbol || shortId(p.tokenId, 4);
  if (isErgBase(p.baseId, p.baseSymbol)) return `${sym}/ERG`;
  return `${sym}/${p.baseSymbol || shortId(p.baseId || "", 4)}`;
}

export function SpectrumView({
  tokenId = "",
  initial,
  initialVolume = [],
}: {
  tokenId?: string;
  initial: SpectrumDexSnap | null;
  initialVolume?: DefiVolPoint[];
}) {
  const t = useT();
  const { locale } = useI18n();
  const { markSynced } = usePageSync();
  const router = useRouter();
  const miss = t("home.unavailable");
  const [snap, setSnap] = useState<SpectrumDexSnap | null>(initial);
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
  const eventsEnter = useEnterIds();
  const eventsPack = useEnterIds();
  const tradersEnter = useEnterIds();
  const tradersPack = useEnterIds();
  const [listReady, setListReady] = useState(false);
  const opened = useRef(false);
  const eventsPrev = useRef<{ id: string }[]>([]);
  const tradersPrev = useRef<{ id: string }[]>([]);
  const floor =
    snap?.minTvlErg != null && Number.isFinite(snap.minTvlErg)
      ? snap.minTvlErg
      : 100;

  const pull = useCallback(async (silent = false) => {
    try {
      const qs = new URLSearchParams({
        limit: String(TAPE_PACK),
        eventsOffset: String(eventsOffset),
        tradersOffset: String(tradersOffset),
        eventsSort: sort,
        eventsDir: dir,
      });
      if (tokenId) qs.set("tokenId", tokenId);
      const r = await fetch(`${getGateway()}/v1/defi/spectrum?${qs}`, SNAPSHOT_FETCH);
      if (!r.ok) return;
      const next = (await r.json()) as SpectrumDexSnap;
      if (opened.current) {
        const events = (next.events ?? []).map((row) => ({ id: tapeEventId(row) }));
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
    tokenId,
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
      const qs = new URLSearchParams({ days: String(r.days), venue: "spectrum" });
      if (tokenId) qs.set("tokenId", tokenId);
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
          const ok = venue === "spectrum" || venue === "spectrum_cfmm";
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
    [rangeId, tokenId]
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
    const events = (snap?.events ?? []).map((row) => ({ id: tapeEventId(row) }));
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
  const pools = spectrumListedPools(snap?.pools ?? [], floor);
  const tvl = snap?.tvlErg != null && Number.isFinite(snap.tvlErg) ? snap.tvlErg : null;
  const vol = snap?.volErg != null && Number.isFinite(snap.volErg) ? snap.volErg : null;
  const filterMeta = tokenId ? resolveTokenMeta(tokenId, null) : null;

  const onSort = (k: TapeSort) => {
    if (sort === k) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(k);
      setDir(k === "time" || k === "amount" ? "desc" : "asc");
    }
    setEventsOffset(0);
  };

  const pickPool = (id: string) => {
    const path = `/defi/spectrum?tokenId=${id}`;
    noteRouteNavigation(path);
    router.push(path);
  };

  const clearToken = () => {
    noteRouteNavigation("/defi/spectrum");
    router.push("/defi/spectrum");
  };

  const kpis = [
    {
      label: t("spectrum.tvl"),
      value: tvl != null && tvl > 0 ? fmtErgFull(tvl) : miss,
      unavailable: tvl == null || tvl <= 0,
      sub: t("spectrum.tvlSub"),
      mark: <KpiMarkVault tone={INK.gold} />,
      ink: INK.gold,
      enter: 0,
    },
    {
      label: t("spectrum.volume"),
      value: vol != null && vol > 0 ? fmtErgFull(vol) : miss,
      unavailable: vol == null || vol <= 0,
      sub: t("spectrum.volumeSub"),
      mark: <KpiMarkTrendingUp tone={INK.cyan} />,
      ink: INK.cyan,
      enter: 1,
    },
    {
      label: t("spectrum.traders"),
      value:
        snap?.tradersCount != null ? snap.tradersCount.toLocaleString(loc(locale)) : miss,
      unavailable: snap?.tradersCount == null,
      sub: t("spectrum.tradersSub"),
      mark: <KpiMarkHandshake tone={INK.violet} />,
      ink: INK.violet,
      enter: 2,
    },
    {
      label: t("spectrum.trades"),
      value:
        snap?.tradesCount != null ? snap.tradesCount.toLocaleString(loc(locale)) : miss,
      unavailable: snap?.tradesCount == null,
      sub: t("spectrum.tradesSub"),
      mark: <KpiMarkScrollText tone={INK.gold} />,
      ink: INK.gold,
      enter: 3,
    },
  ];

  return (
    <Shell>
      <KpiGrid items={kpis} dense className="mb-4 sm:grid-cols-4" />

      <div className="mb-4 grid min-w-0 items-stretch gap-3 md:grid-cols-3">
        <article
          className="home-tile-enter min-w-0 max-w-full overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3 md:min-h-0"
          style={{ "--enter": 4 } as CSSProperties}
        >
          <h2 className="text-[13px] font-medium text-[var(--muted)]">{t("spectrum.protocol")}</h2>
          <div className="mt-2 flex items-center gap-2">
            <img
              src="/ergodex-mark.png"
              alt=""
              width={36}
              height={36}
              className="h-9 w-9 rounded-full"
            />
            <span className="text-[14px] font-semibold">{t("defi.title")}</span>
          </div>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--text)]">
            {t("spectrum.protocolBody")}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
            {SPECTRUM_LINKS.map((link) => (
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
                  if (v >= 1000) return formatCompact(v, 1);
                  return formatErg(v, 1);
                }}
                formatFees={(v) => {
                  if (!Number.isFinite(v) || v <= 0) return "0";
                  return formatCompact(v, 0);
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
          className="home-tile-enter flex max-h-[22rem] min-h-0 min-w-0 max-w-full flex-col overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3 md:h-0 md:max-h-none md:min-h-full"
          style={{ "--enter": 6 } as CSSProperties}
        >
          <h2 className="shrink-0 text-[13px] font-medium text-[var(--muted)]">{t("spectrum.pools")}</h2>
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-width:thin]">
            {!pools.length ? (
              <p className="text-[13px] text-[var(--muted)]">{t("spectrum.emptyPools")}</p>
            ) : (
              pools.map((p) => {
                const on = tokenId && p.tokenId === tokenId;
                const venue = defiVenueCaption(p.venue, t);
                return (
                  <button
                    key={p.poolId || p.tokenId}
                    type="button"
                    onClick={() => pickPool(p.tokenId)}
                    className={clsx(
                      "chip-press flex w-full items-center gap-2 overflow-hidden rounded-[10px] px-1.5 py-1.5 text-left text-[13px] hover:bg-[var(--wash)]",
                      on && "is-pressed bg-[var(--wash-strong)]"
                    )}
                  >
                    <TokenAvatar tokenId={p.tokenId} symbol={p.symbol} size={22} />
                    <span className="min-w-0 flex-1 truncate">
                      <span
                        className="block truncate font-semibold"
                        style={{ color: tokenTickerInk(p.tokenId) }}
                      >
                        {poolLabel(p)}
                      </span>
                      {venue ? (
                        <span className="mt-0.5 block truncate text-[11px] leading-none text-[var(--muted)]">
                          {venue}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-[12px] text-[var(--muted)]">
                      {p.tvlErg > 0 ? fmtErgFull(p.tvlErg) : "—"}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </article>
      </div>

      {tokenId ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <TokenAvatar tokenId={tokenId} symbol={filterMeta?.symbol} size={24} />
          <span className="text-[13px] font-medium">{filterMeta?.symbol || shortId(tokenId, 8)}</span>
          <Link href={`/token/${tokenId}`} className="font-mono text-[12px] text-accent hover:underline">
            {shortId(tokenId, 8)}
          </Link>
          <button
            type="button"
            onClick={clearToken}
            className="chip-press overflow-hidden rounded-full border border-[var(--border)] px-2.5 py-0.5 text-[11px] text-[var(--muted)] hover:bg-[var(--wash)]"
          >
            {t("defi.clear")}
          </button>
        </div>
      ) : null}

      <div className="grid min-w-0 items-start gap-3 lg:grid-cols-4">
        <div className="min-w-0 lg:col-span-3">
          {!listReady ? null : !rows.length ? (
            <p className="text-[var(--muted)]">
              {tokenId ? t("defi.emptyTrades") : t("spectrum.emptyTape")}
            </p>
          ) : (
            <div className="addr-sheet">
              <div className={eventsPack.enterClass("pack")}>
              <div
                className={clsx(
                  "addr-pan transition-opacity duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                  pending && "opacity-60"
                )}
              >
                <div className="addr-head addr-lane addr-lane-x block-lane text-[12px] font-medium">
                  <div className="block-lane-pair">
                    <SortCol label={t("defi.token")} k="ticker" sort={sort} dir={dir} align="left" onSort={onSort} />
                    <div className="min-w-0 justify-end">{t("defi.side")}</div>
                  </div>
                  <div className="block-lane-pair">
                    <div className="min-w-0">{t("defi.price")}</div>
                    <SortCol label={t("defi.amount")} k="amount" sort={sort} dir={dir} align="right" onSort={onSort} />
                  </div>
                  <div className="block-lane-pair">
                    <div className="min-w-0">{t("defi.paid")}</div>
                    <SortCol label={t("defi.time")} k="time" sort={sort} dir={dir} align="right" onSort={onSort} />
                  </div>
                  <div className="block-lane-pair">
                    <div className="min-w-0">{t("defi.trader")}</div>
                    <div className="min-w-0 justify-end">{t("detail.tx")}</div>
                  </div>
                </div>
                {rows.map((row) => (
                  <TapeRow
                    key={tapeEventId(row)}
                    row={row}
                    locale={locale}
                    t={t}
                    enterClass={eventsEnter.enterClass(tapeEventId(row))}
                  />
                ))}
              </div>
              </div>
              <RankWindow
                offset={eventsOffset}
                pageSize={TAPE_PACK}
                shown={rows.length}
                total={snap?.eventsCount ?? snap?.tradesCount ?? null}
                loc={loc(locale)}
                ofLabel={t("addresses.packOf")}
                prevLabel={t("addresses.packPrev")}
                nextLabel={t("addresses.packNext")}
                tapeLabel={t("spectrum.packTape")}
                hint={t("spectrum.packHint")}
                disabled={pending}
                onOffset={setEventsOffset}
              />
            </div>
          )}
        </div>
        <div className="min-w-0 lg:col-span-1">
          {!listReady ? null : !topTraders.length ? (
            <p className="text-[var(--muted)]">{t("spectrum.emptyTop")}</p>
          ) : (
            <div className="addr-sheet">
              <div className={tradersPack.enterClass("pack")}>
              <div
                className={clsx(
                  "addr-pan side-list transition-opacity duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                  pending && "opacity-60"
                )}
              >
                <div className="addr-head flex h-[var(--addr-bar)] items-center text-[12px] font-medium">
                  <div className="min-w-0 flex-1 px-3 text-[var(--muted)]">{t("defi.trader")}</div>
                  <div className="shrink-0 px-3 text-right text-[var(--muted)]">{t("stable.topSum")}</div>
                </div>
                {topTraders.map((row) => (
                  <TopTraderRow
                    key={row.trader}
                    row={row}
                    enterClass={tradersEnter.enterClass(row.trader)}
                  />
                ))}
              </div>
              </div>
              <RankWindow
                offset={tradersOffset}
                pageSize={TAPE_PACK}
                shown={topTraders.length}
                total={snap?.tradersCount ?? null}
                loc={loc(locale)}
                ofLabel={t("addresses.packOf")}
                prevLabel={t("addresses.packPrev")}
                nextLabel={t("addresses.packNext")}
                tapeLabel={t("spectrum.packTraders")}
                hint={t("spectrum.packHint")}
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

function SortCol({
  label,
  k,
  sort,
  dir,
  align,
  onSort,
}: {
  label: string;
  k: TapeSort;
  sort: TapeSort;
  dir: TapeDir;
  align: "left" | "right";
  onSort: (k: TapeSort) => void;
}) {
  const t = useT();
  const on = sort === k;
  const hint = on
    ? `${label}, ${dir === "asc" ? t("addresses.sortAsc") : t("addresses.sortDesc")}`
    : label;
  return (
    <div
      className={clsx("flex h-full min-w-0 items-center", align === "right" && "justify-end")}
      aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        aria-label={hint}
        className={clsx(
          "chip-press inline-flex shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[10px] px-2 py-1.5 text-[12px] font-medium leading-none transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-[var(--text)]",
          on ? "is-pressed bg-[var(--wash-strong)] text-[var(--text)]" : "text-[var(--muted)]"
        )}
      >
        {label}
        <span className="sort-mark" aria-hidden>
          <span className={clsx("sort-caret sort-caret-up", on && dir === "asc" && "is-on")} />
          <span className={clsx("sort-caret sort-caret-dn", on && dir === "desc" && "is-on")} />
        </span>
      </button>
    </div>
  );
}

function TapeRow({
  row,
  locale,
  t,
  enterClass,
}: {
  row: AgeUsdEvent;
  locale: string;
  t: (k: string) => string;
  enterClass?: string;
}) {
  const meta = row.tokenId ? resolveTokenMeta(row.tokenId, null) : null;
  const label = meta?.symbol || (row.tokenId ? shortId(row.tokenId, 4) : "—");
  const sid = row.side.toLowerCase();
  const sideKey = `defi.side.${sid}`;
  const side = t(sideKey) !== sideKey ? t(sideKey) : row.side;
  const buy = sid === "buy" || sid === "add";
  const sell = sid === "sell" || sid === "remove";
  const ergoPaid = isErgBase(row.baseId, null);
  const baseMeta = !ergoPaid && row.baseId ? resolveTokenMeta(row.baseId, null) : null;
  const paidUnit = ergoPaid
    ? "ERG"
    : baseMeta?.symbol || (row.baseId && row.baseId !== ERG_ZERO ? shortId(row.baseId, 4) : "");
  const price =
    row.tokenAmount > 0 && row.baseAmount > 0 ? row.baseAmount / row.tokenAmount : null;
  return (
    <div
      className={clsx(
        "addr-lane addr-lane-x block-lane border-t border-[var(--border-soft)] py-2.5 text-[13px]",
        enterClass
      )}
    >
      <div className="block-lane-pair">
        <div className="flex min-w-0 items-center px-3">
          {row.tokenId ? (
            <Link href={`/token/${row.tokenId}`} className="flex min-w-0 items-center gap-2">
              <TokenAvatar tokenId={row.tokenId} symbol={meta?.symbol} size={22} />
              <span className="truncate font-semibold" style={{ color: tokenTickerInk(row.tokenId) }}>
                {label}
              </span>
            </Link>
          ) : (
            <span className="text-[var(--muted)]">—</span>
          )}
        </div>
        <div className="flex min-w-0 items-center justify-end px-3">
          <div className="min-w-0 text-right">
            <p
              className={clsx(
                "font-medium lowercase leading-none",
                buy && "text-[var(--up)]",
                sell && "text-[#FF4D6D]",
                !buy && !sell && "text-[var(--muted)]"
              )}
            >
              {side}
            </p>
            <p className="mt-0.5 text-[11px] leading-none text-[var(--muted)]">
              {formatRelAge(row.time, locale)}
            </p>
          </div>
        </div>
      </div>
      <div className="block-lane-pair">
        <div className="min-w-0 px-3 tabular-nums">
          <PrettyPrice n={price} />
        </div>
        <div className="min-w-0 px-3 text-right tabular-nums">{fmtAmt(row.tokenAmount)}</div>
      </div>
      <div className="block-lane-pair">
        <div className="min-w-0 px-3 tabular-nums text-[var(--up)]">
          {row.baseAmount
            ? ergoPaid
              ? fmtErgFull(row.baseAmount)
              : `${fmtAmt(row.baseAmount)}${paidUnit ? ` ${paidUnit}` : ""}`
            : "—"}
        </div>
        <div className="min-w-0 px-3 text-right">
          <ListWhen ts={row.time} locale={locale} />
        </div>
      </div>
      <div className="block-lane-pair">
        <div className="min-w-0 px-3">
          {row.trader ? (
            <Link
              href={`/address/${encodeURIComponent(row.trader)}`}
              className="block truncate whitespace-nowrap font-mono text-[12px] text-accent hover:underline"
            >
              {shortHash(row.trader)}
            </Link>
          ) : (
            <span className="text-[var(--muted)]">—</span>
          )}
        </div>
        <div className="min-w-0 px-3 text-right">
          {row.txId ? (
            <Link
              href={`/tx/${row.txId}`}
              className="inline-block whitespace-nowrap font-mono text-accent hover:underline"
            >
              {shortHash(row.txId)}
            </Link>
          ) : (
            "—"
          )}
        </div>
      </div>
    </div>
  );
}

function TopTraderRow({ row, enterClass }: { row: AgeUsdTrader; enterClass?: string }) {
  return (
    <div
      className={clsx(
        "box-border flex h-[var(--addr-row)] min-h-[var(--addr-row)] max-h-[var(--addr-row)] items-center border-t border-[var(--border-soft)] text-[13px]",
        enterClass
      )}
    >
      <div className="min-w-0 flex-1 px-3">
        <Link
          href={`/address/${encodeURIComponent(row.trader)}`}
          className="block truncate whitespace-nowrap font-mono text-[12px] text-accent hover:underline"
        >
          {shortHash(row.trader)}
        </Link>
      </div>
      <div className="shrink-0 px-3 text-right tabular-nums text-[var(--up)]">
        {fmtErgFull(row.erg)}
      </div>
    </div>
  );
}
