"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Shell } from "@/components/Shell";
import { compactFigure, KpiGrid } from "@/components/KpiGrid";
import { Feed, FeedBoard, FeedCount, FeedEmpty, FeedPlate, FeedSort } from "@/components/feed/Feed";
import { FeedPoolRow, POOL_SORT_LABEL } from "@/components/feed/FeedPoolRow";
import { KpiMark } from "@/components/kpi-marks";
import { RankWindow } from "@/components/RankWindow";
import { INK } from "@/lib/palette";
import { formatGroupedNumber } from "@/lib/format";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { useChainTipRefresh, usePageSync } from "@/lib/page-sync";
import { ENTER_MS, SNAPSHOT_FETCH, snapshotPath, useEnterIds } from "@/lib/keyed-enter";
import { getGateway } from "@/lib/config";
import { useFavoriteList } from "@/lib/favorites";
import { sortPoolBoard, type PoolBoardDir, type PoolBoardSort } from "@/lib/defi-pools";
import type { PoolBoardSnap } from "@/lib/list-snapshots";

const POOL_PACK = 25;

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function fmtErgFull(n: number, locale?: string): string {
  if (!Number.isFinite(n)) return "—";
  return `${formatGroupedNumber(n, 2, 2, locale)} ERG`;
}

const POOL_SORTS: PoolBoardSort[] = ["tvl", "vol", "vol24", "trades", "last", "first"];

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
  // Rows the server already has go into the first HTML, with the same entry animation.
  const seedIds = initial?.ok === true ? sortPoolBoard(initial.pools ?? [], "tvl", "desc").slice(0, POOL_PACK).map((p) => p.poolId) : [];
  const enter = useEnterIds(ENTER_MS, seedIds);
  const packEnter = useEnterIds(ENTER_MS, seedIds.length ? ["pack"] : []);
  const [listReady, setListReady] = useState(seedIds.length > 0);
  const opened = useRef(seedIds.length > 0);
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
      value: tvl != null && tvl > 0 ? fmtErgFull(tvl, locale) : miss,
      compact: compactFigure(tvl, "ERG"),
      unavailable: tvl == null || tvl <= 0,
      sub: t("spectrum.tvlSub"),
      mark: <KpiMark id="pool" tone={INK.gold} />,
      ink: INK.gold,
      enter: 0,
    },
    {
      label: t("spectrum.volume"),
      value: vol != null && vol > 0 ? fmtErgFull(vol, locale) : miss,
      compact: compactFigure(vol, "ERG"),
      unavailable: vol == null || vol <= 0,
      sub: t("spectrum.volumeSub"),
      mark: <KpiMark id="volume" tone={INK.cyan} />,
      ink: INK.cyan,
      enter: 1,
    },
    {
      label: t("spectrum.traders"),
      value:
        snap?.tradersCount != null ? snap.tradersCount.toLocaleString(loc(locale)) : miss,
      compact: compactFigure(snap?.tradersCount),
      unavailable: snap?.tradersCount == null,
      sub: t("spectrum.tradersSub"),
      mark: <KpiMark id="trader" tone={INK.violet} />,
      ink: INK.violet,
      enter: 2,
    },
    {
      label: t("spectrum.trades"),
      value:
        snap?.tradesCount != null ? snap.tradesCount.toLocaleString(loc(locale)) : miss,
      compact: compactFigure(snap?.tradesCount),
      unavailable: snap?.tradesCount == null,
      sub: t("spectrum.tradesSub"),
      mark: <KpiMark id="swap" tone={INK.gold} />,
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
        <Feed>
          <FeedEmpty k="defi" title={t("pool.empty")} />
        </Feed>
      ) : null}

      {listReady && sorted.length > 0 && (
        <div className="feed-sheet">
          <Feed busy={pending} className="is-rank" enterClass={packEnter.enterClass("pack")}>
            <FeedBoard
              plate={
                <FeedPlate
                  tag={t("defi.pools")}
                  now
                  count={<FeedCount k="feed.pools" n={sorted.length} />}
                  end={
                    <FeedSort
                      label={t("feed.sort.label")}
                      options={POOL_SORTS.map((key) => ({ key, label: t(POOL_SORT_LABEL[key]) }))}
                      active={sort}
                      dir={dir}
                      onSort={onSort}
                      disabled={pending}
                    />
                  }
                />
              }
            >
              {pageRows.map((row, i) => (
                <FeedPoolRow
                  key={row.poolId}
                  row={row}
                  rank={offset + i + 1}
                  sort={sort}
                  enterClass={enter.enterClass(row.poolId)}
                  fav={{
                    on: favIds?.includes(row.poolId) ?? false,
                    ready: favReady,
                    title: favIds?.includes(row.poolId) ? t("favorites.remove") : t("favorites.add"),
                    toggle: () => toggleFav(row.poolId),
                  }}
                />
              ))}
            </FeedBoard>
          </Feed>
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
