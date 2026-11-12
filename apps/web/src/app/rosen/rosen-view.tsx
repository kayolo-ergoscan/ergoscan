"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ROSEN_CHAINS, ROSEN_CONTRACTS_VERSION } from "@ergoscan/shared";
import { AddrFactCard } from "@/components/AddrFactCard";
import {
  Feed,
  FeedAmount,
  FeedCopy,
  FeedCount,
  FeedDays,
  FeedEmpty,
  FeedField,
  FeedFields,
  FeedIdLine,
  FeedRow,
  feedLoc,
  type FeedLead,
} from "@/components/feed/Feed";
import { Shell } from "@/components/Shell";
import { KpiNum } from "@/components/KpiGrid";
import {
  KpiMarkBadgeCheck,
  KpiMarkPackage,
  KpiMarkPlug2,
  KpiMarkRoute,
} from "@/components/kpi-marks";
import { RankWindow } from "@/components/RankWindow";
import { getGateway } from "@/lib/config";
import { formatScaledAmount, formatTs, shortId, toEpochMs } from "@/lib/format";
import { rosenExplorer } from "@/lib/rosen-explorers";
import { INK } from "@/lib/palette";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { ENTER_MS, SNAPSHOT_FETCH, enteringIds, snapshotPath, useEnterIds } from "@/lib/keyed-enter";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";
import {
  ROSEN_PACK,
  parseRosenItems,
  type RosenEventItem,
  type RosenHealth,
} from "@/lib/list-snapshots";
function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function tokenOf(row: RosenEventItem): string {
  return row.tokenName || shortId(row.sourceChainTokenId || "—", 4);
}

export function RosenView({
  initialItems,
  initialNextCursor = null,
  initialHasMore = false,
  initialReady = false,
  initialHealth = null,
}: {
  initialItems: RosenEventItem[];
  initialNextCursor?: string | null;
  initialHasMore?: boolean;
  initialReady?: boolean;
  initialHealth?: RosenHealth | null;
}) {
  const t = useT();
  const { locale } = useI18n();
  const { markSynced, tip } = usePageSync();
  const tipRef = useRef(tip);
  tipRef.current = tip;
  const [items, setItems] = useState(initialItems);
  const [health, setHealth] = useState(initialHealth);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [pending, setPending] = useState(false);
  const [apiReady, setApiReady] = useState(initialReady);
  const [ready, setReady] = useState(initialItems.length > 0);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const served = initialItems.length > 0;
  const enter = useEnterIds(ENTER_MS, [], served);
  const packEnter = useEnterIds(ENTER_MS, [], served);
  const [listReady, setListReady] = useState(served);
  const opened = useRef(served);
  const cursorRef = useRef<string | null>(null);
  const cursorStack = useRef<(string | null)[]>([]);
  const nextCursorRef = useRef(initialNextCursor);
  nextCursorRef.current = nextCursor;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const statusRef = useRef(status);
  statusRef.current = status;
  const apiReadyRef = useRef(apiReady);
  apiReadyRef.current = apiReady;
  const miss = t("home.unavailable");

  const load = useCallback(
    (silent = false) => {
      if (!silent && itemsRef.current.length) setPending(true);
      const want = cursorRef.current;
      const q = new URLSearchParams({ limit: String(ROSEN_PACK) });
      if (statusRef.current) q.set("status", statusRef.current);
      if (want) q.set("cursor", want);
      void fetch(
        `${getGateway()}${snapshotPath(`/v1/rosen/events?${q}`, tipRef.current?.height)}`,
        SNAPSHOT_FETCH
      )
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json() as Promise<{
            items?: unknown;
            nextCursor?: string | null;
            hasMore?: boolean;
            ready?: boolean;
          }>;
        })
        .then((j) => {
          if (cursorRef.current !== want) return;
          const next = parseRosenItems(j.items);
          if (j.ready === false && !next.length) {
            setApiReady(false);
            setReady(true);
            setItems([]);
            setHasMore(false);
            setNextCursor(null);
            markSynced();
            return;
          }
          const more = Boolean(j.hasMore);
          setApiReady(true);
          setReady(true);
          setItems((prev) => {
            const fresh = enteringIds(prev, next);
            enter.mark(fresh);
            if (!silent && fresh.length) packEnter.mark(["pack"]);
            return next;
          });
          setHasMore(more);
          setNextCursor(more ? j.nextCursor ?? null : null);
          markSynced();
        })
        .catch(() => {
          setReady(true);
        })
        .finally(() => {
          if (!silent) setPending(false);
        });
    },
    [enter.mark, packEnter.mark, markSynced]
  );

  const painted = useRef(false);
  useEffect(() => {
    if (painted.current) return;
    painted.current = true;
    if (initialItems.length) {
      markSynced();
      return;
    }
    load();
  }, [initialItems.length, load, markSynced]);

  useEffect(() => {
    if (opened.current) return;
    if (!ready && !items.length) return;
    opened.current = true;
    const ids = items.map((row) => row.id);
    enter.mark(ids);
    if (ids.length) packEnter.mark(["pack"]);
    setListReady(true);
  }, [ready, items, enter.mark, packEnter.mark]);

  const loadRef = useRef(load);
  loadRef.current = load;
  const pageSeen = useRef(page);
  useEffect(() => {
    if (pageSeen.current === page) return;
    pageSeen.current = page;
    loadRef.current();
  }, [page]);

  useKeepFresh(() => {
    if (cursorRef.current !== null) return;
    load(true);
    void fetch(`${getGateway()}/v1/rosen/health`, SNAPSHOT_FETCH)
      .then((r) => (r.ok ? (r.json() as Promise<RosenHealth>) : null))
      .then((j) => {
        if (!j) return;
        setHealth(j);
        if (j.ready === true && !apiReadyRef.current) {
          setApiReady(true);
          apiReadyRef.current = true;
          load(true);
        }
      })
      .catch(() => {
        /* keep last */
      });
  });


  const onFilter = (next: string) => {
    if (next === status) return;
    setStatus(next);
    statusRef.current = next;
    cursorRef.current = null;
    cursorStack.current = [];
    setPage(0);
    setNextCursor(null);
    load();
  };

  const shownHealth = health;
  const scanH = shownHealth?.scanHeight ?? null;
  const tipH = shownHealth?.tipHeight ?? null;
  const catchingUp =
    scanH != null && tipH != null && Number.isFinite(scanH) && Number.isFinite(tipH) && scanH + 3 < tipH;
  const scanCaption =
    catchingUp && scanH != null
      ? t("rosen.scanning").replace("{h}", scanH.toLocaleString(loc(locale)))
      : null;
  const kpiValue = (n: number | null | undefined) => {
    if (n == null && shownHealth == null) return miss;
    return (n ?? 0).toLocaleString(loc(locale));
  };
  const kpiMiss = (n: number | null | undefined) => n == null && shownHealth == null;
  const kpiSub = (live: string) => scanCaption ?? live;

  const empty = !items.length && !pending;
  const filterTotal =
    status === ""
      ? health?.eventsTotal ?? null
      : status === "completed"
        ? health?.completed ?? null
        : health?.processing ?? null;

  return (
    <Shell>
      <div className="addr-lane">
        <AddrFactCard
          enter={0}
          label={t("rosen.card.bridge")}
          ink={INK.cyan}
          mark={<KpiMarkPlug2 className="h-9 w-9" />}
          selected={status === ""}
          onSelect={() => onFilter("")}
        >
          <h1 className="mt-0.5 truncate text-[17px] font-semibold leading-[1.15] tracking-tight">
            {t("nav.rosen")}
          </h1>
          <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
            {scanCaption ??
              `${ROSEN_CONTRACTS_VERSION} · ${ROSEN_CHAINS.length} ${t("rosen.card.chains")}`}
          </p>
        </AddrFactCard>

        <RosenMini
          enter={1}
          label={t("rosen.kpiDone")}
          value={kpiValue(shownHealth?.completed)}
          miss={kpiMiss(shownHealth?.completed)}
          sub={kpiSub(t("rosen.kpiDoneSub"))}
          ink={INK.green}
          mark={<KpiMarkBadgeCheck className="h-9 w-9" />}
          selected={status === "completed"}
          onSelect={() => onFilter("completed")}
        />
        <RosenMini
          enter={2}
          label={t("rosen.kpiLive")}
          value={kpiValue(shownHealth?.processing)}
          miss={kpiMiss(shownHealth?.processing)}
          sub={kpiSub(t("rosen.kpiLiveSub"))}
          ink={INK.gold}
          mark={<KpiMarkPackage className="h-9 w-9" />}
          selected={status === "processing"}
          onSelect={() => onFilter("processing")}
        />
        <RosenMini
          enter={3}
          label={t("rosen.kpiRoutes")}
          value={kpiValue(shownHealth?.routes)}
          miss={kpiMiss(shownHealth?.routes)}
          sub={kpiSub(t("rosen.kpiRoutesSub"))}
          ink={INK.violet}
          mark={<KpiMarkRoute className="h-9 w-9" />}
        />
      </div>

      {listReady ? (
        <div className="feed-sheet mt-2">
          <Feed busy={pending} enterClass={packEnter.enterClass("pack")}>
            {empty ? (
              <FeedEmpty k="bridge" title={scanCaption ? t("rosen.emptyScan") : t("rosen.emptyTape")} />
            ) : (
              <FeedDays
                items={items}
                msOf={(row) => toEpochMs(row.time)}
                countOf={(n) => <FeedCount k="feed.events" n={n} />}
                render={(row, lead) => (
                  <FeedRosenRow key={row.id} row={row} lead={lead} enterClass={enter.enterClass(row.id)} />
                )}
              />
            )}
          </Feed>
          <RankWindow
            offset={page * ROSEN_PACK}
            pageSize={ROSEN_PACK}
            shown={items.length}
            total={filterTotal}
            hasMore={hasMore}
            loc={loc(locale)}
            ofLabel={t("addresses.packOf")}
            prevLabel={t("addresses.packPrev")}
            nextLabel={t("addresses.packNext")}
            tapeLabel={t("rosen.packTape")}
            hint={scanCaption ?? t("rosen.packHint")}
            disabled={pending}
            onOffset={(next) => {
              const cur = page * ROSEN_PACK;
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
      ) : null}
    </Shell>
  );
}

function RosenMini({
  enter,
  label,
  value,
  miss,
  sub,
  ink,
  mark,
  selected,
  onSelect,
}: {
  enter: number;
  label: string;
  value: string;
  miss: boolean;
  sub: string;
  ink: string;
  mark: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
}) {
  return (
    <AddrFactCard
      enter={enter}
      label={label}
      ink={ink}
      mark={mark}
      selected={selected}
      onSelect={onSelect}
    >
      <p
        className={clsx(
          "mt-0.5 text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight",
          miss && "text-[var(--muted)]"
        )}
      >
        <KpiNum>{value}</KpiNum>
      </p>
      <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">{sub}</p>
    </AddrFactCard>
  );
}

function RosenRef({
  chain,
  kind,
  raw,
  block,
  chars = 6,
  nowrap = false,
}: {
  chain?: string | null;
  kind: "address" | "tx";
  raw: string | null | undefined;
  block?: boolean;
  /** Visible chars on each side of the ellipsis. */
  chars?: number;
  nowrap?: boolean;
}) {
  if (!raw) return <span className="text-[var(--muted)]">—</span>;
  const hit = rosenExplorer(chain, kind, raw);
  const label = shortId(hit?.label || raw, chars);
  const cls = clsx(
    nowrap ? "whitespace-nowrap" : "truncate",
    "font-mono text-[12px]",
    block && "block",
    hit && "text-accent hover:underline"
  );
  if (!hit) return <span className={cls}>{label}</span>;
  if (hit.external) {
    return (
      <a href={hit.href} target="_blank" rel="noopener noreferrer" className={cls}>
        {label}
      </a>
    );
  }
  return (
    <Link prefetch={false} href={hit.href} className={cls}>
      {label}
    </Link>
  );
}

/** A full id from any chain in a detail field: wraps, links out when the chain has an explorer, copies. */
function RosenIdLine({ chain, kind, raw }: { chain?: string | null; kind: "address" | "tx"; raw: string | null | undefined }) {
  if (!raw) return <span className="text-[var(--muted)]">—</span>;
  const hit = rosenExplorer(chain, kind, raw);
  const label = hit?.label || raw;
  const cls = "feed-id font-mono tabular-nums hover:underline";
  return (
    <span className="feed-id-line">
      {!hit ? (
        <span className="feed-id font-mono tabular-nums">{label}</span>
      ) : hit.external ? (
        <a href={hit.href} target="_blank" rel="noopener noreferrer" className={cls}>
          {label}
        </a>
      ) : (
        <Link prefetch={false} href={hit.href} className={cls}>
          {label}
        </Link>
      )}
      <FeedCopy text={raw} />
    </span>
  );
}

function bigOf(raw: string | null | undefined): bigint | null {
  if (!raw) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

/**
 * One bridge event: the route is the title, the amount the figure, the fee under it.
 * Processing events keep a hollow tile until the payment lands.
 */
function FeedRosenRow({ row, lead, enterClass }: { row: RosenEventItem; lead: FeedLead; enterClass?: string }) {
  const t = useT();
  const { locale, tn } = useI18n();
  const L = loc(locale);
  const st = String(row.status || "processing");
  const stKey = `rosen.status.${st}`;
  const stLabel = t(stKey) !== stKey ? t(stKey) : st;
  const token = tokenOf(row);
  const dec = row.tokenDecimals ?? 0;
  const amount = bigOf(row.amount);
  const bridgeFee = bigOf(row.bridgeFee);
  const netFee = bigOf(row.networkFee);
  const fee = bridgeFee != null || netFee != null ? (bridgeFee ?? 0n) + (netFee ?? 0n) : null;
  const height =
    row.height != null ? (
      <Link prefetch={false} href={`/block/${row.height}`} className="tabular-nums">
        {row.height.toLocaleString(L)}
      </Link>
    ) : null;
  const feeText = (n: bigint | null) =>
    n == null ? "—" : `${formatScaledAmount(n, dec, feedLoc(locale), dec)} ${token}`;
  return (
    <FeedRow
      k="bridge"
      glyph="bridge"
      hollow={st !== "completed"}
      tileTitle={stLabel}
      lead={lead}
      leadSub={!lead.same && height ? height : undefined}
      className="is-route"
      enterClass={enterClass}
      title={
        <span className="feed-name font-semibold">
          {row.fromChainLabel} → {row.toChainLabel}
        </span>
      }
      facts={
        <>
          <span className={clsx("feed-kind", st === "fraud" && "is-alarm", st === "processing" && "is-off")}>
            {stLabel}
          </span>
          {height ? <span className="feed-phone-only">{height}</span> : null}
          <span className="feed-mid">
            <RosenRef chain={row.fromChain} kind="address" raw={row.fromAddress} chars={5} nowrap />
            {" → "}
            <RosenRef chain={row.toChain} kind="address" raw={row.toAddress} chars={5} nowrap />
          </span>
          {row.widsCount != null ? (
            <span className="feed-wide">
              {tn("rosen.col.watchers", row.widsCount, row.widsCount.toLocaleString(L))}
            </span>
          ) : null}
        </>
      }
      value={<FeedAmount raw={amount} decimals={dec} unit={token} glance />}
      sub={
        fee != null ? (
          <>
            {t("feed.fee")}{" "}
            <FeedAmount raw={fee} decimals={dec} unit={token} glance />
          </>
        ) : null
      }
      detail={() => (
        <FeedFields>
          <FeedField label={`${t("rosen.col.from")} · ${row.fromChainLabel}`} wide>
            <RosenIdLine chain={row.fromChain} kind="address" raw={row.fromAddress} />
          </FeedField>
          <FeedField label={`${t("rosen.col.to")} · ${row.toChainLabel}`} wide>
            <RosenIdLine chain={row.toChain} kind="address" raw={row.toAddress} />
          </FeedField>
          <FeedField label={t("rosen.col.source")} wide>
            <RosenIdLine chain={row.fromChain} kind="tx" raw={row.sourceTxId} />
          </FeedField>
          {row.paymentTxId ? (
            <FeedField label={t("rosen.col.payment")} wide>
              <RosenIdLine chain={row.toChain} kind="tx" raw={row.paymentTxId} />
            </FeedField>
          ) : null}
          {row.triggerTxId ? (
            <FeedField label={t("rosen.col.trigger")} wide>
              <FeedIdLine href={`/tx/${row.triggerTxId}`} id={row.triggerTxId} />
            </FeedField>
          ) : null}
          <FeedField label={t("rosen.col.amount")}>
            <span className="tabular-nums">{feeText(amount)}</span>
          </FeedField>
          <FeedField label={t("rosen.col.fees")}>
            <span className="tabular-nums">
              {t("rosen.feeBridge")} {feeText(bridgeFee)}
              <span className="text-[var(--muted-2)]">
                {" · "}
                {t("rosen.feeNet")} {feeText(netFee)}
              </span>
            </span>
          </FeedField>
          <FeedField label={t("rosen.col.time")}>
            <span className="tabular-nums" suppressHydrationWarning>
              {row.time != null ? formatTs(row.time) : "—"}
              {height ? (
                <span className="text-[var(--muted-2)]">
                  {" · "}
                  {height}
                </span>
              ) : null}
            </span>
          </FeedField>
        </FeedFields>
      )}
    />
  );
}
