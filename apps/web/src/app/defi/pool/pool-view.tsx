"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import { KpiGrid } from "@/components/KpiGrid";
import {
  KpiMarkHandshake,
  KpiMarkScrollText,
  KpiMarkTrendingUp,
  KpiMarkVault,
} from "@/components/kpi-marks";
import { AddressActivityWhen } from "@/components/AddressTapeRow";
import { TokenAvatar } from "@/components/TokenBadge";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { RankWindow } from "@/components/RankWindow";
import { INK } from "@/lib/palette";
import { formatGroupedNumber, shortId } from "@/lib/format";
import { resolveTokenMeta, tokenTickerInk } from "@/lib/token-meta";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { useChainTipRefresh, usePageSync } from "@/lib/page-sync";
import { SNAPSHOT_FETCH, snapshotPath, useEnterIds } from "@/lib/keyed-enter";
import { getGateway } from "@/lib/config";
import { useFavoriteList } from "@/lib/favorites";
import { noteRouteNavigation } from "@/lib/route-nav";
import {
  defiVenueCaption,
  isErgBase,
  sortPoolBoard,
  type PoolBoardDir,
  type PoolBoardRow,
  type PoolBoardSort,
} from "@/lib/defi-pools";
import type { PoolBoardSnap } from "@/lib/list-snapshots";

const POOL_PACK = 25;

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function fmtErgFull(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${formatGroupedNumber(n, 2, 2)} ERG`;
}

function poolLabel(p: PoolBoardRow): string {
  const meta = resolveTokenMeta(p.tokenId, p.symbol);
  const sym = meta?.symbol || p.symbol || shortId(p.tokenId, 4);
  if (isErgBase(p.baseId, p.baseSymbol)) return `${sym}/ERG`;
  return `${sym}/${p.baseSymbol || shortId(p.baseId || "", 4)}`;
}

function SortMark({ on, dir }: { on: boolean; dir: PoolBoardDir }) {
  return (
    <span className="sort-mark" aria-hidden>
      <span className={clsx("sort-caret sort-caret-up", on && dir === "asc" && "is-on")} />
      <span className={clsx("sort-caret sort-caret-dn", on && dir === "desc" && "is-on")} />
    </span>
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
  k: PoolBoardSort;
  sort: PoolBoardSort;
  dir: PoolBoardDir;
  align: "left" | "right";
  onSort: (k: PoolBoardSort) => void;
}) {
  const t = useT();
  const on = sort === k;
  const hint = on
    ? `${label}, ${dir === "asc" ? t("addresses.sortAsc") : t("addresses.sortDesc")}`
    : label;
  return (
    <div
      className={clsx(
        "flex h-full min-w-0 items-center",
        align === "right" && "justify-end"
      )}
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
        {align === "right" ? (
          <>
            <SortMark on={on} dir={dir} />
            <span>{label}</span>
          </>
        ) : (
          <>
            <span>{label}</span>
            <SortMark on={on} dir={dir} />
          </>
        )}
      </button>
    </div>
  );
}

export function PoolView({ initial }: { initial: PoolBoardSnap | null }) {
  const t = useT();
  const { ids: favIds, toggle: toggleFav } = useFavoriteList("pools");
  const favReady = favIds != null;
  const { locale } = useI18n();
  const { markSynced, tip } = usePageSync();
  const tipRef = useRef(tip);
  tipRef.current = tip;
  const [snap, setSnap] = useState<PoolBoardSnap | null>(initial);
  const [sort, setSort] = useState<PoolBoardSort>("tvl");
  const [dir, setDir] = useState<PoolBoardDir>("desc");
  const [offset, setOffset] = useState(0);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(initial?.ok === true);
  const [err, setErr] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);
  const [listReady, setListReady] = useState(false);
  const enter = useEnterIds();
  const packEnter = useEnterIds();
  const opened = useRef(false);
  const pinRef = useRef<HTMLDivElement>(null);
  const miss = t("home.unavailable");

  const load = useCallback(
    (silent = false) => {
      if (!silent) setPending(true);
      const h = tipRef.current?.height;
      void fetch(`${getGateway()}${snapshotPath("/v1/defi/pool-board", h)}`, SNAPSHOT_FETCH)
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json() as Promise<PoolBoardSnap>;
        })
        .then((j) => {
          if (j?.ok !== true) throw new Error("pool_board");
          setSnap(j);
          setErr(null);
          setReady(true);
          markSynced(j && "at" in j ? String((j as { at?: number }).at ?? "") : null);
        })
        .catch((e) => {
          if (!silent) setErr(String(e));
          setReady(true);
        })
        .finally(() => {
          if (!silent) setPending(false);
        });
    },
    [markSynced]
  );

  useEffect(() => {
    if (initial?.ok === true) return;
    load();
  }, [initial, load]);

  const rows = snap?.pools ?? [];
  const sorted = useMemo(() => sortPoolBoard(rows, sort, dir), [rows, sort, dir]);
  const pageRows = sorted.slice(offset, offset + POOL_PACK);
  const pageKey = pageRows.map((p) => p.poolId).join(",");

  useEffect(() => {
    if (!ready || !pageKey) return;
    const ids = pageKey.split(",");
    if (!opened.current) {
      opened.current = true;
      packEnter.mark(["pack"]);
    }
    enter.mark(ids);
    setListReady(true);
  }, [ready, pageKey, enter.mark, packEnter.mark]);

  useEffect(() => {
    const el = pinRef.current;
    if (!el) return;
    const chrome = document.querySelector(".stage-frame header.sticky");
    const pin =
      (chrome instanceof HTMLElement ? chrome.getBoundingClientRect().height : 64) + 8;
    const obs = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { threshold: 1, rootMargin: `-${pin}px 0px 0px 0px` }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [pageRows.length]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useChainTipRefresh(true, () => loadRef.current(true));

  const onSort = (k: PoolBoardSort) => {
    if (sort === k) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(k);
      setDir(k === "first" ? "asc" : "desc");
    }
    setOffset(0);
  };

  const tvl = snap?.tvlErg != null && Number.isFinite(snap.tvlErg) ? snap.tvlErg : null;
  const vol = snap?.volErg != null && Number.isFinite(snap.volErg) ? snap.volErg : null;
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
      <KpiGrid items={kpis} dense className="mb-3 sm:grid-cols-4" />

      {err && (
        <p className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-200">
          {err}
        </p>
      )}

      {!listReady && !err ? null : !sorted.length && !err ? (
        <p className="text-[var(--muted)]">{t("pool.empty")}</p>
      ) : null}

      {listReady && sorted.length > 0 && (
        <div className="addr-sheet">
          <div ref={pinRef} className="h-px w-full" aria-hidden />
          <div className={packEnter.enterClass("pack")}>
            <div
              className={clsx(
                "addr-pan kpi-tape transition-opacity duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                pending && "opacity-60"
              )}
            >
              <div
                className={clsx(
                  "addr-head addr-lane addr-lane-x block-tx-pairs text-[12px] font-medium",
                  stuck && "is-stuck"
                )}
              >
                <div className="block-lane-pair">
                  <div className="min-w-0 text-[12px] font-medium text-[var(--muted)]">
                    {t("pool.colPair")}
                  </div>
                  <SortCol
                    label={t("spectrum.tvl")}
                    k="tvl"
                    sort={sort}
                    dir={dir}
                    align="right"
                    onSort={onSort}
                  />
                </div>
                <div className="block-lane-pair">
                  <SortCol
                    label={t("spectrum.volume")}
                    k="vol"
                    sort={sort}
                    dir={dir}
                    align="left"
                    onSort={onSort}
                  />
                  <SortCol
                    label={t("pool.colDay")}
                    k="vol24"
                    sort={sort}
                    dir={dir}
                    align="right"
                    onSort={onSort}
                  />
                </div>
                <div className="block-lane-pair">
                  <div className="min-w-0 text-[12px] font-medium text-[var(--muted)]">
                    {t("spectrum.traders")}
                  </div>
                  <SortCol
                    label={t("pool.colFirst")}
                    k="first"
                    sort={sort}
                    dir={dir}
                    align="right"
                    onSort={onSort}
                  />
                </div>
                <div className="block-lane-pair">
                  <SortCol
                    label={t("spectrum.trades")}
                    k="trades"
                    sort={sort}
                    dir={dir}
                    align="left"
                    onSort={onSort}
                  />
                  <SortCol
                    label={t("pool.colLast")}
                    k="last"
                    sort={sort}
                    dir={dir}
                    align="right"
                    onSort={onSort}
                  />
                </div>
              </div>
              {pageRows.map((row) => (
                <PoolTapeRow
                  key={row.poolId}
                  row={row}
                  locale={locale}
                  miss={miss}
                  t={t}
                  enterClass={enter.enterClass(row.poolId)}
                  fav={favIds?.includes(row.poolId) ?? false}
                  favReady={favReady}
                  favTitle={favIds?.includes(row.poolId) ? t("favorites.remove") : t("favorites.add")}
                  onToggleFav={() => toggleFav(row.poolId)}
                />
              ))}
            </div>
          </div>
          <RankWindow
            offset={offset}
            pageSize={POOL_PACK}
            shown={pageRows.length}
            total={sorted.length}
            hasMore={offset + POOL_PACK < sorted.length}
            loc={loc(locale)}
            ofLabel={t("addresses.packOf")}
            prevLabel={t("addresses.packPrev")}
            nextLabel={t("addresses.packNext")}
            tapeLabel={t("pool.packTape")}
            hint={t("pool.packHint")}
            disabled={pending}
            onOffset={(next) => {
              if (sorted.length <= POOL_PACK) {
                setOffset(0);
                return;
              }
              const max = Math.floor((sorted.length - 1) / POOL_PACK) * POOL_PACK;
              setOffset(Math.max(0, Math.min(next, max)));
            }}
          />
        </div>
      )}
    </Shell>
  );
}

export function PoolTapeRow({
  row,
  locale,
  miss,
  t,
  enterClass,
  fav = false,
  favReady = true,
  favTitle,
  onToggleFav,
}: {
  row: PoolBoardRow;
  locale: string;
  miss: string;
  t: (k: string) => string;
  enterClass?: string;
  fav?: boolean;
  favReady?: boolean;
  favTitle?: string;
  onToggleFav?: () => void;
}) {
  const venue = defiVenueCaption(row.venue, t);
  const href = `/defi/pool/${row.poolId}`;
  const when = {
    locale: loc(locale),
    openLabel: t("addresses.openTx"),
    copyLabel: t("tx.copy"),
    copiedLabel: t("tx.copied"),
  } as const;
  return (
    <div
      className={clsx(
        "addr-lane addr-lane-x block-tx-pairs border-t border-[var(--border-soft)] py-2.5 text-[13px]",
        enterClass
      )}
    >
      <div className="block-lane-pair">
        <div className="flex min-w-0 items-center gap-1 px-3">
          <Link
            href={href}
            onClick={() => noteRouteNavigation(href)}
            className="flex min-w-0 items-center gap-2"
          >
            <TokenAvatar tokenId={row.tokenId} symbol={row.symbol} size={22} />
            <span className="min-w-0">
              <span
                className="block truncate font-semibold"
                style={{ color: tokenTickerInk(row.tokenId) }}
              >
                {poolLabel(row)}
              </span>
              {venue ? (
                <span className="mt-0.5 block truncate text-[11px] leading-none text-[var(--muted)]">
                  {venue}
                </span>
              ) : null}
            </span>
          </Link>
          {onToggleFav ? (
            <FavoriteHeart
              size="sm"
              on={fav}
              ready={favReady}
              title={favTitle ?? ""}
              onToggle={onToggleFav}
            />
          ) : null}
        </div>
        <div className="px-3 text-right">
          <span className="tabular-nums font-semibold" style={{ color: INK.gold }}>
            {row.tvlErg > 0 ? fmtErgFull(row.tvlErg) : miss}
          </span>
        </div>
      </div>
      <div className="block-lane-pair">
        <div className="min-w-0 px-3">
          <span className="tabular-nums" style={{ color: INK.cyan }}>
            {row.volErg != null ? fmtErgFull(row.volErg) : miss}
          </span>
        </div>
        <div className="px-3 text-right">
          <span className="tabular-nums" style={{ color: INK.cyan }}>
            {row.vol24h != null ? fmtErgFull(row.vol24h) : miss}
          </span>
        </div>
      </div>
      <div className="block-lane-pair addr-act-pair">
        <div className="min-w-0 px-3">
          <span className="tabular-nums" style={{ color: INK.violet }}>
            {row.traders != null ? row.traders.toLocaleString(loc(locale)) : miss}
          </span>
        </div>
        <AddressActivityWhen
          ts={row.firstTs && row.firstTs > 0 ? row.firstTs : null}
          align="right"
          {...when}
        />
      </div>
      <div className="block-lane-pair addr-act-pair">
        <div className="min-w-0 px-3">
          <span className="tabular-nums font-semibold" style={{ color: INK.gold }}>
            {row.trades != null ? row.trades.toLocaleString(loc(locale)) : miss}
          </span>
        </div>
        <AddressActivityWhen
          ts={row.lastTs && row.lastTs > 0 ? row.lastTs : null}
          align="right"
          {...when}
        />
      </div>
    </div>
  );
}
