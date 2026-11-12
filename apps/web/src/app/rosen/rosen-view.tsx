"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ROSEN_CHAINS, ROSEN_CONTRACTS_VERSION } from "@ergoscan/shared";
import { AddrFactCard } from "@/components/AddrFactCard";
import { PrettyAmt } from "@/components/PrettyNum";
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
import {
  formatClockTime,
  formatDottedDate,
  formatH24,
  formatRelTime,
  relAgeTone,
  relAgeToneClass,
  shortId,
} from "@/lib/format";
import { rosenExplorer } from "@/lib/rosen-explorers";
import { INK } from "@/lib/palette";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { SNAPSHOT_FETCH, enteringIds, snapshotPath, useEnterIds } from "@/lib/keyed-enter";
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

function statusTone(status: string): string {
  if (status === "completed") return "bg-[var(--up)]/15 text-[var(--up)]";
  if (status === "fraud") return "bg-[#FF4D6D]/15 text-[#FF4D6D]";
  return "bg-[var(--wash)] text-[var(--muted)]";
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
  const [stuck, setStuck] = useState(false);
  const enter = useEnterIds();
  const packEnter = useEnterIds();
  const [listReady, setListReady] = useState(false);
  const opened = useRef(false);
  const pinRef = useRef<HTMLDivElement>(null);
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
      <div className="addr-sheet mt-2">
        {empty ? (
          <p className="mb-3 text-[var(--muted)]">
            {scanCaption ? t("rosen.emptyScan") : t("rosen.emptyTape")}
          </p>
        ) : null}
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
                  "addr-head addr-lane addr-lane-x block-lane rosen-tape text-[12px] font-medium",
                  stuck && "is-stuck"
                )}
              >
                <div className="block-lane-pair">
                  <div className="min-w-0">{t("rosen.col.route")}</div>
                  <div className="min-w-0 justify-end">{t("rosen.col.time")}</div>
                </div>
                <div className="block-lane-pair">
                  <div className="min-w-0">{t("rosen.col.from")}</div>
                  <div className="min-w-0 justify-end">{t("rosen.col.to")}</div>
                </div>
                <div className="block-lane-pair">
                  <div className="min-w-0">{t("rosen.col.status")}</div>
                  <div className="min-w-0 justify-end">{t("rosen.col.fees")}</div>
                </div>
                <div className="block-lane-pair">
                  <div className="min-w-0">{t("rosen.col.source")}</div>
                  <div className="min-w-0 justify-end">{t("rosen.col.trigger")}</div>
                </div>
              </div>
              {items.map((row) => (
                <RosenTapeRow
                  key={row.id}
                  row={row}
                  locale={locale}
                  t={t}
                  enterClass={enter.enterClass(row.id)}
                />
              ))}
            </div>
        </div>
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

function RosenWhen({ ts }: { ts: number | null | undefined }) {
  const { locale } = useI18n();
  const clock = formatH24(ts, undefined, true);
  const date = formatDottedDate(ts);
  if (clock === "—" || date === "—") {
    return <span className="text-[var(--muted)]">—</span>;
  }
  return (
    <div>
      <p className={clsx("whitespace-nowrap tabular-nums", relAgeToneClass(relAgeTone(ts)))}>
        {formatRelTime(ts, locale)}
      </p>
      <p className="mt-0.5 whitespace-nowrap text-[11px] tabular-nums text-[var(--muted)]">
        {clock} · {date}
      </p>
    </div>
  );
}

function RosenTapeRow({
  row,
  locale,
  t,
  enterClass,
}: {
  row: RosenEventItem;
  locale: string;
  t: (k: string) => string;
  enterClass?: string;
}) {
  const st = String(row.status || "processing");
  const stKey = `rosen.status.${st}`;
  const stLabel = t(stKey) !== stKey ? t(stKey) : st;
  const token = tokenOf(row);
  const dec = row.tokenDecimals ?? 0;
  const watchers =
    row.widsCount != null ? `${row.widsCount} ${t("rosen.col.watchers")}` : null;
  return (
    <div
      className={clsx(
        "addr-lane addr-lane-x block-lane rosen-tape border-t border-[var(--border-soft)] py-2.5 text-[13px]",
        enterClass
      )}
    >
      <div className="block-lane-pair">
        <div className="px-3">
          <span className="truncate font-medium">
            {row.fromChainLabel} → {row.toChainLabel}
          </span>
          <p className="mt-0.5 whitespace-nowrap text-[11px] leading-[1.15]">
            <span className="tabular-nums text-[var(--up)]">
              <PrettyAmt raw={row.amount} decimals={dec} locale={locale} />
            </span>
            <span className="text-[var(--muted)]"> {token}</span>
          </p>
        </div>
        <div className="min-w-0 px-3 text-right">
          <RosenWhen ts={row.time} />
        </div>
      </div>
      <div className="block-lane-pair">
        <div className="min-w-0 px-3">
          <RosenRef chain={row.fromChain} kind="address" raw={row.fromAddress} block />
          <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">{row.fromChainLabel}</p>
        </div>
        <div className="min-w-0 px-3 text-right">
          <RosenRef chain={row.toChain} kind="address" raw={row.toAddress} block />
          <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">{row.toChainLabel}</p>
        </div>
      </div>
      <div className="block-lane-pair">
        <div className="min-w-0 px-3">
          <span
            className={clsx(
              "inline-flex items-center rounded-md px-1.5 text-[10px] font-semibold uppercase leading-none tracking-wide",
              statusTone(st)
            )}
          >
            {stLabel}
          </span>
          <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
            {watchers ?? formatClockTime(row.time, locale)}
          </p>
        </div>
        <div className="min-w-0 px-3 text-right tabular-nums">
          <p className="whitespace-nowrap">
            {t("rosen.feeBridge")}{" "}
            <PrettyAmt raw={row.bridgeFee} decimals={dec} locale={locale} /> {token}
          </p>
          <p className="mt-0.5 truncate whitespace-nowrap text-[11px] text-[var(--muted)]">
            {t("rosen.feeNet")}{" "}
            <PrettyAmt raw={row.networkFee} decimals={dec} locale={locale} /> {token}
          </p>
        </div>
      </div>
      <div className="block-lane-pair">
        <div className="px-3">
          <RosenRef chain={row.fromChain} kind="tx" raw={row.sourceTxId} block />
          <p className="mt-0.5 whitespace-nowrap text-[11px] text-[var(--muted)]">
            {row.paymentTxId ? (
              <>
                {t("rosen.col.payment")}{" "}
                <RosenRef
                  chain={row.toChain}
                  kind="tx"
                  raw={row.paymentTxId}
                  chars={5}
                  nowrap
                />
              </>
            ) : (
              "—"
            )}
          </p>
        </div>
        <div className="min-w-0 px-3 text-right">
          <RosenRef chain="ergo" kind="tx" raw={row.triggerTxId} block />
          <p className="mt-0.5 tabular-nums text-[11px] text-[var(--muted)]">
            {row.height != null ? row.height.toLocaleString(loc(locale)) : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}
