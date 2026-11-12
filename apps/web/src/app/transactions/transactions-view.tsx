"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Shell } from "@/components/Shell";
import { compactFigure, KpiGrid } from "@/components/KpiGrid";
import { KpiMark } from "@/components/kpi-marks";
import { INK } from "@/lib/palette";
import { RankWindow } from "@/components/RankWindow";
import { Feed, FeedCount, FeedDays, FeedEmpty, useFeedZone } from "@/components/feed/Feed";
import { FeedTxRow } from "@/components/feed/FeedTxRow";
import { FeedServiceFold } from "@/components/feed/FeedMeaning";
import { foldServiceRows, isTxFold, type TxFold } from "@/lib/tx-meaning-row";
import { getGateway } from "@/lib/config";
import { fetchChainStats, type ChainStats } from "@/lib/chain-stats";
import { formatCompact, formatDottedDate, toEpochMs } from "@/lib/format";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { useChainTipRefresh, usePageSync } from "@/lib/page-sync";
import { SNAPSHOT_FETCH, enteringIds, snapshotPath, useEnterIds, ENTER_MS } from "@/lib/keyed-enter";
import { TX_PACK, parseTxListItems, type TxListItem } from "@/lib/list-snapshots";
import { useFavoriteList } from "@/lib/favorites";

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

export function TransactionsView({
  initialItems,
  initialUpdatedAt = null,
  initialHasMore = false,
  initialNextCursor = null,
  initialStats = null,
}: {
  initialItems: TxListItem[];
  initialUpdatedAt?: string | null;
  initialHasMore?: boolean;
  initialNextCursor?: string | null;
  initialStats?: ChainStats | null;
}) {
  const t = useT();
  const { ids: favIds, toggle: toggleFav } = useFavoriteList("transactions");
  const favReady = favIds != null;
  const { locale } = useI18n();
  const { markSynced, tip } = usePageSync();
  const tipRef = useRef(tip);
  tipRef.current = tip;
  const [items, setItems] = useState<TxListItem[]>(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [page, setPage] = useState(0);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(initialItems.length > 0);
  const [err, setErr] = useState<string | null>(null);
  const [stats, setStats] = useState<ChainStats | null>(initialStats);
  // Rows the server already has go into the first HTML, with the same entry animation.
  const seedIds = initialItems.map((row) => row.id);
  const enter = useEnterIds(ENTER_MS, seedIds);
  const packEnter = useEnterIds(ENTER_MS, seedIds.length ? ["pack"] : []);
  const [listReady, setListReady] = useState(seedIds.length > 0);
  const opened = useRef(seedIds.length > 0);
  const cursorRef = useRef<string | null>(null);
  const cursorStack = useRef<(string | null)[]>([]);
  const nextCursorRef = useRef<string | null>(initialNextCursor);
  nextCursorRef.current = nextCursor;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const load = useCallback(
    (silent = false) => {
      if (!silent && itemsRef.current.length) setPending(true);
      const want = cursorRef.current;
      const q = new URLSearchParams({
        limit: String(TX_PACK),
        mempool: "0",
      });
      if (want) q.set("cursor", want);
      else q.set("offset", "0");
      void fetch(
        `${getGateway()}${snapshotPath(`/v1/transactions/recent?${q}`, tipRef.current?.height)}`,
        SNAPSHOT_FETCH
      )
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json() as Promise<{
            items?: TxListItem[];
            updatedAt?: string | null;
            hasMore?: boolean;
            nextCursor?: string | null;
          }>;
        })
        .then((j) => {
          if (cursorRef.current !== want) return;
          const next = parseTxListItems(j.items);
          if (!next.length && want) {
            const prev = cursorStack.current.pop() ?? null;
            cursorRef.current = prev;
            setPage(cursorStack.current.length);
            return;
          }
          if (!next.length && !want) {
            setErr(null);
            setReady(true);
            markSynced(j.updatedAt);
            return;
          }
          const more = typeof j.hasMore === "boolean" ? j.hasMore : next.length >= TX_PACK;
          const last = next[next.length - 1];
          const nxt =
            typeof j.nextCursor === "string" && j.nextCursor.length
              ? j.nextCursor
              : more && last
                ? `${last.inclusionHeight ?? -1}:${last.index ?? -1}:${last.id}`
                : null;
          setItems((prev) => {
            enter.mark(enteringIds(prev, next));
            return next;
          });
          setHasMore(more);
          setNextCursor(more ? nxt : null);
          setErr(null);
          setReady(true);
          markSynced(j.updatedAt);
        })
        .catch((e) => {
          if (!silent) setErr(String(e));
          setReady(true);
        })
        .finally(() => {
          if (!silent) setPending(false);
        });
    },
    [enter.mark, markSynced]
  );

  const painted = useRef(false);
  useEffect(() => {
    if (painted.current) return;
    painted.current = true;
    if (initialItems.length) {
      markSynced(initialUpdatedAt);
      return;
    }
    load();
  }, [initialItems, initialUpdatedAt, load, markSynced]);

  useEffect(() => {
    if (opened.current) return;
    if (!ready && !items.length) return;
    opened.current = true;
    const ids = items.map((row) => row.id);
    enter.mark(ids);
    if (ids.length) packEnter.mark(["pack"]);
    setListReady(true);
  }, [ready, items, enter.mark, packEnter.mark]);

  useEffect(() => {
    if (initialStats) return;
    void fetchChainStats().then((s) => {
      if (s) setStats(s);
    });
  }, [initialStats]);

  const loadRef = useRef(load);
  loadRef.current = load;
  const pageSeen = useRef(page);
  useEffect(() => {
    if (pageSeen.current === page) return;
    pageSeen.current = page;
    loadRef.current();
  }, [page]);

  useChainTipRefresh(true, () => {
    if (cursorRef.current !== null) return;
    load(true);
    void fetchChainStats().then((s) => {
      if (s) setStats(s);
    });
  });

  const s24 = stats?.stats24h;
  const miss = t("home.unavailable");
  const txs24 = s24?.txs ?? stats?.txPerDay ?? null;
  /**
   * Txs per block instead of "per epoch": the epoch figure was txs24 times a
   * constant 1.4222 (ERGO_EPOCH_LEN x 120s target / a day), so it restated the
   * first card in another unit. This divides by the blocks actually found.
   */
  const perBlock =
    txs24 != null && s24?.blocks != null && s24.blocks > 0
      ? Math.round((txs24 / s24.blocks) * 10) / 10
      : null;
  const txTotal = stats?.txTotal ?? null;

  const kpis = [
    {
      label: t("txs.kpiTxs24h"),
      value: txs24 != null ? txs24.toLocaleString(loc(locale)) : miss,
      compact: compactFigure(txs24),
      unavailable: txs24 == null,
      sub: t("blocks.kpiLast24h"),
      mark: <KpiMark id="tx" tone={INK.cyan} />,
      ink: INK.cyan,
      enter: 0,
    },
    {
      label: t("txs.kpiTotal"),
      value: txTotal != null ? txTotal.toLocaleString(loc(locale)) : miss,
      compact: compactFigure(txTotal),
      unavailable: txTotal == null,
      sub: t("txs.kpiTotalSub"),
      mark: <KpiMark id="tx-total" tone={INK.violet} />,
      ink: INK.violet,
      enter: 1,
    },
    {
      label: t("txs.kpiPerBlock"),
      value: perBlock != null ? perBlock.toLocaleString(loc(locale)) : miss,
      unavailable: perBlock == null,
      sub: t("txs.kpiPerBlockSub"),
      mark: <KpiMark id="per-block" tone={INK.teal} />,
      ink: INK.teal,
      enter: 2,
    },
    {
      label: t("txs.kpiFees24h"),
      value: s24?.feesErg != null ? `${formatCompact(s24.feesErg)} ERG` : miss,
      unavailable: s24?.feesErg == null,
      sub: t("blocks.kpiLast24h"),
      mark: <KpiMark id="fee" tone={INK.gold} />,
      ink: INK.gold,
      enter: 3,
    },
  ];

  /* Oracle posts, block rewards, fee collects: one «Служебные: N» row per day, opened per day. */
  const zone = useFeedZone();
  const [openDays, setOpenDays] = useState<ReadonlySet<string>>(() => new Set());
  const toggleDay = useCallback((day: string) => {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }, []);
  const tape: Array<TxListItem | TxFold<TxListItem>> = foldServiceRows(items, {
    dayOf: (row) => {
      const ms = toEpochMs(row.timestamp);
      return ms == null ? "unknown" : formatDottedDate(ms, zone);
    },
    actionOf: (row) => row.meaning?.action,
    isOpen: (day) => openDays.has(day),
  });

  return (
    <Shell>
      <KpiGrid items={kpis} dense className="mb-3 sm:grid-cols-4" />

      {err && (
        <p className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-200">
          {err}
        </p>
      )}

      {!listReady && !err ? null : !items.length && !err ? (
        <Feed>
          <FeedEmpty k="transfer" title={t("txs.empty")} />
        </Feed>
      ) : null}

      {listReady && items.length > 0 && (
        <div className="feed-sheet">
          <Feed busy={pending} enterClass={packEnter.enterClass("pack")}>
            <FeedDays
              items={tape}
              seconds
              msOf={(it) => toEpochMs(isTxFold(it) ? it.rows[0]!.timestamp : it.timestamp)}
              sizeOf={(it) => (isTxFold(it) ? (it.open ? 0 : it.rows.length) : 1)}
              countOf={(n) => <FeedCount k="feed.txCount" n={n} />}
              render={(row, lead) =>
                isTxFold(row) ? (
                  <FeedServiceFold key={row.key} fold={row} lead={lead} onToggle={() => toggleDay(row.day)} />
                ) : (
                <FeedTxRow
                  key={row.id}
                  row={row}
                  lead={lead}
                  showHeight
                  enterClass={enter.enterClass(row.id)}
                  fav={{
                    on: favIds?.includes(row.id) ?? false,
                    ready: favReady,
                    title: favIds?.includes(row.id) ? t("favorites.remove") : t("favorites.add"),
                    toggle: () => toggleFav(row.id),
                  }}
                />
                )
              }
            />
          </Feed>
          <RankWindow
            offset={page * TX_PACK}
            pageSize={TX_PACK}
            shown={items.length}
            total={txTotal != null && txTotal > 0 ? txTotal : null}
            scrub={false}
            hasMore={hasMore}
            loc={loc(locale)}
            ofLabel={t("addresses.packOf")}
            prevLabel={t("addresses.packPrev")}
            nextLabel={t("addresses.packNext")}
            tapeLabel={t("txs.packTape")}
            hint={t("txs.packHint")}
            disabled={pending}
            onOffset={(next) => {
              const cur = page * TX_PACK;
              if (next > cur) {
                const nxt = nextCursorRef.current;
                if (!hasMore || !nxt) return;
                cursorStack.current.push(cursorRef.current);
                cursorRef.current = nxt;
                setPage(cursorStack.current.length);
              } else if (next < cur) {
                if (!cursorStack.current.length) return;
                const prev = cursorStack.current.pop() ?? null;
                cursorRef.current = prev;
                setPage(cursorStack.current.length);
              }
            }}
          />
        </div>
      )}
    </Shell>
  );
}
