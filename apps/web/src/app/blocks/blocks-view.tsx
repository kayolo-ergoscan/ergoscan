"use client";

import { Tip } from "@/components/Tip";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { KpiGrid } from "@/components/KpiGrid";
import { INK } from "@/lib/palette";
import { KpiMark } from "@/components/kpi-marks";
import { RankWindow } from "@/components/RankWindow";
import {
  Feed,
  FeedAmount,
  FeedCount,
  FeedDays,
  FeedEmpty,
  FeedField,
  FeedFields,
  FeedIdLine,
  FeedMeter,
  FeedRow,
  type FeedLead,
} from "@/components/feed/Feed";
import { getGateway } from "@/lib/config";
import { fetchChainStats, type ChainStats } from "@/lib/chain-stats";
import {
  formatBlockTime,
  formatBytes,
  formatErgPrecise,
  formatRelTime,
  formatScaledAmount,
  formatStamp,
  shortId,
  toEpochMs,
  splitBlockOutput,
  formatPct,
  toBigIntAmt,
} from "@/lib/format";
import { lookupAddress } from "@/lib/address-book";
import { minerEmissionAtHeight, ERGO_EPOCH_LEN, ERGO_MAX_BLOCK_SIZE } from "@/lib/ergo-emission";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { useChainTipRefresh, usePageSync } from "@/lib/page-sync";
import { SNAPSHOT_FETCH, enteringIds, snapshotPath, useEnterIds, ENTER_MS } from "@/lib/keyed-enter";
import {
  BLOCK_PACK,
  type BlockListItem,
} from "@/lib/list-snapshots";
import { prefetchBlockCard, putBlockWindow } from "@/lib/block-list-cache";
import { useFavoriteList } from "@/lib/favorites";

const EXPECTED_BLOCKS_24H = 720;

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

/** How long this block took after the previous one. Both stamps may be s or ms. */
function blockGapMs(newer: number, older: number): number | null {
  const a = toEpochMs(newer);
  const b = toEpochMs(older);
  if (a == null || b == null) return null;
  const d = a - b;
  return d > 0 ? d : null;
}

export function BlocksView({
  initialItems,
  initialUpdatedAt = null,
  initialHasMore = false,
  initialNextCursor = null,
  initialOlderTs = null,
  initialStats = null,
}: {
  initialItems: BlockListItem[];
  initialUpdatedAt?: string | null;
  initialHasMore?: boolean;
  initialNextCursor?: string | null;
  initialOlderTs?: number | null;
  initialStats?: ChainStats | null;
}) {
  const t = useT();
  const { ids: favIds, toggle: toggleFav } = useFavoriteList("blocks");
  const favReady = favIds != null;
  const { locale } = useI18n();
  const { markSynced, tip } = usePageSync();
  const tipRef = useRef(tip);
  tipRef.current = tip;
  const [items, setItems] = useState<BlockListItem[]>(initialItems);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [page, setPage] = useState(0);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(initialItems.length > 0);
  const [err, setErr] = useState<string | null>(null);
  const [stats, setStats] = useState<ChainStats | null>(initialStats);
  const [now, setNow] = useState(() => Date.now());
  const [prevBlockTs, setPrevBlockTs] = useState<number | null>(initialOlderTs);
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

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const load = useCallback(
    (silent = false) => {
      if (!silent && itemsRef.current.length) setPending(true);
      const want = cursorRef.current;
      const gw = getGateway();
      const h = tipRef.current?.height;
      const q = new URLSearchParams({ limit: String(BLOCK_PACK) });
      if (want) q.set("cursor", want);
      else q.set("offset", "0");
      void fetch(`${gw}${snapshotPath(`/v1/blocks?${q}`, h)}`, SNAPSHOT_FETCH)
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json() as Promise<{
            items?: BlockListItem[];
            hasMore?: boolean;
            nextCursor?: string | null;
            olderTs?: unknown;
            updatedAt?: string | null;
            stale?: boolean;
          }>;
        })
        .then((j) => {
          if (cursorRef.current !== want) return;
          const next = Array.isArray(j.items) ? j.items : [];
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
          const more = typeof j.hasMore === "boolean" ? j.hasMore : next.length >= BLOCK_PACK;
          const nxt =
            typeof j.nextCursor === "string" && j.nextCursor.length
              ? j.nextCursor
              : more
                ? String(next[next.length - 1]?.height ?? "")
                : null;
          setItems((prev) => {
            enter.mark(enteringIds(prev, next));
            putBlockWindow(next);
            return next;
          });
          setHasMore(more);
          setNextCursor(more ? nxt || null : null);
          const older = typeof j.olderTs === "number" && Number.isFinite(j.olderTs) ? j.olderTs : null;
          setPrevBlockTs(older);
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
      putBlockWindow(initialItems);
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
  const tipHeight = stats?.height ?? (cursorRef.current == null ? items[0]?.height : null);
  const epoch =
    tipHeight != null && tipHeight >= 0 ? Math.floor(tipHeight / ERGO_EPOCH_LEN) : null;
  const kpis = [
    {
      label: t("blocks.kpiHeight"),
      value: tipHeight != null ? tipHeight.toLocaleString(loc(locale)) : miss,
      unavailable: tipHeight == null,
      sub:
        epoch != null
          ? t("blocks.kpiEpoch").replace("{n}", epoch.toLocaleString(loc(locale)))
          : "\u00a0",
      mark: <KpiMark id="height" tone={INK.green} />,
      ink: INK.green,
      enter: 0,
    },
    {
      label: t("blocks.kpiBlocks24h"),
      value: s24?.blocks != null ? s24.blocks.toLocaleString(loc(locale)) : miss,
      unavailable: s24?.blocks == null,
      sub:
        s24?.blocks != null
          ? t("blocks.kpiOfExpected")
              .replace("{n}", s24.blocks.toLocaleString(loc(locale)))
              .replace("{exp}", String(EXPECTED_BLOCKS_24H))
          : "\u00a0",
      mark: <KpiMark id="block" tone={INK.gold} />,
      ink: INK.gold,
      enter: 1,
    },
    {
      label: t("blocks.kpiInterval"),
      value: s24?.avgBlockMs != null ? formatBlockTime(s24.avgBlockMs) : miss,
      unavailable: s24?.avgBlockMs == null,
      sub: t("blocks.kpiTarget"),
      mark: <KpiMark id="interval" tone={INK.teal} />,
      enter: 2,
    },
    {
      label: t("blocks.kpiTxs24h"),
      value: s24?.txs != null ? s24.txs.toLocaleString(loc(locale)) : miss,
      unavailable: s24?.txs == null,
      sub: t("blocks.kpiLast24h"),
      mark: <KpiMark id="tx" tone={INK.cyan} />,
      ink: INK.cyan,
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

      {!listReady && !err ? null : !items.length && !err ? (
        <Feed>
          <FeedEmpty k="block" title={t("blocks.empty")} />
        </Feed>
      ) : null}

      {listReady && items.length > 0 && (
        <div className="feed-sheet">
          <Feed busy={pending} enterClass={packEnter.enterClass("pack")}>
            <FeedDays
              items={items}
              seconds
              msOf={(row) => toEpochMs(row.timestamp)}
              countOf={(n) => <FeedCount k="feed.blockCount" n={n} />}
              totalOf={(day) =>
                cursorRef.current == null && day[0] === items[0] && items[0]?.timestamp != null ? (
                  <span className="feed-plate-live">
                    {t("feed.lastBlock")}{" "}
                    <span className="tabular-nums" suppressHydrationWarning>
                      {formatRelTime(items[0].timestamp, now, locale)}
                    </span>
                  </span>
                ) : undefined
              }
              render={(row, lead) => {
                const i = items.indexOf(row);
                const olderTs =
                  items[i + 1]?.timestamp ?? (i === items.length - 1 ? prevBlockTs : null);
                const delta = olderTs != null ? blockGapMs(row.timestamp, olderTs) : null;
                return (
                  <FeedBlockRow
                    key={row.id}
                    row={row}
                    lead={lead}
                    now={now}
                    intervalMs={delta != null && delta > 0 ? delta : null}
                    enterClass={enter.enterClass(row.id)}
                    fav={{
                      on: favIds?.includes(row.id) ?? false,
                      ready: favReady,
                      title: favIds?.includes(row.id) ? t("favorites.remove") : t("favorites.add"),
                      toggle: () => toggleFav(row.id),
                    }}
                  />
                );
              }}
            />
          </Feed>
          <RankWindow
            offset={page * BLOCK_PACK}
            pageSize={BLOCK_PACK}
            shown={items.length}
            total={tipHeight != null && tipHeight > 0 ? tipHeight : null}
            scrub={false}
            hasMore={hasMore}
            loc={loc(locale)}
            ofLabel={t("addresses.packOf")}
            prevLabel={t("addresses.packPrev")}
            nextLabel={t("addresses.packNext")}
            tapeLabel={t("blocks.packTape")}
            hint={t("blocks.packHint")}
            disabled={pending}
            onOffset={(next) => {
              const cur = page * BLOCK_PACK;
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

function hasAmt(v: string | number | null | undefined): boolean {
  return v != null && v !== "";
}

function minerLabel(address: string | null | undefined, snapName: string | null | undefined): string {
  if (snapName) return snapName;
  const book = lookupAddress(address);
  if (book?.name) return book.name;
  if (!address) return "";
  if (address.length <= 14) return address;
  return `${address.slice(0, 2)}…${address.slice(-8)}`;
}

export function FeedBlockRow({
  row,
  lead,
  now,
  intervalMs,
  enterClass,
  fav,
}: {
  row: BlockListItem;
  lead: FeedLead;
  now: number;
  intervalMs: number | null;
  enterClass?: string;
  fav: { on: boolean; ready: boolean; title: string; toggle: () => void };
}) {
  const { t, tn, locale } = useI18n();
  const tag = loc(locale);
  const minerAddr = row.minerAddress && row.minerAddress.length ? row.minerAddress : null;
  const miner = minerAddr ? minerLabel(minerAddr, row.minerName) : null;
  const rewardNano = minerEmissionAtHeight(row.height) + toBigIntAmt(row.feeNano);
  const out = splitBlockOutput(row.valueNano, row.userValueNano);
  const hasOut = hasAmt(row.userValueNano) || hasAmt(row.valueNano);
  const pct = row.size > 0 ? Math.min(100, (row.size / ERGO_MAX_BLOCK_SIZE) * 100) : 0;
  const pctText = sizePctLabel(pct, locale);
  return (
    <FeedRow
      k="block"
      glyph="block"
      lead={lead}
      enterClass={enterClass}
      onPointerEnter={() => prefetchBlockCard(row.id)}
      title={
        <>
          <Link
            prefetch={false}
            href={`/block/${row.id}`}
            onFocus={() => prefetchBlockCard(row.id)}
            className="feed-name font-mono tabular-nums hover:underline"
          >
            {row.height.toLocaleString(tag)}
          </Link>
          {row.lithos ? (
            <Tip content={t("block.chip.lithosHint")} peek>
              <Link prefetch={false} href="/lithos" aria-label={t("block.chip.lithosHint")} className="chip-press inline-flex shrink-0">
                <img src="/lithos-mark.png" alt="" width={16} height={16} className="h-4 w-4 object-contain" />
              </Link>
            </Tip>
          ) : null}
          <FavoriteHeart size="sm" on={fav.on} ready={fav.ready} title={fav.title} onToggle={fav.toggle} />
        </>
      }
      facts={
        <>
          {row.txCount === 1 ? (
            <span>{t("blocks.coinbaseOnly")}</span>
          ) : row.txCount != null ? (
            <FeedCount k="feed.txCount" n={row.txCount} />
          ) : (
            <span>—</span>
          )}
          {minerAddr ? (
            <Link prefetch={false} href={`/address/${minerAddr}`} title={minerAddr} className="feed-party">
              {miner}
            </Link>
          ) : null}
          {intervalMs != null ? (
            <Tip content={t("blocks.interval")}>
              <span className="feed-mid tabular-nums">+{formatBlockTime(intervalMs)}</span>
            </Tip>
          ) : null}
          <span className="feed-wide font-mono tabular-nums">{shortId(row.id, 6)}</span>
        </>
      }
      chips={<FeedMeter pct={pct} label={pctText} title={`${t("blocks.size")} ${formatBytes(row.size)} · ${pctText}`} />}
      value={hasOut ? <FeedAmount raw={out.user} /> : <FeedAmount raw={null} />}
      sub={
        <>
          {t("feed.reward")} <span className="tabular-nums">{formatScaledAmount(rewardNano, 9, tag)}</span>
        </>
      }
      subMinor
      detail={() => (
        <FeedFields>
          <FeedField label={t("detail.block")} wide>
            <FeedIdLine href={`/block/${row.id}`} id={row.id} />
          </FeedField>
          <FeedField label={t("blocks.miner")} wide>
            {minerAddr ? (
              <span className="feed-id-line">
                <Link prefetch={false} href={`/address/${minerAddr}`} className="feed-id font-mono hover:underline">
                  {minerAddr}
                </Link>
                {miner && miner !== minerAddr ? <span className="text-[var(--muted-2)]">{miner}</span> : null}
              </span>
            ) : (
              "—"
            )}
          </FeedField>
          <FeedField label={t("address.colTime")}>
            <span className="tabular-nums" suppressHydrationWarning>
              {formatStamp(row.timestamp)} · {formatRelTime(row.timestamp, now, locale)}
            </span>
          </FeedField>
          <FeedField label={t("blocks.interval")}>
            <span className="tabular-nums">{intervalMs != null ? formatBlockTime(intervalMs) : "—"}</span>
          </FeedField>
          <FeedField label={t("feed.reward")}>
            <span className="tabular-nums">{formatErgPrecise(rewardNano, locale)}</span>
          </FeedField>
          <FeedField label={t("blocks.transferred")}>
            <span className="tabular-nums">
              {hasOut ? formatErgPrecise(out.user, locale) : "—"}
              {out.emission > 0n ? (
                <span className="text-[var(--muted-2)]">
                  {" "}
                  · {formatErgPrecise(out.emission, locale)} {t("blocks.emission")}
                </span>
              ) : null}
            </span>
          </FeedField>
          <FeedField label={t("blocks.size")}>
            <span className="tabular-nums">
              {tn("feed.bytes", row.size, row.size.toLocaleString(tag))} · {pctText}
            </span>
          </FeedField>
        </FeedFields>
      )}
    />
  );
}

function sizePctLabel(pct: number, locale: string): string {
  if (pct <= 0) return "0%";
  const d = pct < 0.1 ? 2 : pct < 10 ? 1 : 0;
  return formatPct(pct, locale, d, d);
}
