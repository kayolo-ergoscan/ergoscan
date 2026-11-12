"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import clsx from "clsx";
import {
  RENT_SERIES_DAY_MS,
  fillRentRangeGaps,
  collectableRentNano,
  rentNanoToErg,
  rentYearSpan,
  rollupRentSeries,
  type RentSeriesPoint,
} from "@ergoscan/shared";
import { Shell } from "@/components/Shell";
import { AddressPageSkeleton } from "@/components/AddressPageSkeleton";
import { AddrFactCard } from "@/components/AddrFactCard";
import { EvidenceBadge } from "@/components/EvidenceBadge";
import {
  KpiMarkBadgePercent,
  KpiMarkCalendar,
  KpiMarkCalendarRange,
  KpiMarkCheckCheck,
  KpiMarkClock,
  KpiMarkListEnd,
  KpiMarkReceipt,
  KpiMarkUsers,
} from "@/components/kpi-marks";
import { KpiNum } from "@/components/KpiGrid";
import { RankWindow } from "@/components/RankWindow";
import { TokenLogo } from "@/components/TokenBadge";
import {
  formatCompact,
  describeRentErg,
  formatErg,
  formatErgFixed,
  formatGroupedNumber,
  formatTokenAmount,
  formatActivityStamp,
  formatRelTime,
  shortId,
  nanoErgToNumber,
  relAgeTone,
  relAgeToneClass,
} from "@/lib/format";
import { INK } from "@/lib/palette";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { countText } from "@/lib/i18n/messages";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";
import { SNAPSHOT_FETCH, enteringIds, useEnterIds } from "@/lib/keyed-enter";
import {
  RENT_PACK,
  type RentBoxRow,
  type RentDangerRow,
  type RentPageData,
  type RentWindow,
} from "@/lib/list-snapshots";
import { dangerHoldingUsd } from "@/lib/rent-danger";
import { getGateway } from "@/lib/config";
import { lookupAddress } from "@/lib/address-book";
import { NameMarquee } from "@/components/NameMarquee";
import { hasRentMinerRows, formatRentSharePct, rentShareOf } from "@/lib/rent-miner-pools";
import { rentRowTone } from "@/lib/rent-row-tone";
import { resolveTokenMeta, tokenAtRisk, tokenTickerInk } from "@/lib/token-meta";
import { RentMinerPools } from "@/components/RentMinerPools";

const ERG_LINE = "#5ee0a0";

const RentHistoryChart = dynamic(() => import("@/components/RentHistoryChart"), {
  ssr: false,
  loading: () => <div className="h-full min-h-[168px] w-full" />,
});

const BLOCKS_PER_YEAR = 262_980;
const BLOCKS_PER_DAY = 720;

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

function formatHorizon(blocks: number | null, locale: string, t: (k: string) => string): string {
  if (blocks == null) return "—";
  if (blocks <= 0) return t("rent.cap.now");
  if (blocks < 2000) {
    return countText(t, locale, "rent.status.inBlocks", blocks, blocks.toLocaleString(loc(locale)));
  }
  const years = blocks / BLOCKS_PER_YEAR;
  if (years >= 1) return `~${years.toFixed(1)}y`;
  const days = Math.max(1, Math.round(blocks / BLOCKS_PER_DAY));
  return `~${days}d`;
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
  const [tape, setTape] = useState<RentBoxRow[] | null>(null);
  const [claimOffset, setClaimOffset] = useState(0);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stuck, setStuck] = useState(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const enter = useEnterIds();
  const packEnter = useEnterIds();
  const [listReady, setListReady] = useState(false);
  const opened = useRef(false);
  const pinRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const painted = useRef(false);
  const tapeRef = useRef<RentBoxRow[] | null>(null);

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
    loadRef.current(false, 0, 0);
  }, [initial, markSynced, packKey]);

  useEffect(() => {
    if (opened.current) return;
    if (!data) return;
    opened.current = true;
    const ids = (data.items ?? []).map((row) => row.boxId);
    enter.mark(ids);
    if (ids.length) packEnter.mark(["pack"]);
    setListReady(true);
  }, [data, enter.mark, packEnter.mark]);

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
  }, [data?.items.length, offset]);

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
              mark={<KpiMarkListEnd className="h-9 w-9" />}
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
              mark={<KpiMarkClock className="h-9 w-9" />}
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
              mark={<KpiMarkCalendar className="h-9 w-9" />}
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
              mark={<KpiMarkCalendarRange className="h-9 w-9" />}
              window={data.next30d}
              covered={windowCovered(data.next30d, data.dueHeight, indexFloor)}
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
            <div className="addr-sheet">
            <div className="addr-pan kpi-tape">
            <div className="addr-head addr-lane addr-lane-x block-tx-pairs rent-tape text-[12px] font-medium">
              <div className="block-lane-pair rent-addr-pair">
                <div className="min-w-0">{t("rent.colWho")}</div>
              </div>
              <div className="block-lane-pair">
                <div className="min-w-0">{t("rent.recent")}</div>
                <div className="min-w-0 justify-end">{t("rent.colSeized")}</div>
              </div>
              <div className="block-lane-pair">
                <div className="min-w-0">{t("rent.colStatus")}</div>
                <div className="min-w-0 justify-end">{t("rent.colRent")}</div>
              </div>
              <div className="block-lane-pair rent-when-pair">
                <div className="min-w-0">{t("rent.colWhen")}</div>
                <div className="min-w-0 justify-end">{t("blocks.height")}</div>
              </div>
            </div>
            {data.collected?.recent?.length ? (
              data.collected.recent.map((row) => (
                <div
                  key={row.boxId}
                  className="addr-lane addr-lane-x block-tx-pairs rent-tape border-t border-[var(--border-soft)] py-2.5 text-[13px]"
                >
                  <div className="block-lane-pair rent-addr-pair">
                    <div className="min-w-0 px-3">
                      <ClaimWho row={row} t={t} />
                    </div>
                  </div>
                  <div className="block-lane-pair">
                    <div className="min-w-0 px-3">
                      <Link
                        prefetch={false}
                        href={`/box/${row.boxId}`}
                        title={row.boxId}
                        className="whitespace-nowrap font-mono text-accent hover:underline"
                      >
                        {shortId(row.boxId, 8)}
                      </Link>
                    </div>
                    <div className="flex min-w-0 items-center justify-end px-3">
                      <ClaimTickers tokens={row.tokens} t={t} />
                    </div>
                  </div>
                  <div className="block-lane-pair">
                    <div className="flex min-w-0 items-center px-3">
                      <ClaimStatus row={row} t={t} />
                    </div>
                    <div className="min-w-0 px-3 text-right">
                      <RentErg nano={row.rentNano} />
                    </div>
                  </div>
                  <div className="block-lane-pair rent-when-pair">
                    <div className="min-w-0 px-3">
                      <p className={clsx("whitespace-nowrap tabular-nums", relAgeToneClass(relAgeTone(row.spentTs)))}>
                        {formatRelTime(row.spentTs, locale)}
                      </p>
                      <p className="mt-0.5 whitespace-nowrap text-[12px] tabular-nums text-[var(--muted-2)]">
                        {formatActivityStamp(row.spentTs)}
                      </p>
                    </div>
                    <div className="flex min-w-0 items-center justify-end px-3">
                      <Link
                        prefetch={false}
                        href={`/block/${row.spentHeight}`}
                        className="whitespace-nowrap tabular-nums text-accent hover:underline"
                      >
                        {row.spentHeight.toLocaleString(loc(locale))}
                      </Link>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="px-3 py-4 text-[12px] text-[var(--muted)]">{t("rent.recentEmpty")}</p>
            )}
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
          </div>
          </>
          )}

          {pane === "upcoming" && (
          <>
          <RentDanger rows={data.danger ?? []} settled locale={locale} t={t} />
          {listReady && (
          <div className="mt-2 min-w-0">
            <div className="addr-sheet">
              <div ref={pinRef} className="h-px w-full" aria-hidden />
              <div className={packEnter.enterClass("pack")}>
              <div
                className={clsx(
                  "addr-pan kpi-tape transition-opacity duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                  pending && "opacity-60"
                )}
              >
                <div className={clsx("addr-head addr-lane addr-lane-x block-tx-pairs rent-tape text-[12px] font-medium", stuck && "is-stuck")}>
                  <div className="block-lane-pair rent-addr-pair">
                    <div className="min-w-0">{t("rent.colAddress")}</div>
                  </div>
                  <div className="block-lane-pair">
                    <div className="min-w-0">{t("rent.colSeized")}</div>
                    <div className="min-w-0 justify-end">{t("rent.colValue")}</div>
                  </div>
                  <div className="block-lane-pair">
                    <div className="min-w-0">{t("rent.colStatus")}</div>
                    <div className="min-w-0 justify-end">{t("rent.colRent")}</div>
                  </div>
                  <div className="block-lane-pair rent-when-pair">
                    <div className="min-w-0">{t("rent.colCreated")}</div>
                    <div className="min-w-0 justify-end">{t("blocks.height")}</div>
                  </div>
                </div>
                {items.map((row) => (
                  <RentRow
                    key={row.boxId}
                    row={row}
                    locale={locale}
                    t={t}
                    enterClass={enter.enterClass(row.boxId)}
                  />
                ))}
                {!items.length && tape != null && !pending && (
                  <p className="px-3 py-4 text-[13px] text-[var(--muted)]">
                    {t("rent.emptyTape")}
                  </p>
                )}
                <div ref={upcomingPager.endRef} className="h-px w-full" aria-hidden />
              </div>
              </div>
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

/** Same clip as the address tape: 10…10 on a wide row, 4…4 when the rail is open. */
function claimWho(row: { collector?: string | null; owner?: string | null }): {
  id: string | null;
  renewed: boolean;
} {
  const collector = row.collector?.trim() || "";
  const owner = row.owner?.trim() || "";
  if (collector) return { id: collector, renewed: false };
  if (owner) return { id: owner, renewed: true };
  return { id: null, renewed: false };
}

function ClaimWho({
  row,
  t,
}: {
  row: { collector?: string | null; owner?: string | null };
  t: (k: string) => string;
}) {
  const who = claimWho(row);
  if (!who.id) {
    return <span className="text-[var(--muted)]">{t("rent.poolsUncovered")}</span>;
  }
  return (
    <Link
      prefetch={false}
      href={`/address/${encodeURIComponent(who.id)}`}
      title={who.id}
      className="whitespace-nowrap font-mono text-accent hover:underline"
    >
      <TapeAddr id={who.id} />
    </Link>
  );
}

function ClaimStatus({
  row,
  t,
}: {
  row: { collector?: string | null; owner?: string | null };
  t: (k: string) => string;
}) {
  const renewed = claimWho(row).renewed;
  return (
    <span className={clsx("leading-tight", renewed ? "text-[#7eb6ff]" : "text-[#5ee0a0]")}>
      {renewed ? t("rent.status.renewed") : t("rent.status.collected")}
    </span>
  );
}

function TapeAddr({ id }: { id: string }) {
  return (
    <>
      <span className="lg:hidden">{shortId(id, 4)}</span>
      <span className="hidden lg:inline">{shortId(id, 10)}</span>
    </>
  );
}

function ClaimTickers({
  tokens,
  t,
}: {
  tokens?: { tokenId: string; name: string | null }[];
  t: (k: string) => string;
}) {
  const list = (tokens ?? []).filter((tok) => tokenAtRisk(tok.tokenId));
  if (!list.length) return <span className="text-[var(--muted)]">—</span>;
  const shown = list.slice(0, 3);
  const more = list.length - shown.length;
  return (
    <div className="flex max-w-full flex-wrap justify-end gap-x-1.5 gap-y-0.5 text-right">
      {shown.map((tok) => {
        const meta = resolveTokenMeta(tok.tokenId, null, tok.name);
        return (
          <Link
            prefetch={false}
            key={tok.tokenId}
            href={`/token/${encodeURIComponent(tok.tokenId)}`}
            title={meta.name}
            className="max-w-[6.5rem] truncate text-[12px] font-medium hover:underline"
            style={{ color: tokenTickerInk(tok.tokenId) }}
          >
            {meta.symbol}
          </Link>
        );
      })}
      {more > 0 ? (
        <span className="text-[12px] text-[var(--muted)]">
          {t("rent.moreTokens").replace("{n}", String(more))}
        </span>
      ) : null}
    </div>
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
  return (
    <section
      className={clsx(
        "mod flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--module)] max-lg:min-h-[19.25rem]",
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
          {last ? (
            <p className="m-0 flex h-[22px] shrink-0 flex-nowrap items-center justify-end gap-1.5 whitespace-nowrap">
              <span className="text-[12px] leading-[1.15] text-[var(--muted)]">
                {t("rent.chartLast.day")}
              </span>
              <KpiNum className="max-w-none shrink-0 tabular-nums text-[22px] font-semibold leading-[1.15] tracking-tight text-[var(--text)]">
                {`${formatGroupedNumber(lastErg, 2, 2)} ERG`}
              </KpiNum>
            </p>
          ) : null}
        </div>
        {show ? (
          <div className="min-h-0 flex-1 max-lg:min-h-[168px]">
            <RentHistoryChart
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
        mark={<KpiMarkCheckCheck className="h-9 w-9" />}
      >
        <div className="mt-0.5 leading-[1.15]">
          <KpiNum className="tabular-nums">
            {show && collected ? formatErgFixed(collected.rentNano, locale) : "—"}
          </KpiNum>
        </div>
        <p className="mt-0.5 text-[12px] leading-[1.15] text-[var(--muted-2)]" title={t("rent.cap.collectedHint")}>
          {collectedCaption(collected, t, locale)}
        </p>
      </AddrFactCard>
      <AddrFactCard
        enter={2}
        label={t("rent.kpi.claims")}
        ink={INK.coral}
        mark={<KpiMarkReceipt className="h-9 w-9" />}
      >
        <div className="mt-0.5 leading-[1.15]">
          <KpiNum className="tabular-nums">
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
        mark={<KpiMarkUsers className="h-9 w-9" />}
      >
        <div className="mt-0.5 leading-[1.15]">
          <KpiNum className="tabular-nums">{claimers > 0 ? claimers.toLocaleString(loc(locale)) : "—"}</KpiNum>
        </div>
        <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
          {t("rent.kpi.claimersHint")}
        </p>
      </AddrFactCard>
      <AddrFactCard
        enter={4}
        label={t("rent.kpi.lead")}
        ink={INK.gold}
        mark={<KpiMarkBadgePercent className="h-9 w-9" />}
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

function formatDangerUsd(n: number, locale: string): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1000) return `$${Math.round(n).toLocaleString(loc(locale))}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function RentErg({ nano }: { nano: string }) {
  const d = describeRentErg(nano);
  if (!d.tiny) return <span className="tabular-nums">{d.text}</span>;
  return (
    <span className="tabular-nums">
      {d.sign}0.0
      <span className="text-[0.85em]">({d.tiny.zeros})</span>
      {d.tiny.digits} ERG
    </span>
  );
}

function RentDanger({
  rows,
  settled,
  locale,
  t,
}: {
  rows: RentDangerRow[];
  settled: boolean;
  locale: string;
  t: (k: string) => string;
}) {
  return (
    <section
      className="home-tile-enter mod mt-2 min-w-0 max-w-full overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3.5 sm:px-5"
      style={{ "--enter": 5 } as CSSProperties}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center text-[var(--down)]" aria-hidden>
          <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-[-0.02em]">{t("rent.danger.title")}</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">
            {t("rent.danger.body")}
          </p>
        </div>
      </div>
      {rows.length ? (
        <ul
          className={clsx(
            "mt-3 divide-y divide-[var(--border-soft)]",
            rows.length > 5 && "max-h-[16.25rem] overflow-y-auto overscroll-contain"
          )}
        >
          {rows.map((row) => {
            const meta = resolveTokenMeta(row.tokenId, null, row.name);
            const usd = formatDangerUsd(dangerHoldingUsd(row), locale);
            const short = t("rent.danger.short").replace(
              "{n}",
              formatErgFixed(row.shortfallNano, locale, false)
            );
            const qty = formatTokenAmount(row.amount, row.decimals ?? 0, locale);
            const when =
              row.blocksUntilRent <= 0
                ? t("rent.status.waiting")
                : countText(
                    t,
                    locale,
                    "rent.status.inBlocks",
                    row.blocksUntilRent,
                    row.blocksUntilRent.toLocaleString(loc(locale))
                  );
            return (
              <li
                key={`${row.boxId}:${row.tokenId}`}
                className="grid h-[3.25rem] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Link prefetch={false} href={`/token/${row.tokenId}`} className="shrink-0" aria-label={meta.symbol}>
                    <TokenLogo tokenId={row.tokenId} size={28} />
                  </Link>
                  <span className="min-w-0">
                    <Link
                      prefetch={false}
                      href={`/token/${row.tokenId}`}
                      className="block truncate text-[14px] font-semibold tracking-[-0.02em] hover:underline"
                      style={{ color: tokenTickerInk(row.tokenId) }}
                    >
                      {meta.symbol}
                    </Link>
                    <span className="mt-0.5 block truncate text-[12px] text-[var(--muted)]">
                      {meta.name}
                      {" · "}
                      <Link prefetch={false} href={`/box/${row.boxId}`} className="text-accent hover:underline">
                        {when}
                      </Link>
                    </span>
                  </span>
                </div>
                <div className="min-w-[5.5rem] text-center text-[13px] font-medium tabular-nums text-[var(--ink)]">
                  {qty}
                </div>
                <div className="min-w-0 text-right">
                  <div className="text-[14px] font-semibold tabular-nums text-[var(--down)]">
                    {t("rent.danger.usd").replace("{n}", usd)}
                  </div>
                  <div className="mt-0.5 text-[12px] tabular-nums text-[var(--muted)]">{short}</div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        settled ? (
          <p className="mt-3 text-[13px] text-[var(--muted)]">{t("rent.danger.empty")}</p>
        ) : null
      )}
    </section>
  );
}

function RentWindowCard({
  enter,
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
          <KpiNum className="tabular-nums">{formatErgFixed(w.rentNano, locale)}</KpiNum>
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

function boxCannotPay(row: RentBoxRow): boolean {
  try {
    return BigInt(row.valueNano || "0") < BigInt(row.rentNano || "0");
  } catch {
    return false;
  }
}

function SeizedTokens({
  row,
  t,
}: {
  row: RentBoxRow;
  t: (k: string) => string;
}) {
  if (!boxCannotPay(row)) {
    return <span className="text-[var(--muted)]">—</span>;
  }
  const list = (row.tokens ?? []).filter((tok) => tokenAtRisk(tok.tokenId, tok.priceUsd));
  if (!list.length) {
    return <span className="text-[var(--muted)]">—</span>;
  }
  const shown = list.slice(0, 3);
  const more = list.length - shown.length;
  return (
    <div className="flex max-w-full flex-wrap gap-x-1.5 gap-y-0.5">
      {shown.map((tok) => {
        const meta = resolveTokenMeta(tok.tokenId, null, tok.name);
        return (
          <Link
            prefetch={false}
            key={tok.tokenId}
            href={`/token/${encodeURIComponent(tok.tokenId)}`}
            title={meta.name}
            className="max-w-[6.5rem] truncate text-[12px] font-medium hover:underline"
            style={{ color: tokenTickerInk(tok.tokenId) }}
          >
            {meta.symbol}
          </Link>
        );
      })}
      {more > 0 ? (
        <span className="text-[12px] text-[var(--muted)]">
          {t("rent.moreTokens").replace("{n}", String(more))}
        </span>
      ) : null}
    </div>
  );
}

function RentRow({
  row,
  locale,
  t,
  enterClass,
}: {
  row: RentBoxRow;
  locale: string;
  t: (k: string) => string;
  enterClass?: string;
}) {
  const href = row.address
    ? `/address/${encodeURIComponent(row.address)}`
    : `/box/${row.boxId}`;
  const name = row.address ? lookupAddress(row.address)?.name?.trim() || null : null;
  const inBlocks = countText(
    t,
    locale,
    "rent.status.inBlocks",
    row.blocksUntilRent,
    row.blocksUntilRent.toLocaleString(loc(locale))
  );
  const tone = rentRowTone(row);
  return (
    <div
      className={clsx(
        "addr-lane addr-lane-x block-tx-pairs rent-tape border-t border-[var(--border-soft)] py-2.5 text-[13px]",
        enterClass
      )}
    >
      <div className="block-lane-pair rent-addr-pair">
        <div className="min-w-0 overflow-hidden px-3">
          <Link
            prefetch={false}
            href={href}
            title={row.address || row.boxId}
            className="block min-w-0 overflow-hidden text-accent hover:underline"
          >
            {name ? (
              <NameMarquee text={name} className="min-w-0 w-full" />
            ) : (
              <span className="whitespace-nowrap font-mono">
                {row.address ? <TapeAddr id={row.address} /> : shortId(row.boxId, 8)}
              </span>
            )}
          </Link>
          {name && row.address ? (
            <p className="mt-0.5 truncate font-mono text-[11px] leading-none text-[var(--muted)]">
              <TapeAddr id={row.address} />
            </p>
          ) : null}
        </div>
      </div>
      <div className="block-lane-pair">
        <div className="flex min-w-0 items-center px-3">
          <SeizedTokens row={row} t={t} />
        </div>
        <div className="min-w-0 px-3 text-right text-[var(--up)]">
          <RentErg nano={row.valueNano} />
        </div>
      </div>
      <div className="block-lane-pair">
        <div className="flex min-w-0 items-center px-3">
          <span
            className={clsx(
              "leading-tight",
              tone === "due" && "text-[#ff8a65]",
              tone === "soon" && "text-[#f0c14a]",
              tone === "later" && "text-[#5ee0a0]"
            )}
            title={row.rentDue ? undefined : inBlocks}
          >
            {row.rentDue ? t("rent.status.waiting") : inBlocks}
          </span>
        </div>
        <div className="min-w-0 px-3 text-right">
          <RentErg nano={collectableRentNano(row.rentNano, row.valueNano)} />
        </div>
      </div>
      <div className="block-lane-pair rent-when-pair">
        <div className="min-w-0 px-3">
          <p className={clsx("whitespace-nowrap tabular-nums", relAgeToneClass(relAgeTone(row.creationTs)))}>
            {formatRelTime(row.creationTs, locale)}
          </p>
          <p className="mt-0.5 whitespace-nowrap text-[12px] tabular-nums text-[var(--muted-2)]">
            {formatActivityStamp(row.creationTs)}
          </p>
        </div>
        <div className="flex min-w-0 items-center justify-end px-3">
          <Link
            prefetch={false}
            href={`/block/${row.creationHeight}`}
            className="whitespace-nowrap tabular-nums text-accent hover:underline"
          >
            {row.creationHeight.toLocaleString(loc(locale))}
          </Link>
        </div>
      </div>
    </div>
  );
}
