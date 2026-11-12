"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import { KpiNum, KpiTileRail } from "@/components/KpiGrid";
import { RankWindow } from "@/components/RankWindow";
import {
  KpiMarkCoins,
  KpiMarkHolders,
  KpiMarkLocked,
  KpiMarkSquareStack,
} from "@/components/kpi-marks";
import { useT, useI18n } from "@/lib/i18n/I18nProvider";
import { getGateway } from "@/lib/config";
import {
  formatFactWhen,
  formatRelTime,
  formatTokenAmount,
  relAgeTone,
  relAgeToneClass,
  shortId,
} from "@/lib/format";
import { lookupAddress } from "@/lib/address-book";
import { LITHOS_LINKS } from "@/lib/lithos-links";
import { HOME, INK } from "@/lib/palette";
import { SNAPSHOT_FETCH, enteringIds, useEnterIds } from "@/lib/keyed-enter";

const PACK = 25;

export type LithosFindItem = {
  height: number;
  blockId: string;
  txId: string;
  ts: number | null;
  finderAddress: string;
  finderLit: string;
  finderNano: string;
  lenderAddress: string;
  permitLit: string;
  holdingAddress: string;
  holdingLit: string;
  teamLit: string;
  investorLit: string;
  auditorLit: string;
};

export type LithosProtocolSnap = {
  finds: number;
  finders: number;
  finderLit: string;
  holdingLit: string;
  teamLit: string;
  investorLit: string;
  auditorLit: string;
  items: LithosFindItem[];
  hasMore: boolean;
  nextCursor: string | null;
};

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function lit(raw: string, locale: string): string {
  return formatTokenAmount(raw, 9, locale);
}

function keepAmt(next: string | undefined, prev: string | undefined): string {
  if (next && next !== "0") return next;
  return prev && prev !== "0" ? prev : "0";
}

function LithosKpi({
  label,
  value,
  sub,
  ink,
  enter,
  mark,
}: {
  label: string;
  value: string;
  sub: string;
  ink: string;
  enter: number;
  mark: ReactNode;
}) {
  return (
    <div
      className="kpi-tile kpi-tile--dense flex h-auto min-w-0 overflow-visible rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-3 py-1.5"
      style={{ "--kpi-ink": ink, "--enter": enter } as CSSProperties}
    >
      <KpiTileRail />
      <div className="kpi-tile-row flex w-full min-w-0 flex-1 justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-[1.15]" style={{ color: HOME.forming }}>
            {label}
          </p>
          <p className="mt-0.5 truncate text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight">
            <KpiNum>{value}</KpiNum>
          </p>
          <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">{sub}</p>
        </div>
        <div className="kpi-tile-mark">{mark}</div>
      </div>
    </div>
  );
}

function FindWhen({ ts }: { ts: number | null }) {
  const { locale } = useI18n();
  const rel = formatRelTime(ts, locale);
  const stamp = formatFactWhen(ts);
  if (rel === "—" && stamp === "—") return <span className="text-[var(--muted)]">—</span>;
  return (
    <>
      <p
        suppressHydrationWarning
        className={clsx("whitespace-nowrap tabular-nums", relAgeToneClass(relAgeTone(ts)))}
      >
        {rel}
      </p>
      <p
        suppressHydrationWarning
        className="mt-0.5 whitespace-nowrap text-[12px] tabular-nums text-[var(--muted-2)]"
      >
        {stamp}
      </p>
    </>
  );
}

function Addr({ address }: { address: string }) {
  if (!address) return <span className="text-[var(--muted)]">—</span>;
  const name = lookupAddress(address)?.name;
  return (
    <Link
      prefetch={false}
      href={`/address/${address}`}
      title={name ? `${name} · ${address}` : address}
      className={clsx(
        "block min-w-0 truncate text-accent hover:underline",
        !name && "font-mono"
      )}
    >
      {name || shortId(address, 6)}
    </Link>
  );
}

export function LithosProtocolView({ initial }: { initial: LithosProtocolSnap | null }) {
  const t = useT();
  const { locale } = useI18n();
  const [snap, setSnap] = useState(initial);
  const [share, setShare] = useState(initial?.items[0] ?? null);
  const [pending, setPending] = useState(false);
  const [page, setPage] = useState(0);
  const [stuck, setStuck] = useState(false);
  const [listReady, setListReady] = useState(false);
  const enter = useEnterIds();
  const packEnter = useEnterIds();
  const opened = useRef(false);
  const cursorRef = useRef<string | null>(null);
  const cursorStack = useRef<(string | null)[]>([]);
  const nextCursorRef = useRef<string | null>(initial?.nextCursor ?? null);
  const hasMoreRef = useRef(initial?.hasMore === true);
  const pinRef = useRef<HTMLDivElement>(null);
  const items = snap?.items ?? [];
  const itemsRef = useRef(items);
  itemsRef.current = items;
  nextCursorRef.current = snap?.nextCursor ?? null;
  hasMoreRef.current = snap?.hasMore === true;

  const load = useCallback(
    async (cursor: string | null) => {
      if (itemsRef.current.length) setPending(true);
      try {
        const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
        const r = await fetch(`${getGateway()}/v1/lithos${q}`, SNAPSHOT_FETCH);
        if (!r.ok) return;
        const body = (await r.json()) as LithosProtocolSnap;
        if (!cursor && body.items?.[0]) setShare(body.items[0]);
        const next = body.items ?? [];
        setSnap((prev) => {
          enter.mark(
            enteringIds(
              (prev?.items ?? []).map((row) => ({ id: String(row.height) })),
              next.map((row) => ({ id: String(row.height) }))
            )
          );
          return {
            finds: body.finds || prev?.finds || 0,
            finders: body.finders || prev?.finders || 0,
            finderLit: keepAmt(body.finderLit, prev?.finderLit),
            holdingLit: keepAmt(body.holdingLit, prev?.holdingLit),
            teamLit: keepAmt(body.teamLit, prev?.teamLit),
            investorLit: keepAmt(body.investorLit, prev?.investorLit),
            auditorLit: keepAmt(body.auditorLit, prev?.auditorLit),
            items: next,
            hasMore: body.hasMore === true,
            nextCursor: body.nextCursor,
          };
        });
      } finally {
        setPending(false);
      }
    },
    [enter.mark]
  );

  useEffect(() => {
    if (opened.current) return;
    if (!items.length) {
      setListReady(true);
      return;
    }
    opened.current = true;
    enter.mark(items.map((row) => String(row.height)));
    packEnter.mark(["pack"]);
    setListReady(true);
  }, [items, enter.mark, packEnter.mark]);

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
  }, [items.length, listReady]);

  const privateLine = t("lithosP.private")
    .replace("{team}", lit(share?.teamLit ?? "0", locale))
    .replace("{inv}", lit(share?.investorLit ?? "0", locale))
    .replace("{aud}", lit(share?.auditorLit ?? "0", locale));
  const miss = "—";
  const L = loc(locale);

  return (
    <Shell>
      <div className="addr-drop lithos-hero mb-3 grid items-stretch gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="grid grid-cols-2 content-start gap-2">
          <LithosKpi
            label={t("lithosP.blocks")}
            value={snap ? snap.finds.toLocaleString(L) : miss}
            sub={t("lithosP.blocksSub")}
            ink={INK.violet}
            enter={0}
            mark={<KpiMarkSquareStack tone={INK.violet} />}
          />
          <LithosKpi
            label={t("lithosP.finders")}
            value={snap ? snap.finders.toLocaleString(L) : miss}
            sub={t("lithosP.findersSub")}
            ink={INK.cyan}
            enter={1}
            mark={<KpiMarkHolders tone={INK.cyan} />}
          />
          <LithosKpi
            label={t("lithosP.finderLit")}
            value={snap ? lit(snap.finderLit, locale) : miss}
            sub={t("lithosP.finderLitSub")}
            ink={INK.gold}
            enter={2}
            mark={<KpiMarkCoins tone={INK.gold} />}
          />
          <LithosKpi
            label={t("lithosP.holding")}
            value={snap ? lit(snap.holdingLit, locale) : miss}
            sub={t("lithosP.holdingSub")}
            ink={INK.teal}
            enter={3}
            mark={<KpiMarkLocked tone={INK.teal} />}
          />
        </div>
        <div className="relative min-w-0">
        <article className="lithos-hero-copy flex min-w-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-2.5 lg:absolute lg:inset-0 lg:overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <img src="/lithos-mark.png" alt="" width={28} height={28} className="h-7 w-7 shrink-0 object-contain" />
            <h2 className="text-[15px] font-semibold leading-none">{t("nav.lithosProtocol")}</h2>
            {LITHOS_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] leading-none text-accent hover:underline"
              >
                {t(link.key)}
              </a>
            ))}
            <Link prefetch={false} href="/defi/lithos" className="text-[12px] leading-none text-accent hover:underline">
              LithosDex
            </Link>
          </div>
          <div className="mt-2 flex min-h-0 flex-1 flex-col justify-between gap-2">
            <p className="text-[13px] leading-[1.45] text-[var(--text)]">{t("lithosP.body")}</p>
            <p className="text-[12px] leading-[1.45] text-[var(--muted)]">{privateLine}</p>
          </div>
        </article>
        </div>
      </div>

      {!listReady ? null : items.length === 0 ? (
        <p className="text-[13px] text-[var(--muted)]">{t("lithosP.empty")}</p>
      ) : (
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
                  "addr-head addr-lane addr-lane-x block-lane lithos-finds text-[12px] font-medium",
                  stuck && "is-stuck"
                )}
              >
                <div className="block-lane-pair">
                  <div className="min-w-0">{t("lithosP.height")}</div>
                  <div className="min-w-0 justify-end">{t("lithosP.time")}</div>
                </div>
                <div className="block-lane-pair">
                  <div className="min-w-0">{t("lithosP.finder")}</div>
                  <div className="min-w-0 justify-end">{t("lithosP.finderLit")}</div>
                </div>
                <div className="block-lane-pair">
                  <div className="min-w-0">{t("lithosP.lender")}</div>
                  <div className="min-w-0 justify-end">{t("lithosP.permit")}</div>
                </div>
                <div className="block-lane-pair">
                  <div className="min-w-0">{t("lithosP.hold")}</div>
                  <div className="min-w-0 justify-end">{t("lithosP.shares")}</div>
                </div>
              </div>
              {items.map((row) => (
                <div
                  key={row.height}
                  className={clsx(
                    "addr-lane addr-lane-x block-lane lithos-finds border-t border-[var(--border-soft)] py-2.5 text-[13px]",
                    enter.enterClass(String(row.height))
                  )}
                >
                  <div className="block-lane-pair">
                    <div className="min-w-0 px-3">
                      <Link
                        prefetch={false}
                        href={`/block/${row.blockId}`}
                        className="block min-w-0 truncate font-mono tabular-nums text-accent hover:underline"
                      >
                        {row.height.toLocaleString(L)}
                      </Link>
                      <Link
                        prefetch={false}
                        href={`/tx/${row.txId}`}
                        title={row.txId}
                        className="mt-0.5 block truncate font-mono text-[11px] text-[var(--muted)] hover:text-accent hover:underline"
                      >
                        {shortId(row.txId, 5)}
                      </Link>
                    </div>
                    <div className="min-w-0 px-3 text-right">
                      <FindWhen ts={row.ts} />
                    </div>
                  </div>
                  <div className="block-lane-pair">
                    <div className="min-w-0 px-3">
                      <Addr address={row.finderAddress} />
                    </div>
                    <div className="min-w-0 px-3 text-right tabular-nums">
                      {lit(row.finderLit, locale)} LIT
                    </div>
                  </div>
                  <div className="block-lane-pair">
                    <div className="min-w-0 px-3">
                      <Addr address={row.lenderAddress} />
                    </div>
                    <div className="min-w-0 px-3 text-right tabular-nums">
                      {lit(row.permitLit, locale)} LIT
                    </div>
                  </div>
                  <div className="block-lane-pair">
                    <div className="min-w-0 px-3">
                      <Addr address={row.holdingAddress} />
                      <p className="mt-0.5 truncate tabular-nums text-[12px] text-[var(--text)]">
                        {lit(row.holdingLit, locale)} LIT
                      </p>
                    </div>
                    <div
                      className="min-w-0 px-3 text-right"
                      title={`${t("lithosP.team")} ${lit(row.teamLit, locale)} · ${t("lithosP.investors")} ${lit(row.investorLit, locale)} · ${t("lithosP.auditor")} ${lit(row.auditorLit, locale)}`}
                    >
                      <p className="truncate tabular-nums">
                        {lit(row.teamLit, locale)} · {lit(row.investorLit, locale)} · {lit(row.auditorLit, locale)}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">{t("lithosP.sharesHint")}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <RankWindow
            offset={page * PACK}
            pageSize={PACK}
            shown={items.length}
            total={null}
            hasMore={snap?.hasMore === true}
            loc={L}
            ofLabel={t("addresses.packOf")}
            prevLabel={t("addresses.packPrev")}
            nextLabel={t("addresses.packNext")}
            tapeLabel={t("lithosP.packTape")}
            hint={t("lithosP.packHint")}
            disabled={pending}
            onOffset={(next) => {
              const cur = page * PACK;
              if (next > cur) {
                const nxt = nextCursorRef.current;
                if (!hasMoreRef.current || !nxt) return;
                cursorStack.current.push(cursorRef.current);
                cursorRef.current = nxt;
                setPage(cursorStack.current.length);
                void load(nxt);
              } else if (next < cur) {
                if (!cursorStack.current.length) return;
                const prev = cursorStack.current.pop() ?? null;
                cursorRef.current = prev;
                setPage(cursorStack.current.length);
                void load(prev);
              }
            }}
          />
        </div>
      )}
    </Shell>
  );
}
