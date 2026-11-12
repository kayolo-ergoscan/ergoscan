"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { KpiNum, KpiTileRail } from "@/components/KpiGrid";
import {
  KpiMarkCoins,
  KpiMarkSquareStack,
  KpiMarkUsers,
  KpiMarkVault,
  KpiMarkWorkflow,
} from "@/components/kpi-marks";
import { Shell } from "@/components/Shell";
import { FavKayolo } from "@/components/FavKayolo";
import { FeedBlockRow } from "@/app/blocks/blocks-view";
import { FeedTokenRow } from "@/app/tokens/tokens-view";
import { Feed, FeedBoard, FeedCount, FeedDays, FeedPlate, FeedSkeleton } from "@/components/feed/Feed";
import { FeedAddressRow } from "@/components/feed/FeedHolderRow";
import { FeedPoolRow } from "@/components/feed/FeedPoolRow";
import { FeedTxRow } from "@/components/feed/FeedTxRow";
import { toEpochMs } from "@/lib/format";
import { getGateway } from "@/lib/config";
import {
  useFavorites,
  useFavoriteList,
  type FavoriteKind,
} from "@/lib/favorites";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { useCoarsePointer } from "@/lib/use-coarse";
import { SNAPSHOT_FETCH, snapshotPath, useEnterIds } from "@/lib/keyed-enter";
import type { PoolBoardRow } from "@/lib/defi-pools";
import {
  parseBlockCard,
  parseTxListItems,
  type BlockListItem,
  type PoolBoardSnap,
  type TokenListItem,
  type TxListItem,
} from "@/lib/list-snapshots";
import { INK } from "@/lib/palette";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";

type Header = {
  address: string;
  nanoerg: string | null;
  tokenCount: number | null;
  txCount: number | null;
  firstTs: number | null;
  lastTs: number | null;
  firstTxId?: string | null;
  lastTxId?: string | null;
};

const EMPTY_KEY: Record<FavoriteKind, string> = {
  addresses: "favorites.empty",
  tokens: "favorites.emptyTokens",
  blocks: "favorites.emptyBlocks",
  transactions: "favorites.emptyTxs",
  pools: "favorites.emptyPools",
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function parseHeader(id: string, j: unknown): Header {
  const o = j && typeof j === "object" ? (j as Record<string, unknown>) : null;
  const bal =
    o?.balance && typeof o.balance === "object"
      ? (o.balance as Record<string, unknown>)
      : null;
  const pag =
    o?.pagination && typeof o.pagination === "object"
      ? (o.pagination as Record<string, unknown>)
      : null;
  const txs =
    pag?.txs && typeof pag.txs === "object" ? (pag.txs as Record<string, unknown>) : null;
  const nano = bal?.confirmedNanoErg;
  return {
    address: typeof o?.address === "string" && o.address ? o.address : id,
    nanoerg: nano == null ? null : String(nano),
    tokenCount: num(o?.tokenCount),
    txCount: num(txs?.total),
    firstTs: num(o?.firstTs),
    lastTs: num(o?.lastTs),
    firstTxId: str(o?.firstTxId),
    lastTxId: str(o?.lastTxId),
  };
}

function blankAddress(id: string): Header {
  return {
    address: id,
    nanoerg: null,
    tokenCount: null,
    txCount: null,
    firstTs: null,
    lastTs: null,
    firstTxId: null,
    lastTxId: null,
  };
}

function blankToken(id: string): TokenListItem {
  return {
    tokenId: id,
    name: null,
    decimals: 0,
    emission: null,
    artworkUrl: null,
    holders: null,
    unspentBoxes: null,
    txCount: null,
    firstHeight: null,
    lastHeight: null,
    firstTs: null,
    lastTs: null,
  };
}

function blankBlock(id: string): BlockListItem {
  return { id, height: 0, timestamp: 0, txCount: null, size: 0 };
}

function blankTx(id: string): TxListItem {
  return {
    id,
    index: null,
    inclusionHeight: null,
    timestamp: null,
    size: 0,
    fee: 0,
    feeRate: 0,
    category: "other",
    color: "var(--muted)",
    platform: null,
    inputs: 0,
    outputs: 0,
    value: null,
    confirmed: true,
  };
}

function blankPool(id: string): PoolBoardRow {
  return {
    poolId: id,
    tokenId: id,
    symbol: "",
    tvlErg: 0,
    volErg: null,
    priceErg: null,
    trades: null,
    firstTs: null,
    traders: null,
  };
}

function blockItem(card: NonNullable<ReturnType<typeof parseBlockCard>>): BlockListItem {
  return {
    id: card.id,
    height: card.height,
    timestamp: card.timestamp,
    txCount: card.txCount,
    size: card.size,
    parentId: card.parentId,
    minerAddress: card.minerAddress,
    minerName: card.minerName,
    feeNano: card.feeNano,
    valueNano: card.valueNano,
    userValueNano: card.userValueNano,
    lithos: card.lithos === true,
  };
}

/** Gap to the previous block. The blocks tape shows this in Time. */
function blockInterval(card: NonNullable<ReturnType<typeof parseBlockCard>>): number | null {
  if (card.prevTimestamp == null || !Number.isFinite(card.timestamp) || card.timestamp <= 0) return null;
  const gap = card.timestamp - card.prevTimestamp;
  return gap > 0 ? gap : null;
}

async function getJson(path: string): Promise<unknown | null> {
  try {
    const r = await fetch(`${getGateway()}${path}`, SNAPSHOT_FETCH);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function KindTile({
  label,
  n,
  caption,
  ink,
  mark,
  selected,
  onSelect,
  enter,
  loc,
}: {
  label: string;
  n: number;
  caption: string;
  ink: string;
  mark: ReactNode;
  selected: boolean;
  onSelect: () => void;
  enter: number;
  loc: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={clsx(
        "kpi-tile kpi-tile--dense kpi-tile--press home-tile-enter relative flex min-w-0 gap-2 rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-3 py-1.5 text-left",
        selected && "is-pressed"
      )}
      style={{ ["--kpi-ink" as string]: ink, ["--enter" as string]: String(enter) }}
    >
      <KpiTileRail />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-[1.15]" style={{ color: INK.coral }}>
          {label}
        </span>
        <span className="mt-0.5 block text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight">
          <KpiNum>{n.toLocaleString(loc)}</KpiNum>
        </span>
        <span className="mt-0.5 block truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
          {caption}
        </span>
      </span>
      <span className="kpi-tile-mark" style={{ color: ink }}>
        {mark}
      </span>
    </button>
  );
}

export function FavoritesView() {
  const t = useT();
  const { locale } = useI18n();
  const coarse = useCoarsePointer();
  const loc = locale === "ru" ? "ru-RU" : "en-US";
  const { markSynced } = usePageSync();
  const store = useFavorites();
  const [kind, setKind] = useState<FavoriteKind>("addresses");
  const { remove } = useFavoriteList(kind);
  const [addresses, setAddresses] = useState<Record<string, Header>>({});
  const [tokens, setTokens] = useState<Record<string, TokenListItem>>({});
  const [blocks, setBlocks] = useState<Record<string, BlockListItem>>({});
  const [blockGaps, setBlockGaps] = useState<Record<string, number | null>>({});
  const [txs, setTxs] = useState<Record<string, TxListItem>>({});
  const [pools, setPools] = useState<Record<string, PoolBoardRow>>({});
  const fetched = useRef<Record<FavoriteKind, Set<string>>>({
    addresses: new Set(),
    tokens: new Set(),
    blocks: new Set(),
    transactions: new Set(),
    pools: new Set(),
  });
  const poolBoard = useRef<Record<string, PoolBoardRow> | null>(null);
  const enter = useEnterIds();
  const [listReady, setListReady] = useState(false);
  const seenKind = useRef<FavoriteKind | null>(null);
  const markEnter = enter.mark;
  const ids = store?.[kind] ?? null;

  useKeepFresh(() => markSynced());

  useEffect(() => {
    if (store == null) return;
    markSynced();
  }, [store, markSynced]);

  useEffect(() => {
    if (store == null) return;
    const rows = store[kind];
    if (seenKind.current !== kind) {
      seenKind.current = kind;
      markEnter(rows);
    }
    setListReady(true);
  }, [store, kind, markEnter]);

  useEffect(() => {
    if (!ids?.length) return;
    const bag = fetched.current[kind];
    const missing = ids.filter((id) => !bag.has(id));
    if (!missing.length && kind !== "pools") return;
    let gone = false;

    const paintPools = (board: Record<string, PoolBoardRow>) => {
      setPools(() => {
        const next: Record<string, PoolBoardRow> = {};
        for (const id of ids) next[id] = board[id] ?? blankPool(id);
        return next;
      });
    };

    if (kind === "pools") {
      const board = poolBoard.current;
      if (board) {
        paintPools(board);
        return;
      }
      void getJson(snapshotPath("/v1/defi/pool-board")).then((j) => {
        if (gone) return;
        const byId: Record<string, PoolBoardRow> = {};
        for (const row of (j as PoolBoardSnap | null)?.pools ?? []) byId[row.poolId] = row;
        poolBoard.current = byId;
        paintPools(byId);
      });
      return () => {
        gone = true;
      };
    }

    void Promise.all(
      missing.map(async (id) => {
        if (kind === "addresses") {
          const j = await getJson(`/v1/addresses/${encodeURIComponent(id)}?lists=0`);
          return j ? parseHeader(id, j) : blankAddress(id);
        }
        if (kind === "tokens") {
          const j = (await getJson(
            `/v1/tokens?${new URLSearchParams({ q: id, limit: "1", names: "0" })}`
          )) as { items?: TokenListItem[] } | null;
          return j?.items?.find((row) => row.tokenId === id) ?? blankToken(id);
        }
        if (kind === "blocks") {
          const card = parseBlockCard(await getJson(`/v1/blocks/${encodeURIComponent(id)}?limit=1&offset=0`));
          return {
            item: card ? blockItem(card) : blankBlock(id),
            gap: card ? blockInterval(card) : null,
          };
        }
        const parsed = parseTxListItems([await getJson(`/v1/transactions/${encodeURIComponent(id)}`)]);
        return parsed[0] ?? blankTx(id);
      })
    ).then((rows) => {
      if (gone) return;
      for (const id of missing) bag.add(id);
      if (kind === "addresses") {
        setAddresses((prev) => {
          const next = { ...prev };
          missing.forEach((id, i) => {
            next[id] = (rows[i] as Header) ?? blankAddress(id);
          });
          return next;
        });
      } else if (kind === "tokens") {
        setTokens((prev) => {
          const next = { ...prev };
          missing.forEach((id, i) => {
            next[id] = (rows[i] as TokenListItem) ?? blankToken(id);
          });
          return next;
        });
      } else if (kind === "blocks") {
        setBlocks((prev) => {
          const next = { ...prev };
          missing.forEach((id, i) => {
            const packed = rows[i] as { item: BlockListItem; gap: number | null } | undefined;
            next[id] = packed?.item ?? blankBlock(id);
          });
          return next;
        });
        setBlockGaps((prev) => {
          const next = { ...prev };
          missing.forEach((id, i) => {
            const packed = rows[i] as { item: BlockListItem; gap: number | null } | undefined;
            next[id] = packed?.gap ?? null;
          });
          return next;
        });
      } else if (kind === "transactions") {
        setTxs((prev) => {
          const next = { ...prev };
          missing.forEach((id, i) => {
            next[id] = (rows[i] as TxListItem) ?? blankTx(id);
          });
          return next;
        });
      }
    });
    return () => {
      gone = true;
    };
  }, [ids, kind]);

  const tiles: { id: FavoriteKind; label: string; ink: string; mark: ReactNode }[] = [
    { id: "addresses", label: t("addresses.title"), ink: INK.violet, mark: <KpiMarkUsers tone={INK.violet} /> },
    { id: "tokens", label: t("tokens.title"), ink: INK.gold, mark: <KpiMarkCoins tone={INK.gold} /> },
    { id: "blocks", label: t("blocks.title"), ink: INK.green, mark: <KpiMarkSquareStack tone={INK.green} /> },
    { id: "transactions", label: t("txs.title"), ink: INK.cyan, mark: <KpiMarkWorkflow tone={INK.cyan} /> },
    { id: "pools", label: t("defi.pools"), ink: INK.gold, mark: <KpiMarkVault tone={INK.gold} /> },
  ];

  /** Every row here is saved; its heart removes it. */
  const saved = (id: string) => ({ on: true, ready: true, title: t("favorites.remove"), toggle: () => remove(id) });
  const now = Date.now();
  const blockItems = (ids ?? []).map((id) => blocks[id] ?? blankBlock(id)).sort((a, b) => b.height - a.height);
  const txItems = (ids ?? [])
    .map((id) => txs[id] ?? blankTx(id))
    .sort((a, b) => (toEpochMs(b.timestamp) ?? -1) - (toEpochMs(a.timestamp) ?? -1));

  const rowReady = (id: string) => {
    if (kind === "addresses") return addresses[id] != null;
    if (kind === "tokens") return tokens[id] != null;
    if (kind === "blocks") return blocks[id] != null;
    if (kind === "transactions") return txs[id] != null;
    return pools[id] != null;
  };
  const tapeReady = !!ids?.length && ids.every(rowReady);

  return (
    <Shell>
      {store == null || !listReady ? null : (
        <>
          <div className="mb-2 grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {tiles.map((tile, i) => (
              <KindTile
                key={tile.id}
                enter={i}
                label={tile.label}
                n={store[tile.id].length}
                caption={t("favorites.saved")}
                ink={tile.ink}
                mark={tile.mark}
                selected={kind === tile.id}
                onSelect={() => setKind(tile.id)}
                loc={loc}
              />
            ))}
          </div>
          {!ids?.length ? (
            <FavKayolo line={t(coarse ? `${EMPTY_KEY[kind]}Tap` : EMPTY_KEY[kind])} />
          ) : !tapeReady ? (
            <Feed busy>
              <FeedSkeleton rows={Math.min(ids.length, 6)} />
            </Feed>
          ) : (
            <div className="feed-sheet" key={kind}>
              <Feed className={kind === "blocks" || kind === "transactions" ? undefined : "is-rank"}>
                {kind === "addresses" ? (
                  <FeedBoard
                    plate={
                      <FeedPlate tag={t("addresses.title")} now count={<FeedCount k="feed.addresses" n={ids.length} />} />
                    }
                  >
                    {ids.map((id, i) => (
                      <FeedAddressRow
                        key={id}
                        row={addresses[id] ?? blankAddress(id)}
                        rank={i + 1}
                        enterClass={enter.enterClass(id)}
                        fav={{ on: true, ready: true, toggle: () => remove(id) }}
                      />
                    ))}
                  </FeedBoard>
                ) : null}
                {kind === "tokens" ? (
                  <FeedBoard
                    plate={<FeedPlate tag={t("tokens.title")} now count={<FeedCount k="feed.tokens" n={ids.length} />} />}
                  >
                    {ids.map((id, i) => (
                      <FeedTokenRow
                        key={id}
                        row={tokens[id] ?? blankToken(id)}
                        rank={i + 1}
                        sort="holders"
                        enterClass={enter.enterClass(id)}
                        fav={saved(id)}
                      />
                    ))}
                  </FeedBoard>
                ) : null}
                {kind === "blocks" ? (
                  <FeedDays
                    items={blockItems}
                    msOf={(b) => toEpochMs(b.timestamp)}
                    seconds
                    countOf={(n) => <FeedCount k="feed.blockCount" n={n} />}
                    render={(b, lead) => (
                      <FeedBlockRow
                        key={b.id}
                        row={b}
                        lead={lead}
                        now={now}
                        intervalMs={blockGaps[b.id] ?? null}
                        enterClass={enter.enterClass(b.id)}
                        fav={saved(b.id)}
                      />
                    )}
                  />
                ) : null}
                {kind === "transactions" ? (
                  <FeedDays
                    items={txItems}
                    msOf={(x) => toEpochMs(x.timestamp)}
                    seconds
                    countOf={(n) => <FeedCount k="feed.txCount" n={n} />}
                    render={(x, lead) => (
                      <FeedTxRow
                        key={x.id}
                        row={x}
                        lead={lead}
                        showHeight
                        enterClass={enter.enterClass(x.id)}
                        fav={saved(x.id)}
                      />
                    )}
                  />
                ) : null}
                {kind === "pools" ? (
                  <FeedBoard
                    plate={<FeedPlate tag={t("defi.pools")} now count={<FeedCount k="feed.pools" n={ids.length} />} />}
                  >
                    {ids.map((id, i) => (
                      <FeedPoolRow
                        key={id}
                        row={pools[id] ?? blankPool(id)}
                        rank={i + 1}
                        enterClass={enter.enterClass(id)}
                        fav={saved(id)}
                      />
                    ))}
                  </FeedBoard>
                ) : null}
              </Feed>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
