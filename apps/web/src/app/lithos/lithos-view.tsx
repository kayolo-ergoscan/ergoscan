"use client";

import { Tip, TipRow, TipRows } from "@/components/Tip";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import {
  Feed,
  FeedAmount,
  FeedCount,
  FeedDays,
  FeedEmpty,
  FeedField,
  FeedFields,
  FeedIdLine,
  FeedRow,
  type FeedLead,
} from "@/components/feed/Feed";
import { RankWindow } from "@/components/RankWindow";
import { useT, useI18n } from "@/lib/i18n/I18nProvider";
import { getGateway } from "@/lib/config";
import { formatTokenAmount, formatTs, shortId, toEpochMs } from "@/lib/format";
import { lookupAddress } from "@/lib/address-book";
import type { LithosProtocolStats } from "@ergoscan/shared";
import { LithosHeader, type LithosClientRelease } from "./lithos-header";
import { ENTER_MS, SNAPSHOT_FETCH, enteringIds, useEnterIds } from "@/lib/keyed-enter";

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
  /** Header figures from the snapshot pass; absent before the indexer has them. */
  stats?: LithosProtocolStats | null;
  client?: LithosClientRelease | null;
  updatedAt?: string | null;
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

function bigOf(raw: string | null | undefined): bigint | null {
  if (!raw) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

function AddrLink({ address }: { address: string }) {
  if (!address) return <span>—</span>;
  const name = lookupAddress(address)?.name;
  return (
    <Link
      prefetch={false}
      href={`/address/${address}`}
      title={name ? `${name} · ${address}` : address}
      className={clsx("hover:underline", !name && "font-mono tabular-nums")}
    >
      {name || shortId(address, 6)}
    </Link>
  );
}

/** One Lithos find: the block is the title, the finder's 4% the figure, the permit back under it. */
function FeedFindRow({ row, lead, enterClass }: { row: LithosFindItem; lead: FeedLead; enterClass?: string }) {
  const t = useT();
  const { locale } = useI18n();
  const L = loc(locale);
  const shares = `${lit(row.teamLit, locale)} · ${lit(row.investorLit, locale)} · ${lit(row.auditorLit, locale)}`;
  return (
    <FeedRow
      k="block"
      glyph="block"
      tileTitle={t("lithosP.blocks")}
      lead={lead}
      enterClass={enterClass}
      title={
        <Link
          prefetch={false}
          href={`/block/${row.blockId}`}
          title={row.blockId}
          className="feed-name font-mono font-semibold tabular-nums hover:underline"
        >
          {row.height.toLocaleString(L)}
        </Link>
      }
      facts={
        <>
          <span className="feed-kind">
            <AddrLink address={row.finderAddress} />
          </span>
          {row.lenderAddress ? (
            <span className="feed-mid">
              {t("lithosP.lender")} <AddrLink address={row.lenderAddress} />
            </span>
          ) : null}
          <span className="feed-wide">
            {t("lithosP.hold")} <span className="tabular-nums">{lit(row.holdingLit, locale)}</span>
          </span>
          <Link
            prefetch={false}
            href={`/tx/${row.txId}`}
            title={row.txId}
            className="feed-wide font-mono tabular-nums"
          >
            {shortId(row.txId, 6)}
          </Link>
        </>
      }
      value={<FeedAmount raw={bigOf(row.finderLit)} unit="LIT" glance />}
      sub={
        <>
          {t("lithosP.permit")} <span className="tabular-nums">{lit(row.permitLit, locale)}</span>
        </>
      }
      subMinor
      detail={() => (
        <FeedFields>
          <FeedField label={t("detail.block")} wide>
            <FeedIdLine href={`/block/${row.blockId}`} id={row.blockId} />
          </FeedField>
          <FeedField label={t("detail.tx")} wide>
            <FeedIdLine href={`/tx/${row.txId}`} id={row.txId} />
          </FeedField>
          <FeedField label={t("lithosP.finder")} wide>
            <FeedIdLine href={`/address/${row.finderAddress}`} id={row.finderAddress} />
          </FeedField>
          {row.lenderAddress ? (
            <FeedField label={t("lithosP.lender")} wide>
              <FeedIdLine href={`/address/${row.lenderAddress}`} id={row.lenderAddress} />
            </FeedField>
          ) : null}
          {row.holdingAddress ? (
            <FeedField label={t("lithosP.hold")} wide>
              <FeedIdLine href={`/address/${row.holdingAddress}`} id={row.holdingAddress} />
            </FeedField>
          ) : null}
          <FeedField label={t("lithosP.finderLit")}>
            <span className="tabular-nums">{lit(row.finderLit, locale)} LIT</span>
          </FeedField>
          <FeedField label={t("lithosP.permit")}>
            <span className="tabular-nums">{lit(row.permitLit, locale)} LIT</span>
          </FeedField>
          <FeedField label={t("lithosP.holding")}>
            <span className="tabular-nums">{lit(row.holdingLit, locale)} LIT</span>
          </FeedField>
          <FeedField label={`${t("lithosP.shares")} · ${t("lithosP.sharesHint")}`}>
            <Tip
              content={() => (
                <TipRows>
                  <TipRow label={t("lithosP.team")}>{lit(row.teamLit, locale)} LIT</TipRow>
                  <TipRow label={t("lithosP.investors")}>{lit(row.investorLit, locale)} LIT</TipRow>
                  <TipRow label={t("lithosP.auditor")}>{lit(row.auditorLit, locale)} LIT</TipRow>
                </TipRows>
              )}
            >
              <span className="tabular-nums">{shares}</span>
            </Tip>
          </FeedField>
          <FeedField label={t("lithosP.time")}>
            <span className="tabular-nums" suppressHydrationWarning>
              {row.ts != null ? formatTs(row.ts) : "—"}
            </span>
          </FeedField>
        </FeedFields>
      )}
    />
  );
}

export function LithosProtocolView({ initial }: { initial: LithosProtocolSnap | null }) {
  const t = useT();
  const { locale } = useI18n();
  const [snap, setSnap] = useState(initial);
  const [share, setShare] = useState(initial?.items[0] ?? null);
  const [pending, setPending] = useState(false);
  const [page, setPage] = useState(0);
  const served = Boolean(initial?.items.length);
  const [listReady, setListReady] = useState(served);
  const enter = useEnterIds(ENTER_MS, [], served);
  const packEnter = useEnterIds(ENTER_MS, [], served);
  const opened = useRef(served);
  const cursorRef = useRef<string | null>(null);
  const cursorStack = useRef<(string | null)[]>([]);
  const nextCursorRef = useRef<string | null>(initial?.nextCursor ?? null);
  const hasMoreRef = useRef(initial?.hasMore === true);
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
            // Cursor pages carry no header figures: keep the ones we have.
            stats: body.stats ?? prev?.stats ?? null,
            client: body.client ?? prev?.client ?? null,
            updatedAt: body.updatedAt ?? prev?.updatedAt ?? null,
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


  const L = loc(locale);

  return (
    <Shell>
      <LithosHeader
        stats={snap?.stats ?? null}
        latest={share}
        finds={snap?.finds ?? null}
        holdingLit={snap?.holdingLit ?? null}
        client={snap?.client ?? null}
        updatedAt={snap?.updatedAt ?? null}
      />

      {!listReady ? null : (
        <div className="feed-sheet">
          <Feed busy={pending} enterClass={packEnter.enterClass("pack")}>
            {items.length === 0 ? (
              <FeedEmpty k="block" title={t("lithosP.empty")} />
            ) : (
              <FeedDays
                items={items}
                msOf={(row) => toEpochMs(row.ts)}
                countOf={(n) => <FeedCount k="feed.blockCount" n={n} />}
                render={(row, lead) => (
                  <FeedFindRow
                    key={row.height}
                    row={row}
                    lead={lead}
                    enterClass={enter.enterClass(String(row.height))}
                  />
                )}
              />
            )}
          </Feed>
          {items.length > 0 ? (
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
          ) : null}
        </div>
      )}
    </Shell>
  );
}
