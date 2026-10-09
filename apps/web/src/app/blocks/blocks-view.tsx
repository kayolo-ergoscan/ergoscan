"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { KpiGrid } from "@/components/KpiGrid";
import { INK } from "@/lib/palette";
import {
  KpiMarkCircleGauge,
  KpiMarkRulerDimension,
  KpiMarkSquareStack,
  KpiMarkWorkflow,
} from "@/components/kpi-marks";
import { RankWindow } from "@/components/RankWindow";
import { getGateway } from "@/lib/config";
import { fetchChainStats, type ChainStats } from "@/lib/chain-stats";
import {
  formatBlockTime,
  formatBytes,
  formatDottedDate,
  formatErgPrecise,
  formatH24,
  formatRelTime,
  shortId,
  toEpochMs,
  splitBlockOutput,
  toBigIntAmt,
} from "@/lib/format";
import { lookupAddress } from "@/lib/address-book";
import { minerEmissionAtHeight, ERGO_EPOCH_LEN, ERGO_MAX_BLOCK_SIZE } from "@/lib/ergo-emission";
import clsx from "clsx";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { useChainTipRefresh, usePageSync } from "@/lib/page-sync";
import { SNAPSHOT_FETCH, enteringIds, snapshotPath, useEnterIds } from "@/lib/keyed-enter";
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
  const [stuck, setStuck] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [prevBlockTs, setPrevBlockTs] = useState<number | null>(initialOlderTs);
  const enter = useEnterIds();
  const packEnter = useEnterIds();
  const [listReady, setListReady] = useState(false);
  const opened = useRef(false);
  const cursorRef = useRef<string | null>(null);
  const cursorStack = useRef<(string | null)[]>([]);
  const nextCursorRef = useRef<string | null>(initialNextCursor);
  nextCursorRef.current = nextCursor;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const pinRef = useRef<HTMLDivElement>(null);

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
  }, [items.length]);

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
      mark: <KpiMarkSquareStack tone={INK.green} />,
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
      mark: <KpiMarkCircleGauge tone={INK.gold} />,
      ink: INK.gold,
      enter: 1,
    },
    {
      label: t("blocks.kpiInterval"),
      value: s24?.avgBlockMs != null ? formatBlockTime(s24.avgBlockMs) : miss,
      unavailable: s24?.avgBlockMs == null,
      sub: t("blocks.kpiTarget"),
      mark: <KpiMarkRulerDimension tone={INK.teal} />,
      enter: 2,
    },
    {
      label: t("blocks.kpiTxs24h"),
      value: s24?.txs != null ? s24.txs.toLocaleString(loc(locale)) : miss,
      unavailable: s24?.txs == null,
      sub: t("blocks.kpiLast24h"),
      mark: <KpiMarkWorkflow tone={INK.cyan} />,
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
        <p className="text-[var(--muted)]">{t("blocks.empty")}</p>
      ) : null}

      {listReady && items.length > 0 && (
        <div className="addr-sheet">
          <div ref={pinRef} className="h-px w-full" aria-hidden />
          <div className={packEnter.enterClass("pack")}>
          <div
            className={clsx(
              "addr-pan transition-opacity duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
              pending && "opacity-60"
            )}
          >
            <div
              className={clsx(
                "addr-head addr-lane addr-lane-x block-lane blocks-tape text-[12px] font-medium",
                stuck && "is-stuck"
              )}
            >
              <div className="block-lane-pair">
                <div className="min-w-0">{t("blocks.height")}</div>
                <div className="lithos-col" />
                <div className="min-w-0 justify-end">{t("blocks.txs")}</div>
              </div>
              <div className="block-lane-pair">
                <div className="min-w-0">{t("blocks.interval")}</div>
                <div className="min-w-0 justify-end">{t("blocks.blockTime")}</div>
              </div>
              <div className="block-lane-pair">
                <div className="min-w-0">{t("blocks.miner")}</div>
                <div className="min-w-0 justify-end">{t("blocks.transferred")}</div>
              </div>
              <div className="block-lane-pair">
                <div className="min-w-0">{t("blocks.id")}</div>
                <div className="min-w-0 justify-end">{t("blocks.size")}</div>
              </div>
            </div>
            {items.map((row, i) => {
              const olderTs =
                items[i + 1]?.timestamp ?? (i === items.length - 1 ? prevBlockTs : null);
              const delta = olderTs != null ? blockGapMs(row.timestamp, olderTs) : null;
              return (
                <BlockTapeRow
                  key={row.id}
                  row={row}
                  locale={locale}
                  miss={miss}
                  t={t}
                  now={now}
                  intervalMs={delta != null && delta > 0 ? delta : null}
                  enterClass={enter.enterClass(row.id)}
                  fav={favIds?.includes(row.id) ?? false}
                  favReady={favReady}
                  favTitle={favIds?.includes(row.id) ? t("favorites.remove") : t("favorites.add")}
                  onToggleFav={() => toggleFav(row.id)}
                />
              );
            })}
          </div>
          </div>
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

export function BlockTapeRow({
  row,
  locale,
  miss,
  t,
  now,
  intervalMs,
  enterClass,
  fav = false,
  favReady = true,
  favTitle,
  onToggleFav,
}: {
  row: BlockListItem;
  locale: string;
  miss: string;
  t: (k: string) => string;
  now: number;
  intervalMs: number | null;
  enterClass?: string;
  fav?: boolean;
  favReady?: boolean;
  favTitle?: string;
  onToggleFav?: () => void;
}) {
  const minerAddr = row.minerAddress && row.minerAddress.length ? row.minerAddress : null;
  const miner = minerAddr ? minerLabel(minerAddr, row.minerName) : "—";
  const rewardNano = minerEmissionAtHeight(row.height) + toBigIntAmt(row.feeNano);
  const out = splitBlockOutput(row.valueNano, row.userValueNano);
  const hasOut = hasAmt(row.userValueNano) || hasAmt(row.valueNano);
  return (
    <div
      className={clsx(
        "addr-lane addr-lane-x block-lane blocks-tape border-t border-[var(--border-soft)] py-2.5 text-[13px]",
        enterClass
      )}
      onPointerEnter={() => prefetchBlockCard(row.id)}
    >
      <div className="block-lane-pair">
        <div className="min-w-0 px-3">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href={`/block/${row.id}`}
              onFocus={() => prefetchBlockCard(row.id)}
              className="min-w-0 truncate font-mono tabular-nums text-accent hover:underline"
            >
              {row.height.toLocaleString(loc(locale))}
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
        </div>
        <div className="lithos-col">
          {row.lithos ? (
            <Link href="/lithos" title={t("block.chip.lithosHint")} className="chip-press inline-flex">
              <img
                src="/lithos-mark.png"
                alt=""
                width={18}
                height={18}
                className="h-[18px] w-[18px] object-contain"
              />
            </Link>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center justify-end gap-1.5 whitespace-nowrap px-3 text-right tabular-nums">
          {row.txCount === 1 ? (
            <span className="text-[11px] font-normal text-[var(--muted)]">{t("blocks.coinbaseOnly")}</span>
          ) : null}
          <span>{row.txCount != null ? row.txCount.toLocaleString(loc(locale)) : miss}</span>
        </div>
      </div>
      <div className="block-lane-pair">
        <div className="min-w-0 px-3">
          <p className="tabular-nums">{intervalMs != null ? formatBlockTime(intervalMs) : "—"}</p>
        </div>
        <div className="min-w-0 px-3 text-right">
          <BlockWhen ts={row.timestamp} now={now} />
        </div>
      </div>
      <div className="block-lane-pair">
        <div className="min-w-0 px-3">
          {minerAddr ? (
            <Link href={`/address/${minerAddr}`} className="block min-w-0 truncate text-accent hover:underline">
              {miner}
            </Link>
          ) : (
            <p className="truncate text-[var(--muted)]">{miner}</p>
          )}
          <p className="mt-0.5 truncate tabular-nums text-[12px] text-[var(--muted)]">
            {formatErgPrecise(rewardNano, locale)}
          </p>
        </div>
        <div className="min-w-0 px-3 text-right tabular-nums">
          <p className={clsx("tabular-nums", hasOut && "text-[var(--up)]")}>
            {hasOut ? formatErgPrecise(out.user, locale) : "—"}
          </p>
          {out.emission > 0n ? (
            <p className="mt-0.5 truncate tabular-nums text-[11px] text-[var(--muted)]">
              {formatErgPrecise(out.emission, locale)} {t("blocks.emission")}
            </p>
          ) : null}
        </div>
      </div>
      <div className="block-lane-pair">
        <div className="min-w-0 px-3">
          <Link
            href={`/block/${row.id}`}
            className="block whitespace-nowrap font-mono text-accent hover:underline"
          >
            {shortId(row.id, 8)}
          </Link>
        </div>
        <div className="min-w-0 px-3">
          <p className="text-right tabular-nums text-[var(--text)]">{formatBytes(row.size)}</p>
          <BlockSizeWave bytes={row.size} locale={locale} />
        </div>
      </div>
    </div>
  );
}

function BlockWhen({ ts, now }: { ts: number | null | undefined; now: number }) {
  const clock = formatH24(ts, undefined, true);
  const date = formatDottedDate(ts);
  if (clock === "—" || date === "—") {
    return <span className="text-[var(--muted)]">—</span>;
  }
  return (
    <div>
      <p suppressHydrationWarning className="tabular-nums text-[var(--text)]">
        {formatRelTime(ts, now)}
      </p>
      <p
        suppressHydrationWarning
        className="mt-0.5 whitespace-nowrap text-[11px] tabular-nums text-[var(--muted)]"
      >
        {clock} · {date}
      </p>
    </div>
  );
}

function sizePctLabel(pct: number, locale: string): string {
  const ru = locale === "ru";
  if (pct <= 0) return ru ? "0 %" : "0%";
  const body =
    pct < 0.1 ? pct.toFixed(2) : pct < 10 ? pct.toFixed(1) : String(Math.round(pct));
  const n = ru ? body.replace(".", ",") : body;
  return ru ? `${n} %` : `${n}%`;
}

function BlockSizeWave({
  bytes,
  locale,
}: {
  bytes: number;
  locale: string;
}) {
  const pct =
    bytes > 0 ? Math.min(100, (bytes / ERGO_MAX_BLOCK_SIZE) * 100) : 0;
  return (
    <div
      className="block-size-track"
      role="img"
      aria-label={sizePctLabel(pct, locale)}
    >
      <div className="block-size-liquid" style={{ width: `${pct}%` }}>
        <div
          className="block-size-waves"
          aria-hidden
          style={{ animationDelay: `${(bytes % 9) * -0.18}s` }}
        >
          <svg viewBox="0 0 120 8" preserveAspectRatio="none">
            <path
              fill="currentColor"
              d="M0 5c10-5 20 5 30 0s20 5 30 0 20 5 30 0 20 5 30 0v3H0z"
            />
          </svg>
          <svg viewBox="0 0 120 8" preserveAspectRatio="none">
            <path
              fill="currentColor"
              d="M0 5c10-5 20 5 30 0s20 5 30 0 20 5 30 0 20 5 30 0v3H0z"
            />
          </svg>
        </div>
      </div>
      <span className="block-size-pct">{sizePctLabel(pct, locale)}</span>
    </div>
  );
}
