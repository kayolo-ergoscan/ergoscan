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
import { formatCompact, formatDottedDate, formatGroupedNumber, toEpochMs } from "@/lib/format";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { useChainTipRefresh, usePageSync } from "@/lib/page-sync";
import { SNAPSHOT_FETCH, enteringIds, snapshotPath, useEnterIds, ENTER_MS } from "@/lib/keyed-enter";
import { TX_PACK, parseTxListItems, type TxListItem } from "@/lib/list-snapshots";
import { appendPack, keysetAfter, mergeHead, shouldFill, trimToFill } from "@/lib/tx-tape-fill";
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
  /** Txs on the pages before this one: a page is as many packs as it took to fill it. */
  const [pageOffset, setPageOffset] = useState(0);
  /** Packs this page has read (the fill stops at FILL_MAX_PACKS). */
  const [packs, setPacks] = useState(initialItems.length ? 1 : 0);
  const [filling, setFilling] = useState(false);
  const [fillFailed, setFillFailed] = useState(false);
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
  /** Where this page starts; null is the top of the chain. */
  const cursorRef = useRef<string | null>(null);
  const cursorStack = useRef<{ cursor: string | null; offset: number }[]>([]);
  const nextCursorRef = useRef<string | null>(initialNextCursor);
  nextCursorRef.current = nextCursor;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  /** Bumped when the page changes: a fill still in flight for the old page is dropped. */
  const pageGen = useRef(0);
  const fillAbort = useRef<AbortController | null>(null);
  const fillingRef = useRef(false);
  fillingRef.current = filling;

  const fetchPack = useCallback(async (cursor: string | null, signal?: AbortSignal) => {
    const q = new URLSearchParams({
      limit: String(TX_PACK),
      mempool: "0",
    });
    if (cursor) q.set("cursor", cursor);
    else q.set("offset", "0");
    const r = await fetch(`${getGateway()}${snapshotPath(`/v1/transactions/recent?${q}`, tipRef.current?.height)}`, {
      ...SNAPSHOT_FETCH,
      signal,
    });
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as {
      items?: TxListItem[];
      updatedAt?: string | null;
      hasMore?: boolean;
      nextCursor?: string | null;
    };
    const rows = parseTxListItems(j.items);
    const more = typeof j.hasMore === "boolean" ? j.hasMore : rows.length >= TX_PACK;
    const last = rows[rows.length - 1];
    const nxt =
      typeof j.nextCursor === "string" && j.nextCursor.length ? j.nextCursor : more && last ? keysetAfter(last) : null;
    return { rows, more, next: more ? nxt : null, updatedAt: j.updatedAt ?? null };
  }, []);

  /** A page from its first pack; `silent` is a new block on the first page (no dimming). */
  const load = useCallback(
    (silent = false) => {
      const want = cursorRef.current;
      // A new block while the first page is filling: the next block refreshes it.
      if (silent && fillingRef.current) return;
      const refresh = silent && want === null && itemsRef.current.length > 0;
      if (!refresh) {
        pageGen.current += 1;
        fillAbort.current?.abort();
        setFilling(false);
        setFillFailed(false);
      }
      const gen = pageGen.current;
      if (!silent && itemsRef.current.length) setPending(true);
      void fetchPack(want)
        .then((r) => {
          if (cursorRef.current !== want || gen !== pageGen.current) return;
          if (!r.rows.length && want) {
            const prev = cursorStack.current.pop();
            cursorRef.current = prev?.cursor ?? null;
            setPageOffset(prev?.offset ?? 0);
            setPage(cursorStack.current.length);
            return;
          }
          if (!r.rows.length && !want) {
            setErr(null);
            setReady(true);
            markSynced(r.updatedAt);
            return;
          }
          const merged = refresh ? mergeHead(itemsRef.current, r.rows) : null;
          if (merged) {
            // New rows on top of a filled page; it keeps about the same number of rows people made.
            const kept = trimToFill(merged);
            setItems((prev) => {
              enter.mark(enteringIds(prev, kept.rows));
              return kept.rows;
            });
            if (kept.cut) {
              setHasMore(true);
              setNextCursor(keysetAfter(kept.rows[kept.rows.length - 1]!));
            }
          } else {
            if (refresh) pageGen.current += 1;
            setItems((prev) => {
              enter.mark(enteringIds(prev, r.rows));
              return r.rows;
            });
            setPacks(1);
            setHasMore(r.more);
            setNextCursor(r.next);
            setFillFailed(false);
          }
          setErr(null);
          setReady(true);
          markSynced(r.updatedAt);
        })
        .catch((e) => {
          if (!silent) setErr(String(e));
          setReady(true);
        })
        .finally(() => {
          if (!silent) setPending(false);
        });
    },
    [enter.mark, fetchPack, markSynced]
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

  useEffect(() => () => fillAbort.current?.abort(), []);

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
      value: perBlock != null ? formatGroupedNumber(perBlock, 0, 1, locale) : miss,
      unavailable: perBlock == null,
      sub: t("txs.kpiPerBlockSub"),
      mark: <KpiMark id="per-block" tone={INK.teal} />,
      ink: INK.teal,
      enter: 2,
    },
    {
      label: t("txs.kpiFees24h"),
      value: s24?.feesErg != null ? `${formatCompact(s24.feesErg, 2, locale)} ERG` : miss,
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
  /** Rows on screen as rows: a fold summary is not one, an opened day's rows are. */
  const visible = tape.reduce((n, x) => (isTxFold(x) ? n : n + 1), 0);

  /*
   * While machine rows are folded a pack can show three rows. Pull the next pack, one request
   * at a time, until FILL_ROWS rows show or the page has read FILL_MAX_PACKS packs; an error
   * stops it for this page. Opening a day shows its rows, so nothing more is needed then.
   */
  useEffect(() => {
    if (!listReady || pending) return;
    if (!shouldFill({ visible, packs, hasMore, busy: filling, failed: fillFailed })) return;
    const cursor = nextCursorRef.current;
    if (!cursor) return;
    const gen = pageGen.current;
    const ac = new AbortController();
    fillAbort.current = ac;
    setFilling(true);
    void fetchPack(cursor, ac.signal)
      .then((r) => {
        if (gen !== pageGen.current) return;
        setItems((prev) => {
          const next = appendPack(prev, r.rows);
          enter.mark(enteringIds(prev, next));
          return next;
        });
        setPacks((n) => n + 1);
        setHasMore(r.more);
        setNextCursor(r.next);
      })
      .catch(() => {
        if (gen === pageGen.current && !ac.signal.aborted) setFillFailed(true);
      })
      .finally(() => {
        if (gen === pageGen.current) setFilling(false);
      });
  }, [listReady, pending, visible, packs, hasMore, filling, fillFailed, fetchPack, enter.mark]);

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
            offset={pageOffset}
            pageSize={Math.max(1, items.length)}
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
            disabled={pending || filling}
            onOffset={(next) => {
              if (next > pageOffset) {
                const nxt = nextCursorRef.current;
                if (!hasMore || !nxt) return;
                cursorStack.current.push({ cursor: cursorRef.current, offset: pageOffset });
                cursorRef.current = nxt;
                setPageOffset(pageOffset + items.length);
                setPage(cursorStack.current.length);
              } else if (next < pageOffset) {
                const prev = cursorStack.current.pop();
                if (!prev) return;
                cursorRef.current = prev.cursor;
                setPageOffset(prev.offset);
                setPage(cursorStack.current.length);
              }
            }}
          />
        </div>
      )}
    </Shell>
  );
}
