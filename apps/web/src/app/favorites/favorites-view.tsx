"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import { AddressTapeHead, AddressTapeRow } from "@/components/AddressTapeRow";
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
import { BlockTapeRow } from "@/app/blocks/blocks-view";
import { PoolTapeRow } from "@/app/defi/pool/pool-view";
import { TokenTapeRow } from "@/app/tokens/tokens-view";
import { TxLaneRow } from "@/components/TxLaneRow";
import { getGateway } from "@/lib/config";
import {
  useFavorites,
  useFavoriteList,
  type FavoriteKind,
} from "@/lib/favorites";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
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

function col(label: string, align: "left" | "right" | "center" = "left") {
  return (
    <div
      className={clsx(
        "flex h-full min-w-0 items-center",
        align === "right" && "justify-end",
        align === "center" && "justify-center"
      )}
    >
      <span
        className={clsx(
          "inline-flex shrink-0 items-center whitespace-nowrap px-2 py-1.5 text-[12px] font-medium leading-none text-[var(--muted)]",
          align === "right" && "w-full justify-end text-right",
          align === "center" && "w-full justify-center text-center"
        )}
      >
        {label}
      </span>
    </div>
  );
}

const SHEET_EASE = [0.4, 0, 0.2, 1] as const;

export function FavoritesView() {
  const t = useT();
  const { locale } = useI18n();
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
  const pinRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
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
  }, [kind, ids?.length]);

  const tiles: { id: FavoriteKind; label: string; ink: string; mark: ReactNode }[] = [
    { id: "addresses", label: t("addresses.title"), ink: INK.violet, mark: <KpiMarkUsers tone={INK.violet} /> },
    { id: "tokens", label: t("tokens.title"), ink: INK.gold, mark: <KpiMarkCoins tone={INK.gold} /> },
    { id: "blocks", label: t("blocks.title"), ink: INK.green, mark: <KpiMarkSquareStack tone={INK.green} /> },
    { id: "transactions", label: t("txs.title"), ink: INK.cyan, mark: <KpiMarkWorkflow tone={INK.cyan} /> },
    { id: "pools", label: t("defi.pools"), ink: INK.gold, mark: <KpiMarkVault tone={INK.gold} /> },
  ];

  const heart = (id: string, on: boolean) => ({
    fav: on,
    favReady: true,
    favTitle: on ? t("favorites.remove") : t("favorites.add"),
    onToggleFav: () => remove(id),
  });

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
          <div className="mb-3 grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3 lg:grid-cols-5">
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
          <AnimatePresence mode="wait" initial={false}>
            {!ids?.length ? (
              <motion.div
                key={`empty-${kind}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: SHEET_EASE }}
              >
                <FavKayolo line={t(EMPTY_KEY[kind])} />
              </motion.div>
            ) : tapeReady ? (
              <motion.div
                key={kind}
                className="addr-sheet"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.28, ease: SHEET_EASE }}
              >
                <div ref={pinRef} className="h-px w-full" aria-hidden />
                {kind === "addresses" ? (
                  <div className="addr-pan kpi-tape">
                    <AddressTapeHead
                      stuck={stuck}
                      address={t("addresses.colAddress")}
                      name={t("addresses.colName")}
                      erg={t("addresses.colErg")}
                      tokens={t("addresses.colTokens")}
                      txs={t("addresses.colTxs")}
                      first={t("addresses.colFirst")}
                      last={t("addresses.colLast")}
                    />
                    {ids.map((id) => (
                      <AddressTapeRow
                        key={id}
                        row={addresses[id] ?? blankAddress(id)}
                        loc={loc}
                        t={t}
                        enterClass={enter.enterClass(id)}
                        fav
                        favReady
                        onToggleFav={() => remove(id)}
                      />
                    ))}
                  </div>
                ) : null}
                {kind === "tokens" ? (
                  <div className={clsx("addr-pan", stuck && "is-stuck")}>
                    <div className="addr-head addr-lane addr-lane-x token-lane text-[12px] font-medium">
                      <div className="token-lane-name">
                        <div className="justify-center !px-2" aria-hidden />
                        {col(t("tokens.colName"))}
                      </div>
                      <div className="token-lane-id min-w-0 grid">
                        {col(t("tokens.colId"))}
                        {col(t("tokens.colSupply"), "right")}
                      </div>
                      <div className="token-lane-pair min-w-0 grid">
                        {col(t("tokens.colFirst"))}
                        {col(t("tokens.colLast"), "right")}
                      </div>
                      <div className="token-lane-triple">
                        {col(t("tokens.colTxs"))}
                        {col(t("tokens.colHolders"), "right")}
                      </div>
                    </div>
                    {ids.map((id) => (
                      <TokenTapeRow
                        key={id}
                        row={tokens[id] ?? blankToken(id)}
                        locale={locale}
                        enterClass={enter.enterClass(id)}
                        {...heart(id, true)}
                      />
                    ))}
                  </div>
                ) : null}
                {kind === "blocks" ? (
                  <div className="addr-pan">
                    <div
                      className={clsx(
                        "addr-head addr-lane addr-lane-x block-lane blocks-tape text-[12px] font-medium",
                        stuck && "is-stuck"
                      )}
                    >
                      <div className="block-lane-pair">
                        {col(t("blocks.height"))}
                        <div className="lithos-col" aria-hidden />
                        {col(t("blocks.txs"), "right")}
                      </div>
                      <div className="block-lane-pair">
                        {col(t("blocks.interval"))}
                        {col(t("blocks.blockTime"), "right")}
                      </div>
                      <div className="block-lane-pair">
                        {col(t("blocks.miner"))}
                        {col(t("blocks.transferred"), "right")}
                      </div>
                      <div className="block-lane-pair">
                        {col(t("blocks.id"))}
                        {col(t("blocks.size"), "right")}
                      </div>
                    </div>
                    {ids.map((id) => (
                      <BlockTapeRow
                        key={id}
                        row={blocks[id] ?? blankBlock(id)}
                        locale={locale}
                        miss={t("home.unavailable")}
                        t={t}
                        now={Date.now()}
                        intervalMs={blockGaps[id] ?? null}
                        enterClass={enter.enterClass(id)}
                        {...heart(id, true)}
                      />
                    ))}
                  </div>
                ) : null}
                {kind === "transactions" ? (
                  <div className="addr-pan kpi-tape">
                    <div
                      className={clsx(
                        "addr-head addr-lane addr-lane-x block-tx-pairs text-[12px] font-medium",
                        stuck && "is-stuck"
                      )}
                    >
                      <div className="block-lane-pair">
                        {col(t("detail.tx"))}
                        {col(t("blocks.txIo"), "right")}
                      </div>
                      <div className="block-lane-pair">
                        {col(t("block.col.tokens"))}
                        {col(t("blocks.time"), "right")}
                      </div>
                      <div className="block-lane-pair">
                        {col(t("tx.fee"))}
                        {col(t("txs.outputSum"), "right")}
                      </div>
                      <div className="block-lane-pair is-triple">
                        {col(t("blocks.txIndex"))}
                        <div className="min-w-0 text-center text-[12px] font-medium text-[var(--muted)]">
                          {t("blocks.size")}
                        </div>
                        {col(t("blocks.height"), "right")}
                      </div>
                    </div>
                    {ids.map((id) => (
                      <TxLaneRow
                        key={id}
                        row={txs[id] ?? blankTx(id)}
                        index={txs[id]?.index ?? 0}
                        locale={locale}
                        t={t}
                        showHeight
                        enterClass={enter.enterClass(id)}
                        {...heart(id, true)}
                      />
                    ))}
                  </div>
                ) : null}
                {kind === "pools" ? (
                  <div className="addr-pan kpi-tape">
                    <div
                      className={clsx(
                        "addr-head addr-lane addr-lane-x block-tx-pairs text-[12px] font-medium",
                        stuck && "is-stuck"
                      )}
                    >
                      <div className="block-lane-pair">
                        {col(t("pool.colPair"))}
                        {col(t("spectrum.tvl"), "right")}
                      </div>
                      <div className="block-lane-pair">
                        {col(t("spectrum.volume"))}
                        {col(t("pool.colDay"), "right")}
                      </div>
                      <div className="block-lane-pair">
                        {col(t("spectrum.traders"))}
                        {col(t("pool.colFirst"), "right")}
                      </div>
                      <div className="block-lane-pair">
                        {col(t("spectrum.trades"))}
                        {col(t("pool.colLast"), "right")}
                      </div>
                    </div>
                    {ids.map((id) => (
                      <PoolTapeRow
                        key={id}
                        row={pools[id] ?? blankPool(id)}
                        locale={locale}
                        miss={t("home.unavailable")}
                        t={t}
                        enterClass={enter.enterClass(id)}
                        {...heart(id, true)}
                      />
                    ))}
                  </div>
                ) : null}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </>
      )}
    </Shell>
  );
}
