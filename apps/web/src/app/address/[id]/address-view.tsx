"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import { AddressPageSkeleton } from "@/components/AddressPageSkeleton";
import { AddressPip } from "@/components/AddressPip";
import { AddrFactCard } from "@/components/AddrFactCard";
import { AddressQr } from "@/components/AddressQr";
import { FavKayolo } from "@/components/FavKayolo";
import { ScanWait, useScanWait } from "@/components/ScanWait";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { KpiMark } from "@/components/kpi-marks";
import { compactFigure, KpiNum } from "@/components/KpiGrid";
import { NftCard } from "@/components/NftCard";
import {
  Feed,
  FeedBoard,
  FeedCount,
  FeedEmpty,
  FeedField,
  FeedPhrase,
  FeedPlate,
  FeedSkeleton,
} from "@/components/feed/Feed";
import { FeedBoxRow, FeedHoldingRow } from "@/components/feed/FeedBoxRow";
import { ActivityFeed } from "@/components/feed/FeedActivity";
import {
  peekAddressPageCache,
  putAddressPageCache,
} from "@/lib/address-page-cache";
import { RankWindow } from "@/components/RankWindow";
import { SegBar, segItem } from "@/components/SegBar";
import { DetailTabs, tabCount, type DetailTabItem } from "@/components/DetailTabs";
import { PrettyUsd } from "@/components/PrettyNum";
import { getGateway, getWsUrl } from "@/lib/config";
import {
  formatErgPrecise,
  formatGroupedNumber,
  formatRelTime,
  formatTs,
  nanoToUsd,
  shortId,
  toBigIntAmt,
  laterEpochMs,
  toEpochMs,
} from "@/lib/format";
import { describeParty, isP2pkAddress } from "@/lib/address-labels";
import { suggestNameUrl } from "@/lib/address-book";
import type { AddressRegistryName } from "@/lib/list-snapshots";
import { useFavorite } from "@/lib/favorites";
import { NameMarquee } from "@/components/NameMarquee";
import { partyNameMap, type AddrFlow, type AddrFlowKind } from "@/lib/tx-flow";
import { asAddrFlowKind, rentTapeTone } from "@ergoscan/shared";
import { INK } from "@/lib/palette";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { setHashTab } from "@/lib/hash-tab";
import { useChainTipRefresh, useKeepFresh, usePageSync } from "@/lib/page-sync";
import { ENTER_MS, enteringIds, useEnterIds } from "@/lib/keyed-enter";
import { addrTapeHasMore, txKeysetCursor } from "@/lib/rank-window";
import { cachedScoutRent, lookupScoutRent } from "@/lib/scout-rent";
import { copyText } from "@/lib/copy-text";

interface TokenRow {
  tokenId: string;
  amount: number | string;
  amountUi: number | null;
  name: string | null;
  decimals: number;
  emission?: number | null;
  artworkUrl?: string | null;
  priceUsd: number | null;
  valueUsd: number | null;
  firstHeight?: number | null;
  lastHeight?: number | null;
  firstTs?: number | null;
  lastTs?: number | null;
}

interface AddrNftRow {
  tokenId: string;
  name: string | null;
  collection: string;
  slug: string;
  artworkUrl: string | null;
  kind?: string | null;
  amount: string;
  decimals: number;
  emission: number | null;
  boxId: string | null;
  height: number | null;
  boxes: number;
  /** ErgoDex liquidity token (gateway): kind and, for a V3 position, the pair. */
  lp?: { kind: string; pair: string | null };
}

interface BoxRow {
  boxId: string;
  value: number | string;
  assets?: { tokenId: string; amount: number | string }[];
  transactionId?: string | null;
  index?: number | null;
  creationHeight?: number | null;
}

interface TxRow {
  id: string;
  inclusionHeight: number | null;
  timestamp: number | null;
  numConfirmations?: number | null;
  size?: number | null;
  fee?: number | string | null;
  mempool?: boolean;
  /** List-form tx meaning (gateway); the activity row reads it from the owner's seat. */
  meaning?: unknown;
}

type AddrActivityJson = {
  kind: AddrFlowKind;
  erg: string;
  from?: string[];
  to?: string[];
  /** Contract-registry names aligned with from / to (orders, positions). */
  fromNames?: (string | null)[];
  toNames?: (string | null)[];
  tokens: {
    tokenId: string;
    amount: string;
    name?: string | null;
    decimals?: number;
  }[];
};

interface AddrData {
  address: string;
  name?: AddressRegistryName | null;
  balance: {
    confirmedNanoErg: number | string;
    unconfirmedNanoErg: number | string;
    tokens: TokenRow[];
  };
  unspentBoxes: BoxRow[];
  recentTxs: TxRow[];
  mempoolTxs?: TxRow[];
  tokenCount?: number;
  firstTs?: number | null;
  lastTs?: number | null;
  activity?: Record<string, AddrActivityJson>;
  pagination?: {
    txs: {
      offset: number;
      limit: number;
      total: number;
      hasMore: boolean;
      nextCursor?: string | null;
    };
    boxes: {
      offset: number;
      limit: number;
      returned: number;
      total?: number;
      hasMore: boolean;
      nextCursor?: string | null;
    };
  };
  sources?: {
    balance?: string;
    boxes?: string;
    txs?: string;
    activity?: string;
    tokens?: string;
  };
}

const TX_PAGE = 25;
const BOX_PAGE = 25;
const TOKEN_PAGE = 25;
const NFT_PAGE = 24;
/** A key address is 51 characters; anything longer (P2S contracts) gets the two-line head…tail title. */
const BARE_TITLE_MAX = 60;
const ADDR_TABS = ["activity", "tokens", "nfts", "boxes"] as const;
type AddrTab = (typeof ADDR_TABS)[number];

function moreTxCursor(data: AddrData): string | null {
  const recent = data.recentTxs ?? [];
  return (
    data.pagination?.txs?.nextCursor ||
    (recent.length ? txKeysetCursor(recent[recent.length - 1]) : null)
  );
}

function activityRows(data: AddrData): TxRow[] {
  const recent = data.recentTxs ?? [];
  const confirmed = new Set(recent.map((t) => t.id));
  const pending = (data.mempoolTxs ?? []).filter((t) => t?.id && !confirmed.has(t.id));
  return [...pending, ...recent];
}

function isHeaderOnly(d: AddrData | null): boolean {
  if (!d) return false;
  return d.sources?.txs === "deferred" && d.sources?.activity === "deferred";
}

function addrFailCopy(err: string, t: (k: string) => string): string {
  if (err === "stale" || err === "503") return t("address.stale");
  return t("address.err");
}

/** Tape is paint-ready only when the same GET already has activity (AdaStat one-shot). */
function tapeComplete(d: AddrData | null): boolean {
  if (!d || isHeaderOnly(d)) return false;
  return d.sources?.activity !== "deferred";
}

function headerOrComplete(d: AddrData | null): AddrData | null {
  if (!d || tapeComplete(d) || isHeaderOnly(d)) return d;
  return { ...d, recentTxs: [], mempoolTxs: [], activity: {} };
}

function mergeHeader(prev: AddrData | null, header: AddrData): AddrData {
  if (prev && !isHeaderOnly(prev)) {
    return {
      ...prev,
      tokenCount: header.tokenCount ?? prev.tokenCount,
      firstTs: header.firstTs ?? prev.firstTs,
      lastTs: header.lastTs ?? prev.lastTs,
      balance: {
        ...prev.balance,
        confirmedNanoErg:
          header.balance?.confirmedNanoErg ?? prev.balance?.confirmedNanoErg ?? "0",
        unconfirmedNanoErg:
          header.balance?.unconfirmedNanoErg ?? prev.balance?.unconfirmedNanoErg ?? "0",
        tokens: prev.balance?.tokens ?? header.balance?.tokens ?? [],
      },
    };
  }
  return header;
}

function parseAddrActivity(
  activity?: Record<string, AddrActivityJson> | null
): Record<string, AddrFlow | null> {
  const out: Record<string, AddrFlow | null> = {};
  if (!activity) return out;
  for (const [id, row] of Object.entries(activity)) {
    if (!row?.kind) {
      out[id] = null;
      continue;
    }
    const kind = asAddrFlowKind(row.kind);
    if (!kind) {
      out[id] = null;
      continue;
    }
    const tokens = new Map<string, bigint>();
    for (const tok of row.tokens ?? []) {
      if (!tok.tokenId) continue;
      tokens.set(tok.tokenId.toLowerCase(), toBigIntAmt(tok.amount));
    }
    const names = partyNameMap([
      [row.from, row.fromNames],
      [row.to, row.toNames],
    ]);
    out[id] = {
      kind,
      erg: toBigIntAmt(row.erg),
      tokens,
      from: (row.from ?? []).filter((a) => typeof a === "string" && a),
      to: (row.to ?? []).filter((a) => typeof a === "string" && a),
      ...(names ? { names } : {}),
    };
  }
  return out;
}

function readAddrTab(): AddrTab {
  if (typeof window === "undefined") return "activity";
  const h = window.location.hash.replace("#", "");
  return ADDR_TABS.includes(h as AddrTab) ? (h as AddrTab) : "activity";
}

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

export type AddressPageData = AddrData;

export function AddressView({
  address,
  initial,
}: {
  address: string;
  initial: AddrData | null;
}) {
  const t = useT();
  const { locale } = useI18n();
  const { markSynced } = usePageSync();
  const fav = useFavorite(address);
  const [data, setData] = useState<AddrData | null>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initial);
  const [txCursor, setTxCursor] = useState<string | null>(null);
  const [boxCursor, setBoxCursor] = useState<string | null>(
    initial?.pagination?.boxes.nextCursor ?? null
  );
  const [txPage, setTxPage] = useState(0);
  const [boxOffset, setBoxOffset] = useState(0);
  const [tokenOffset, setTokenOffset] = useState(0);
  const [listsPending, setListsPending] = useState(() => !tapeComplete(initial));
  const txEnter = useEnterIds();
  const packEnter = useEnterIds();
  const [listReady, setListReady] = useState(false);
  const opened = useRef(false);
  const boxEnter = useEnterIds();
  const tokenEnter = useEnterIds();
  const nftEnter = useEnterIds();
  const [ergUsd, setErgUsd] = useState<number | null>(null);
  const [tab, setTab] = useState<AddrTab>("activity");
  const [flows, setFlows] = useState<Record<string, AddrFlow | null>>(() =>
    parseAddrActivity(initial?.activity)
  );
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokensSettled, setTokensSettled] = useState(false);
  const [tokensFailed, setTokensFailed] = useState(false);
  const tokensFetched = useRef(false);
  const tokensInflight = useRef(false);
  const [nfts, setNfts] = useState<AddrNftRow[]>([]);
  const [nftTotal, setNftTotal] = useState(0);
  const [nftOffset, setNftOffset] = useState(0);
  const [nftsLoading, setNftsLoading] = useState(false);
  const [nftsFailed, setNftsFailed] = useState(false);
  const [nftsPackKey, setNftsPackKey] = useState<string | null>(null);
  const [rentBlocks, setRentBlocks] = useState<number | null | undefined>(() =>
    cachedScoutRent(address)
  );
  const [tileLanded, setTileLanded] = useState(false);
  const nftIds = useMemo(() => new Set(nfts.map((row) => row.tokenId)), [nfts]);
  const txCursorRef = useRef<string | null>(null);
  txCursorRef.current = txCursor;
  const txCursorStack = useRef<(string | null)[]>([]);
  const boxOffsetRef = useRef(0);
  boxOffsetRef.current = boxOffset;
  const skipPack = useRef(true);
  const skipBoxPack = useRef(true);
  const skipTokenPack = useRef(true);
  const tokenOffsetRef = useRef(0);
  tokenOffsetRef.current = tokenOffset;
  const pinRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef(address);
  addressRef.current = address;
  const dataRef = useRef(data);
  dataRef.current = data;
  const party = describeParty(address);

  const load = useCallback(
    async (opts?: {
      pageTx?: boolean;
      pageBox?: boolean;
    }) => {
      if (!address) return;
      const forAddr = address;
      const packCursor = txCursorRef.current;
      const boxOff = Math.max(0, boxOffsetRef.current);
      const q = new URLSearchParams({
        txLimit: String(opts?.pageBox ? 0 : TX_PAGE),
        boxLimit: String(opts?.pageBox ? BOX_PAGE : 0),
        prices: "0",
        tokens: "0",
      });
      if (opts?.pageBox) q.set("activity", "0");
      if (opts?.pageTx && packCursor) q.set("txCursor", packCursor);
      if (boxOff > 0) q.set("boxOffset", String(boxOff));
      const r = await fetch(
        `${getGateway()}/v1/addresses/${encodeURIComponent(address)}?${q}`,
        { cache: "no-store" }
      );
      let j: (AddrData & { stale?: boolean; error?: string }) | null = null;
      try {
        j = (await r.json()) as AddrData & { stale?: boolean; error?: string };
      } catch {
        j = null;
      }
      if (!r.ok) {
        if (r.status === 503 || j?.stale || j?.error === "stale") throw new Error("stale");
        throw new Error(String(r.status));
      }
      if (!j) throw new Error("stale");
      if (addressRef.current !== forAddr) return;
      const parsedFlows = parseAddrActivity(j.activity);

      if (opts?.pageTx && !(j.recentTxs?.length) && packCursor) {
        skipPack.current = true;
        const prev = txCursorStack.current.pop() ?? null;
        txCursorRef.current = prev;
        setTxCursor(prev);
        setTxPage(txCursorStack.current.length);
        return;
      }
      if (opts?.pageBox && !(j.unspentBoxes?.length) && boxOff > 0) {
        setBoxOffset(Math.max(0, boxOff - BOX_PAGE));
        return;
      }

      setData((prev) => {
        const tokens =
          j.balance?.tokens?.length
            ? j.balance.tokens
            : (prev?.balance?.tokens ?? j.balance?.tokens ?? []);
        const activity = {
          ...(opts?.pageBox || opts?.pageTx ? prev?.activity ?? {} : {}),
          ...(j.activity ?? {}),
        };
        const tokenCount = j.tokenCount ?? prev?.tokenCount;
        let next: AddrData;
        if (opts?.pageTx && prev) {
          const recentTxs = j.recentTxs ?? [];
          txEnter.mark(
            enteringIds(
              [...(prev.mempoolTxs ?? []), ...(prev.recentTxs ?? [])],
              [...(j.mempoolTxs ?? prev.mempoolTxs ?? []), ...recentTxs]
            )
          );
          next = {
            ...j,
            recentTxs,
            mempoolTxs: j.mempoolTxs ?? prev.mempoolTxs,
            unspentBoxes: prev.unspentBoxes,
            firstTs: j.firstTs ?? prev.firstTs,
            lastTs: j.lastTs ?? prev.lastTs,
            balance: { ...(j.balance ?? prev.balance), tokens: prev.balance?.tokens ?? [] },
            tokenCount: prev.tokenCount ?? tokenCount,
            activity,
            pagination: {
              txs: j.pagination?.txs ?? prev.pagination?.txs,
              boxes: prev.pagination?.boxes ?? j.pagination?.boxes,
            } as AddrData["pagination"],
            sources: {
              ...prev.sources,
              ...j.sources,
              boxes: prev.sources?.boxes && prev.sources.boxes !== "deferred"
                ? prev.sources.boxes
                : j.sources?.boxes,
            },
          };
        } else if (opts?.pageBox && prev) {
          boxEnter.mark(
            enteringIds(
              (prev.unspentBoxes ?? []).map((b) => ({ id: b.boxId })),
              (j.unspentBoxes ?? []).map((b) => ({ id: b.boxId }))
            )
          );
          next = {
            ...j,
            recentTxs: prev.recentTxs,
            mempoolTxs: prev.mempoolTxs,
            firstTs: j.firstTs ?? prev.firstTs,
            lastTs: j.lastTs ?? prev.lastTs,
            balance: {
              ...(j.balance ?? prev.balance),
              tokens: prev.balance?.tokens ?? [],
              unconfirmedNanoErg: prev.balance?.unconfirmedNanoErg,
            },
            tokenCount: prev.tokenCount ?? tokenCount,
            activity,
            pagination: {
              txs: prev.pagination?.txs ?? j.pagination?.txs,
              boxes: j.pagination?.boxes ?? prev.pagination?.boxes,
            } as AddrData["pagination"],
            sources: {
              ...prev.sources,
              ...j.sources,
              txs: prev.sources?.txs ?? j.sources?.txs,
              activity: prev.sources?.activity ?? j.sources?.activity,
            },
          };
        } else {
          if (prev) {
            txEnter.mark(
              enteringIds(
                [...(prev.mempoolTxs ?? []), ...(prev.recentTxs ?? [])],
                [...(j.mempoolTxs ?? []), ...(j.recentTxs ?? [])]
              )
            );
            boxEnter.mark(
              enteringIds(
                (prev.unspentBoxes ?? []).map((b) => ({ id: b.boxId })),
                (j.unspentBoxes ?? []).map((b) => ({ id: b.boxId }))
              )
            );
          } else {
            txEnter.mark(
              [...(j.mempoolTxs ?? []), ...(j.recentTxs ?? [])].map((tx) => tx.id)
            );
            boxEnter.mark((j.unspentBoxes ?? []).map((b) => b.boxId));
          }
          next = {
            ...j,
            firstTs: j.firstTs ?? prev?.firstTs,
            lastTs: j.lastTs ?? prev?.lastTs,
            balance: { ...(j.balance ?? prev?.balance), tokens },
            tokenCount,
            activity,
          };
        }
        putAddressPageCache(forAddr, next);
        return next;
      });
      setFlows((prevFlows) => {
        if (opts?.pageBox) return prevFlows;
        if (opts?.pageTx) return { ...prevFlows, ...parsedFlows };
        return { ...prevFlows, ...parsedFlows };
      });
      if (opts?.pageBox) setBoxCursor(j.pagination?.boxes.nextCursor ?? null);
      markSynced();
      if (opts?.pageTx) {
        setTxPage(txCursorStack.current.length);
        pinRef.current?.scrollIntoView({ block: "nearest" });
      }
    },
    [address, markSynced, txEnter.mark, boxEnter.mark]
  );
  const loadRef = useRef(load);
  loadRef.current = load;
  const initialRef = useRef(initial);
  initialRef.current = initial;

  const refresh = useCallback(
    (silent = false) => {
      if (!address) return;
      if (!silent) {
        setErr(null);
        txCursorStack.current = [];
        if (txCursorRef.current !== null) skipPack.current = true;
        txCursorRef.current = null;
        setTxCursor(null);
        setTxPage(0);
        setBoxCursor(null);
        setListsPending(true);
      }
      if (silent && (txCursorRef.current || txCursorStack.current.length)) {
        void fetch(`${getGateway()}/v1/prices/erg`)
          .then((r) => r.json())
          .then((j: { usd?: number }) => setErgUsd(j.usd && j.usd > 0 ? j.usd : null))
          .catch(() => null);
        return;
      }
      void load({ pageTx: true })
        .catch((e) => {
          if (!silent) setErr(String(e));
        })
        .finally(() => {
          setLoading(false);
          if (!silent) setListsPending(false);
        });
      void fetch(`${getGateway()}/v1/prices/erg`)
        .then((r) => r.json())
        .then((j: { usd?: number }) => setErgUsd(j.usd && j.usd > 0 ? j.usd : null))
        .catch(() => null);
    },
    [address, load]
  );

  useKeepFresh(refresh);
  useChainTipRefresh(true, () => refresh(true));

  useEffect(() => {
    let dead = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const pull = () => {
      if (dead || !address) return;
      const q = new URLSearchParams({ lists: "0", prices: "0", tokens: "0" });
      void fetch(
        `${getGateway()}/v1/addresses/${encodeURIComponent(address)}?${q}`
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((j: AddrData | null) => {
          if (dead || !j) return;
          setData((prev) => {
            if (!prev) return prev;
            txEnter.mark(
              enteringIds(prev.mempoolTxs ?? [], j.mempoolTxs ?? [])
            );
            return {
              ...prev,
              mempoolTxs: j.mempoolTxs ?? [],
              activity: { ...prev.activity, ...(j.activity ?? {}) },
              balance: {
                ...prev.balance,
                unconfirmedNanoErg:
                  j.balance?.unconfirmedNanoErg ?? prev.balance?.unconfirmedNanoErg,
              },
            };
          });
          setFlows((prev) => ({ ...prev, ...parseAddrActivity(j.activity) }));
        })
        .catch(() => {});
    };
    const schedule = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(pull, 400);
    };
    const connect = () => {
      if (dead) return;
      let sawSnapshot = false;
      try {
        ws = new WebSocket(getWsUrl());
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data)) as {
              type?: string;
              data?: { id?: string; addresses?: string[] };
            };
            if (msg.type === "mempool.snapshot") {
              if (!sawSnapshot) {
                sawSnapshot = true;
                schedule();
              }
              return;
            }
            if (msg.type === "mempool.add") {
              // balls.addresses is empty unless ENRICH_ADDRESSES=1 — never skip on that list
              schedule();
            } else if (msg.type === "mempool.remove") {
              const id = msg.data?.id;
              if (id) {
                setData((prev) => {
                  if (!prev?.mempoolTxs?.some((t) => t.id === id)) return prev;
                  return {
                    ...prev,
                    mempoolTxs: prev.mempoolTxs.filter((t) => t.id !== id),
                  };
                });
              }
              schedule();
            }
          } catch {
            /* ignore */
          }
        };
        ws.onclose = () => {
          if (!dead) retry = setTimeout(connect, 2000);
        };
        ws.onerror = () => ws?.close();
      } catch {
        retry = setTimeout(connect, 3000);
      }
    };
    connect();
    return () => {
      dead = true;
      if (retry) clearTimeout(retry);
      if (debounce) clearTimeout(debounce);
      ws?.close();
    };
  }, [address, txEnter.mark]);

  useEffect(() => {
    setTab(readAddrTab());
    const onHash = () => setTab(readAddrTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let dead = false;
    setRentBlocks(cachedScoutRent(address));
    void lookupScoutRent(address).then((n) => {
      if (!dead) setRentBlocks(n);
    });
    return () => {
      dead = true;
    };
  }, [address]);

  useEffect(() => {
    setTileLanded(false);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTileLanded(true);
      return;
    }
    const id = window.setTimeout(() => setTileLanded(true), ENTER_MS);
    return () => window.clearTimeout(id);
  }, [address]);

  useEffect(() => {
    let dead = false;
    tokensFetched.current = false;
    tokensInflight.current = false;
    setTokensSettled(false);
    setTokensFailed(false);
    setNftsPackKey(null);
    setNfts([]);
    setNftTotal(0);
    setNftOffset(0);
    setNftsFailed(false);
    setErr(null);
    const seed = headerOrComplete(
      (initialRef.current ?? peekAddressPageCache(address)) as AddrData | null
    );
    opened.current = false;
    setListReady(false);
    setData(seed);
    setBoxCursor(seed?.pagination?.boxes.nextCursor ?? null);
    setFlows(parseAddrActivity(seed?.activity));
    setLoading(!seed);
    skipPack.current = true;
    txCursorRef.current = null;
    setTxCursor(null);
    txCursorStack.current = [];
    setTxPage(0);
    if (boxOffsetRef.current !== 0) {
      skipBoxPack.current = true;
      boxOffsetRef.current = 0;
      setBoxOffset(0);
    }
    if (tokenOffsetRef.current !== 0) {
      skipTokenPack.current = true;
      tokenOffsetRef.current = 0;
      setTokenOffset(0);
    }
    if (!address) return;

    const listsReady = tapeComplete(seed);
    setListsPending(!listsReady);
    if (seed) markSynced();

    const headerP = seed
      ? Promise.resolve()
      : fetch(`${getGateway()}/v1/page/address/${encodeURIComponent(address)}`)
          .then(async (r) => {
            const j = (await r.json()) as AddrData & { stale?: boolean; error?: string };
            if (!r.ok) {
              if (r.status === 503 || j?.stale || j?.error === "stale") throw new Error("stale");
              throw new Error(String(r.status));
            }
            return j;
          })
          .then((j) => {
            if (dead) return;
            putAddressPageCache(address, j);
            setData((prev) => mergeHeader(prev, j));
            setLoading(false);
            markSynced();
          })
          .catch((e) => {
            if (!dead && !seed) setErr(String(e));
          });

    const listsP = loadRef.current({ pageTx: true })
      .catch((e) => {
        if (!dead) setErr(String(e));
      })
      .finally(() => {
        if (!dead) {
          setListsPending(false);
          setLoading(false);
        }
      });

    void Promise.all([headerP, listsP]);
    return () => {
      dead = true;
    };
  }, [address, markSynced]);

  useEffect(() => {
    if (skipPack.current) {
      skipPack.current = false;
      return;
    }
    setListsPending(true);
    void load({ pageTx: true })
      .catch((e) => setErr(String(e)))
      .finally(() => setListsPending(false));
  }, [txCursor, load]);

  useEffect(() => {
    if (skipBoxPack.current) {
      skipBoxPack.current = false;
      return;
    }
    setListsPending(true);
    void load({ pageBox: true })
      .catch((e) => setErr(String(e)))
      .finally(() => setListsPending(false));
  }, [boxOffset, load]);

  useEffect(() => {
    if (tab !== "boxes" || !address) return;
    if (dataRef.current?.sources?.boxes === "indexer") return;
    let dead = false;
    setListsPending(true);
    void load({ pageBox: true })
      .catch((e) => {
        if (!dead) setErr(String(e));
      })
      .finally(() => {
        if (!dead) setListsPending(false);
      });
    return () => {
      dead = true;
    };
  }, [tab, address, load]);

  useEffect(() => {
    if (skipTokenPack.current) {
      skipTokenPack.current = false;
      return;
    }
    if (tab !== "tokens") return;
    const rows = (data?.balance?.tokens ?? []).filter(
      (row) => row.emission !== 1 && !nftIds.has(row.tokenId)
    );
    tokenEnter.mark(
      rows.slice(tokenOffset, tokenOffset + TOKEN_PAGE).map((row) => row.tokenId)
    );
  }, [tokenOffset, tab, tokenEnter.mark, data?.balance?.tokens, nftIds]);

  useEffect(() => {
    if (opened.current) return;
    if (listsPending) return;
    if (!tapeComplete(data)) return;
    opened.current = true;
    const ids = (data ? activityRows(data) : []).map((tx) => String(tx.id));
    txEnter.mark(ids);
    if (ids.length) packEnter.mark(["pack"]);
    setListReady(true);
  }, [listsPending, data, txEnter.mark, packEnter.mark]);

  useEffect(() => {
    if (tab === "activity") {
      txEnter.mark((data ? activityRows(data) : []).map((tx) => String(tx.id)));
    } else if (tab === "boxes") {
      boxEnter.mark((data?.unspentBoxes ?? []).map((b) => b.boxId));
    } else if (tab === "tokens") {
      tokenEnter.mark(
        (data?.balance?.tokens ?? [])
          .filter((row) => row.emission !== 1 && !nftIds.has(row.tokenId))
          .slice(tokenOffset, tokenOffset + TOKEN_PAGE)
          .map((row) => row.tokenId)
      );
    } else if (tab === "nfts") {
      nftEnter.mark(nfts.map((row) => row.tokenId));
    }
    // Replay keyed enter when the tab panel remounts (same motion as Tokens).
  }, [tab, txEnter.mark, boxEnter.mark, tokenEnter.mark, nftEnter.mark]);

  useEffect(() => {
    void fetch(`${getGateway()}/v1/prices/erg`)
      .then((r) => r.json())
      .then((j: { usd?: number }) => setErgUsd(j.usd && j.usd > 0 ? j.usd : null))
      .catch(() => null);
  }, [address]);

  useEffect(() => {
    if (tab !== "tokens" || !address) return;
    if (tokensFetched.current || tokensInflight.current) return;
    if ((data?.balance?.tokens?.length ?? 0) > 0) {
      tokensFetched.current = true;
      setTokensSettled(true);
      return;
    }
    tokensInflight.current = true;
    let dead = false;
    setTokensSettled(false);
    setTokensFailed(false);
    setTokensLoading(true);
    void fetch(
      `${getGateway()}/v1/addresses/${encodeURIComponent(address)}/tokens`
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<{
          tokens?: Array<{
            tokenId: string;
            amount: string;
            name: string | null;
            decimals: number;
            emission?: number | null;
            artworkUrl?: string | null;
            amountUi?: number | null;
            priceUsd?: number | null;
            valueUsd?: number | null;
            firstHeight?: number | null;
            lastHeight?: number | null;
            firstTs?: number | null;
            lastTs?: number | null;
          }>;
        }>;
      })
      .then((j) => {
        if (dead) return;
        tokensFetched.current = true;
        const tokens: TokenRow[] = (j.tokens ?? []).map((row) => ({
          tokenId: row.tokenId,
          amount: row.amount,
          amountUi: row.amountUi ?? null,
          name: row.name,
          decimals: row.decimals ?? 0,
          emission: row.emission ?? null,
          artworkUrl: row.artworkUrl ?? null,
          priceUsd: row.priceUsd ?? null,
          valueUsd: row.valueUsd ?? null,
          firstHeight: row.firstHeight ?? null,
          lastHeight: row.lastHeight ?? null,
          firstTs: row.firstTs ?? null,
          lastTs: row.lastTs ?? null,
        }));
        setData((prev) =>
          prev
            ? {
                ...prev,
                balance: { ...prev.balance, tokens },
              }
            : prev
        );
      })
      .catch(() => {
        if (!dead) setTokensFailed(true);
      })
      .finally(() => {
        tokensInflight.current = false;
        if (!dead) {
          setTokensLoading(false);
          setTokensSettled(true);
        }
      });
    return () => {
      dead = true;
    };
  }, [tab, address, data?.balance?.tokens?.length]);

  useEffect(() => {
    if (tab !== "nfts" || !address) return;
    const key = `${address}:${nftOffset}`;
    if (nftsPackKey === key) return;
    let dead = false;
    const keep = nfts.length > 0;
    setNftsLoading(true);
    setNftsFailed(false);
    void fetch(
      `${getGateway()}/v1/addresses/${encodeURIComponent(address)}/nfts?limit=${NFT_PAGE}&offset=${nftOffset}`,
      { cache: "no-store" }
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<{ items?: AddrNftRow[]; total?: number }>;
      })
      .then((j) => {
        if (dead) return;
        const items = j.items ?? [];
        setNftsPackKey(key);
        setNfts(items);
        setNftTotal(Number(j.total ?? items.length));
        setNftsFailed(false);
        nftEnter.mark(items.map((row) => row.tokenId));
      })
      .catch(() => {
        if (dead) return;
        if (!keep) {
          setNfts([]);
          setNftTotal(0);
          setNftsFailed(true);
        }
      })
      .finally(() => {
        if (!dead) setNftsLoading(false);
      });
    return () => {
      dead = true;
    };
  }, [tab, address, nftOffset, nftEnter.mark, nfts.length, nftsPackKey]);

  const confirmed = toBigIntAmt(data?.balance?.confirmedNanoErg);
  const unconfirmed = toBigIntAmt(data?.balance?.unconfirmedNanoErg);
  const usd = nanoToUsd(confirmed, ergUsd);
  const tokenMeta = useMemo(() => {
    const m = new Map<string, TokenRow>();
    for (const row of data?.balance?.tokens ?? []) {
      if (row.tokenId) m.set(row.tokenId.toLowerCase(), row);
    }
    for (const act of Object.values(data?.activity ?? {})) {
      if (!act) continue;
      for (const tok of act.tokens ?? []) {
        if (!tok.tokenId) continue;
        const k = tok.tokenId.toLowerCase();
        if (m.has(k)) continue;
        m.set(k, {
          tokenId: tok.tokenId,
          amount: tok.amount,
          amountUi: null,
          name: tok.name ?? null,
          decimals: tok.decimals ?? 0,
          emission: null,
          priceUsd: null,
          valueUsd: null,
        });
      }
    }
    return m;
  }, [data?.balance?.tokens, data?.activity]);

  const lastTs = useMemo(() => {
    const times: Array<number | null | undefined> = [data?.lastTs];
    for (const tx of [...(data?.mempoolTxs ?? []), ...(data?.recentTxs ?? [])]) {
      times.push(tx.timestamp);
    }
    return laterEpochMs(...times);
  }, [data?.lastTs, data?.recentTxs, data?.mempoolTxs]);

  const firstTs = useMemo(() => {
    const fromSnap = toEpochMs(data?.firstTs);
    if (fromSnap != null) return fromSnap;
    if (!data?.pagination || data.pagination?.txs?.hasMore) return null;
    let min: number | null = null;
    for (const tx of data.recentTxs ?? []) {
      const ms = toEpochMs(tx.timestamp);
      if (ms == null) continue;
      if (min == null || ms < min) min = ms;
    }
    return min;
  }, [data]);

  const boxCount = data?.pagination?.boxes?.total ?? data?.unspentBoxes?.length ?? 0;
  const txCount = data?.pagination?.txs?.total ?? data?.recentTxs?.length ?? 0;
  const tapeRows = data ? activityRows(data) : [];
  const tokenRows = useMemo(() => {
    const rows = (data?.balance?.tokens ?? []).filter(
      (row) => row.emission !== 1 && !nftIds.has(row.tokenId)
    );
    return [...rows].sort((a, b) => {
      const av = a.valueUsd != null && a.valueUsd > 0 ? a.valueUsd : -1;
      const bv = b.valueUsd != null && b.valueUsd > 0 ? b.valueUsd : -1;
      if (av !== bv) return bv - av;
      if (a.amountUi != null && b.amountUi != null && a.amountUi !== b.amountUi) {
        return b.amountUi - a.amountUi;
      }
      try {
        const na = toBigIntAmt(a.amount);
        const nb = toBigIntAmt(b.amount);
        if (na !== nb) return na > nb ? -1 : 1;
      } catch {
        /* */
      }
      return a.tokenId.localeCompare(b.tokenId);
    });
  }, [data?.balance?.tokens, nftIds]);
  const tokenCount =
    (data?.tokenCount ?? 0) > 0 ? (data?.tokenCount ?? 0) : tokenRows.length;
  const rentTone = rentBlocks == null ? null : rentTapeTone(rentBlocks);
  const tokenPage = tokenRows.slice(tokenOffset, tokenOffset + TOKEN_PAGE);
  const tokenUsd = useMemo(() => {
    let sum = 0;
    let any = false;
    for (const row of data?.balance?.tokens ?? []) {
      if (row.valueUsd == null) continue;
      any = true;
      sum += row.valueUsd;
    }
    return any ? sum : null;
  }, [data?.balance?.tokens]);
  const typeLabel = t(`address.type.${party.kind}`);

  const name = party.known ?? data?.name?.name ?? address;
  /** Unnamed and longer than a key address (51): printed whole it stretched the whole tile row. */
  const bareLong = !(party.known || data?.name) && address.length > BARE_TITLE_MAX;
  const tokensFirstWait =
    !tokensSettled && tokenRows.length === 0 && !tokensFailed;
  const nftsFirstWait =
    nfts.length === 0 &&
    !nftsFailed &&
    nftsPackKey !== `${address}:${nftOffset}`;
  const boxesFirstWait =
    listsPending && !(data?.unspentBoxes?.length) && boxOffset === 0;
  const activityFirstWait =
    !listReady && !err && tapeRows.length === 0 && txPage === 0;
  const tabScanWait =
    (tab === "tokens" && tokensFirstWait) ||
    (tab === "nfts" && nftsFirstWait) ||
    (tab === "boxes" && boxesFirstWait) ||
    (tab === "activity" && activityFirstWait);
  const scanWait = useScanWait(tabScanWait);

  /** One switch for both bars: the desktop segments and the phone strip. */
  const pickAddrTab = (idTab: AddrTab) => {
    if (idTab === tab) {
      setHashTab(idTab);
      return;
    }
    if (idTab === "activity") {
      txEnter.mark((data ? activityRows(data) : []).map((tx) => String(tx.id)));
    } else if (idTab === "boxes") {
      boxEnter.mark((data?.unspentBoxes ?? []).map((b) => b.boxId));
    } else if (idTab === "nfts") {
      nftEnter.mark(nfts.map((row) => row.tokenId));
    } else {
      tokenEnter.mark(
        tokenRows.slice(tokenOffset, tokenOffset + TOKEN_PAGE).map((row) => row.tokenId)
      );
    }
    setTab(idTab);
    setHashTab(idTab);
  };
  const txsKnown =
    data?.pagination?.txs?.total ??
    (data?.pagination && !data.pagination.txs?.hasMore ? (data.recentTxs?.length ?? null) : null);
  const phoneTabs: DetailTabItem<AddrTab>[] = ADDR_TABS.map((idTab) => ({
    id: idTab,
    label: t(`address.tab.${idTab}`),
    count:
      idTab === "activity"
        ? tabCount(txsKnown, locale)
        : idTab === "tokens"
          ? (data?.balance?.tokens?.length ?? 0) > 0
            ? tabCount(tokenRows.length, locale)
            : null
          : idTab === "nfts"
            ? tabCount(nftTotal, locale)
            : tabCount(
                boxCount,
                locale,
                Boolean(data?.pagination?.boxes?.hasMore && data?.pagination?.boxes?.total == null)
              ),
  }));
  const lastFresh = lastTs != null && Date.now() - lastTs < 86_400_000;

  return (
    <Shell>
      {scanWait.bar ? (
        <ScanWait label={t("common.loading")} />
      ) : null}
      {loading && !data && <AddressPageSkeleton />}
      {err && !data && (
        <p className="text-amber-300">
          {addrFailCopy(err, t)}
        </p>
      )}

      {data && (
        <div className="addr-page">
          <div className="addr-facts">
            <div className="addr-lane">
            <div className="col-span-2 flex min-h-0 flex-col gap-2 lg:col-span-1 lg:row-span-2">
              <AddrFactCard
                className="detail-sum min-h-0 h-auto flex-1"
                enter={0}
                label={typeLabel}
                ink={INK.violet}
                mark={
                  <AddressPip
                    address={address}
                    nanoerg={String(data.balance?.confirmedNanoErg ?? "0")}
                    kindLabel={name}
                    kindGlyph
                    className="h-10 w-10"
                  />
                }
              >
                <h1
                  className={clsx(
                    "mt-0.5 min-w-0 text-[17px] font-semibold leading-[1.15] tracking-tight",
                    !(party.known || data.name) && "font-mono"
                  )}
                >
                  {bareLong ? (
                    // Contract addresses run to thousands of characters: two lines, head and tail.
                    <span className="addr-title-long">
                      <span className="addr-title-head">{address.slice(0, Math.ceil(address.length / 2))}</span>
                      <span className="addr-title-tail">{address.slice(Math.ceil(address.length / 2))}</span>
                    </span>
                  ) : (
                    <NameMarquee text={name} fade />
                  )}
                </h1>
                <p className="detail-sum-id mt-0.5 flex min-w-0 items-center gap-1">
                  <code className="min-w-0 truncate font-mono text-[12px] leading-[1.15] text-[var(--muted-2)]">
                    {shortId(address, 8)}
                  </code>
                  <CopyChip text={address} copyLabel={t("tx.copy")} copiedLabel={t("tx.copied")} />
                  <FavoriteHeart
                    on={fav.on}
                    ready={fav.ready}
                    title={fav.on ? t("favorites.remove") : t("favorites.add")}
                    onToggle={fav.toggle}
                  />
                </p>
                {lastTs != null ? (
                  <p className={clsx("detail-sum-status lg:hidden", lastFresh && "is-ok")}>
                    {t("detail.lastActivity").replace("{t}", formatRelTime(lastTs, locale))}
                  </p>
                ) : null}
                <AddressNameSource
                  address={address}
                  name={data.name ?? null}
                  named={Boolean(party.known)}
                  t={t}
                />
              </AddrFactCard>
              <SegBar cols={4} className="addr-seg detail-desk-tabs shrink-0">
                {ADDR_TABS.map((idTab) => (
                  <a
                    key={idTab}
                    href={`#${idTab}`}
                    onClick={(e) => {
                      e.preventDefault();
                      pickAddrTab(idTab);
                    }}
                    className={segItem(tab === idTab)}
                  >
                    {t(`address.tab.${idTab}`)}
                  </a>
                ))}
              </SegBar>
            </div>

            <AddrFactCard
              className={clsx(
                "addr-fact-balance col-span-2 lg:col-span-1 lg:row-span-2",
                rentTone && "is-rent",
                rentTone === "soon" && "is-rent-soon",
                rentTone === "due" && "is-rent-due"
              )}
              enter={1}
              beacon={Boolean(rentTone) && tileLanded}
              label={t("address.card.balance")}
              ink={INK.cyan}
              mark={<KpiMark id="wallet" />}
              end={
                <AddressQr
                  embed
                  enter={6}
                  address={address}
                  label={t("address.card.qr")}
                  copyLabel={t("address.qrCopy")}
                  copiedLabel={t("address.qrCopied")}
                />
              }
            >
              <div className="mt-2 min-w-0">
                <KpiNum className="max-w-none">
                  <ErgFigure nano={confirmed} locale={locale} size="lg" />
                </KpiNum>
                {usd != null && (
                  <p
                    className="mt-2 text-[13px] font-medium tabular-nums"
                    style={{ color: INK.violet }}
                  >
                    ${formatGroupedNumber(usd, 2, 2, locale)}
                  </p>
                )}
                {unconfirmed !== 0n && (
                  <p className="addr-pending-blink mt-2 text-[12px] text-[var(--muted-2)]">
                    {t("address.unconfirmed")}{" "}
                    <ErgFigure
                      nano={unconfirmed}
                      locale={locale}
                      signed
                      tone={unconfirmed > 0n ? "up" : "down"}
                    />
                  </p>
                )}
              </div>
            </AddrFactCard>

            <AddrFactCard
              className="addr-facts-stat"
              enter={2}
              label={t("address.boxes")}
              ink={INK.sky}
              mark={<KpiMark id="box" />}
            >
              <p className="mt-0.5 text-[22px] font-semibold leading-[1.15] tabular-nums tracking-tight">
                <KpiNum compact={compactFigure(boxCount)}>
                  {`${boxCount.toLocaleString(loc(locale))}${
                    data.pagination?.boxes?.hasMore && data.pagination?.boxes?.total == null ? "+" : ""
                  }`}
                </KpiNum>
              </p>
              <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
                {t("address.cap.boxes")}
              </p>
            </AddrFactCard>

            <AddrFactCard
              className="addr-facts-stat"
              enter={3}
              label={t("address.tokens")}
              ink={INK.gold}
              mark={<KpiMark id="token" />}
            >
              <p
                className={clsx(
                  "mt-0.5 text-[22px] font-semibold leading-[1.15] tabular-nums tracking-tight",
                  tokenCount <= 0 && "text-[var(--muted)]"
                )}
              >
                {tokenCount > 0 ? <KpiNum>{String(tokenCount)}</KpiNum> : "—"}
              </p>
              <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
                {tokenUsd != null ? <PrettyUsd n={tokenUsd} /> : t("address.cap.tokens")}
              </p>
            </AddrFactCard>

            <AddrFactCard
              className="addr-facts-stat"
              enter={4}
              label={t("address.txs")}
              ink={INK.cyan}
              mark={<KpiMark id="tx" />}
            >
              <p className="mt-0.5 text-[22px] font-semibold leading-[1.15] tabular-nums tracking-tight">
                <KpiNum compact={compactFigure(txCount)}>{txCount.toLocaleString(loc(locale))}</KpiNum>
              </p>
              <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
                {t("address.cap.txs")}
              </p>
            </AddrFactCard>

            <AddrFactCard
              className="addr-facts-stat"
              enter={5}
              label={t("address.card.activity")}
              ink={INK.teal}
              mark={<KpiMark id="activity" />}
            >
              <p className="mt-0.5 text-[22px] font-semibold leading-[1.15] tabular-nums tracking-tight">
                <KpiNum>{lastTs != null ? formatRelTime(lastTs, locale) : "—"}</KpiNum>
              </p>
              <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
                {firstTs != null
                  ? `${t("address.firstActivity")} · ${formatRelTime(firstTs, locale)}`
                  : t("address.cap.activity")}
              </p>
            </AddrFactCard>
            </div>
            <AddressQr
              enter={6}
              address={address}
              label={t("address.card.qr")}
              copyLabel={t("address.qrCopy")}
              copiedLabel={t("address.qrCopied")}
            />
          </div>

          <DetailTabs tabs={phoneTabs} active={tab} onPick={pickAddrTab} label={t("detail.tabs")} />

          {tab === "activity" && (
            <div className="addr-facts-body mt-2">
              {activityFirstWait ? (
                <Feed>
                  <FeedSkeleton />
                </Feed>
              ) : err && !tapeRows.length && txPage === 0 ? (
                <Feed>
                  <FeedEmpty k="quiet" title={addrFailCopy(err, t)} />
                </Feed>
              ) : !tapeRows.length && txPage === 0 ? (
                <Feed>
                  <FeedEmpty k="addr" title={t("address.noTxs")} />
                </Feed>
              ) : null}
              {listReady && (tapeRows.length > 0 || txPage > 0) && (
                <div className="feed-sheet">
                  <div ref={pinRef} className="h-px w-full" aria-hidden />
                  <Feed busy={listsPending} enterClass={packEnter.enterClass("pack")}>
                    <ActivityFeed
                      rows={tapeRows}
                      flows={flows}
                      tokenMeta={tokenMeta}
                      self={address}
                      enterClass={txEnter.enterClass}
                    />
                  </Feed>
                  <RankWindow
                    offset={txPage * TX_PAGE}
                    pageSize={TX_PAGE}
                    shown={(data.recentTxs?.length ?? 0)}
                    total={txCount > 0 ? txCount : null}
                    hasMore={addrTapeHasMore(
                      (data.recentTxs?.length ?? 0),
                      txCount,
                      data.pagination?.txs?.hasMore
                    )}
                    scrub={false}
                    loc={loc(locale)}
                    ofLabel={t("addresses.packOf")}
                    prevLabel={t("addresses.packPrev")}
                    nextLabel={t("addresses.packNext")}
                    tapeLabel={t("address.packTape")}
                    hint={t("address.packHint")}
                    disabled={listsPending}
                    onOffset={(next) => {
                      const cur = txPage * TX_PAGE;
                      if (next < cur) {
                        const prevCur = txCursorStack.current.pop() ?? null;
                        skipPack.current = true;
                        txCursorRef.current = prevCur;
                        setTxCursor(prevCur);
                        setListsPending(true);
                        void load({ pageTx: true })
                          .catch((e) => setErr(String(e)))
                          .finally(() => setListsPending(false));
                        return;
                      }
                      if (next <= cur) return;
                      const nxt = moreTxCursor(data);
                      if (
                        !addrTapeHasMore(
                          (data.recentTxs?.length ?? 0),
                          txCount,
                          data.pagination?.txs?.hasMore
                        ) ||
                        !nxt
                      ) {
                        return;
                      }
                      txCursorStack.current.push(txCursorRef.current);
                      txCursorRef.current = nxt;
                      skipPack.current = true;
                      setTxCursor(nxt);
                      setListsPending(true);
                      void load({ pageTx: true })
                        .catch((e) => setErr(String(e)))
                        .finally(() => setListsPending(false));
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {tab === "tokens" && (
            <div className="addr-facts-body mt-2">
              {tokensFirstWait ? null : tokensFailed && !tokenRows.length ? (
                <p className="text-[var(--muted)]">{t("address.err")}</p>
              ) : !tokenRows.length ? (
                <FavKayolo line={t("address.noTokens")} />
              ) : (
                <div className="feed-sheet">
                  <Feed className="is-rank" busy={tokensLoading && tokenRows.length > 0}>
                    <FeedBoard
                      plate={
                        <FeedPlate
                          tag={t("address.tab.tokens")}
                          now
                          count={<FeedCount k="feed.tokens" n={tokenRows.length} />}
                        />
                      }
                    >
                      {tokenPage.map((row, i) => (
                        <AddressHoldingRow
                          key={row.tokenId}
                          row={row}
                          rank={tokenOffset + i + 1}
                          enterClass={tokenEnter.enterClass(row.tokenId)}
                        />
                      ))}
                    </FeedBoard>
                  </Feed>
                  <RankWindow
                    offset={tokenOffset}
                    pageSize={TOKEN_PAGE}
                    shown={tokenPage.length}
                    total={tokenRows.length > 0 ? tokenRows.length : null}
                    loc={loc(locale)}
                    ofLabel={t("addresses.packOf")}
                    prevLabel={t("addresses.packPrev")}
                    nextLabel={t("addresses.packNext")}
                    tapeLabel={t("address.packTapeTokens")}
                    hint={t("address.packHintTokens")}
                    disabled={tokensLoading}
                    onOffset={setTokenOffset}
                  />
                </div>
              )}
            </div>
          )}

          {tab === "nfts" && (
            <div className="addr-facts-body mt-2">
              {nftsFirstWait ? null : nftsFailed && !nfts.length ? (
                <p className="text-[var(--muted)]">{t("address.err")}</p>
              ) : !nftTotal && !nfts.length ? (
                <FavKayolo line={t("address.noNfts")} />
              ) : (
                <div className="feed-sheet">
                  <Feed busy={nftsLoading && nfts.length > 0}>
                    <section className="feed-day feed-gallery">
                    <FeedPlate
                      tag={t("address.tab.nfts")}
                      now
                      count={<FeedCount k="feed.nfts" n={nftTotal > 0 ? nftTotal : nfts.length} />}
                    />
                    <div className="addr-nft-grid">
                      {nfts.map((row) => (
                        <NftCard
                          key={row.tokenId}
                          item={{
                            tokenId: row.tokenId,
                            name: row.name,
                            artworkUrl: row.artworkUrl,
                            // An ErgoDex V3 position: «LP · ERG/SigRSV».
                            ...(row.lp?.kind === "cl-key"
                              ? { collection: null, kind: "lp", kindLabel: t("nfts.kind.lp"), meta: row.lp.pair }
                              : {
                                  collection: row.collection,
                                  kind: row.kind,
                                  kindLabel: row.kind ? t(`nfts.kind.${row.kind}`) : null,
                                }),
                          }}
                          enterClass={nftEnter.enterClass(row.tokenId)}
                        />
                      ))}
                    </div>
                    </section>
                  </Feed>
                  <RankWindow
                    offset={nftOffset}
                    pageSize={NFT_PAGE}
                    shown={nfts.length}
                    total={nftTotal > 0 ? nftTotal : null}
                    loc={loc(locale)}
                    ofLabel={t("addresses.packOf")}
                    prevLabel={t("addresses.packPrev")}
                    nextLabel={t("addresses.packNext")}
                    tapeLabel={t("address.packTapeNfts")}
                    hint={t("address.packHintNfts")}
                    disabled={nftsLoading}
                    onOffset={setNftOffset}
                  />
                </div>
              )}
            </div>
          )}

          {tab === "boxes" && (
            <div className="addr-facts-body mt-2">
              {!listsPending &&
                !(data.unspentBoxes?.length ?? 0) &&
                boxOffset === 0 &&
                data.sources?.boxes === "stale" && (
                <p className="text-[var(--muted)]">{t("address.boxesTimeout")}</p>
              )}
              {!listsPending &&
                !(data.unspentBoxes?.length ?? 0) &&
                boxOffset === 0 &&
                data.sources?.boxes !== "stale" &&
                data.sources?.boxes !== "deferred" && (
                <FavKayolo line={t("address.noBoxes")} />
              )}
              {((data.unspentBoxes?.length ?? 0) > 0 || boxOffset > 0) && (
                <div className="feed-sheet">
                  <Feed className="is-rank" busy={listsPending}>
                    <FeedBoard
                      plate={
                        <FeedPlate
                          tag={t("address.tab.boxes")}
                          now
                          count={<FeedCount k="feed.boxes" n={boxCount > 0 ? boxCount : (data.unspentBoxes?.length ?? 0)} />}
                        />
                      }
                    >
                      {(data.unspentBoxes ?? []).map((b, i) => (
                        <FeedBoxRow
                          key={b.boxId}
                          boxId={b.boxId}
                          nano={toBigIntAmt(b.value)}
                          tokens={boxTokens(b)}
                          meta={(tid) => tokenMeta.get(tid.toLowerCase())}
                          lead={{ rank: (boxOffset + i + 1).toLocaleString(loc(locale)) }}
                          txId={b.transactionId}
                          index={b.index}
                          height={b.creationHeight}
                          enterClass={boxEnter.enterClass(b.boxId)}
                        />
                      ))}
                    </FeedBoard>
                  </Feed>
                  <RankWindow
                    offset={boxOffset}
                    pageSize={BOX_PAGE}
                    shown={(data.unspentBoxes?.length ?? 0)}
                    total={boxCount > 0 ? boxCount : null}
                    loc={loc(locale)}
                    ofLabel={t("addresses.packOf")}
                    prevLabel={t("addresses.packPrev")}
                    nextLabel={t("addresses.packNext")}
                    tapeLabel={t("address.packTapeBoxes")}
                    hint={t("address.packHintBoxes")}
                    disabled={listsPending}
                    onOffset={setBoxOffset}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}

function boxTokens(box: BoxRow): [string, bigint][] {
  return (box.assets ?? [])
    .map((a) => [a.tokenId.toLowerCase(), toBigIntAmt(a.amount)] as [string, bigint])
    .filter(([, n]) => n !== 0n);
}

function whenText(ts: number | null | undefined, height: number | null | undefined, locale: string): string | null {
  if (ts != null && ts > 0) return formatRelTime(ts, locale);
  return height != null ? `#${height.toLocaleString(loc(locale))}` : null;
}

function WhenValue({ ts, height, locale }: { ts?: number | null; height?: number | null; locale: string }) {
  const rel = ts != null && ts > 0 ? formatRelTime(ts, locale) : null;
  return (
    <span className="tabular-nums" suppressHydrationWarning>
      {ts != null && ts > 0 ? formatTs(ts) : "—"}
      {rel ? <span className="text-[var(--muted-2)]"> · {rel}</span> : null}
      {height != null ? (
        <span className="text-[var(--muted-2)]">
          {" · "}
          <Link prefetch={false} href={`/block/${height}`} className="hover:underline">
            {height.toLocaleString(loc(locale))}
          </Link>
        </span>
      ) : null}
    </span>
  );
}

/** A token this address holds: amount and dollar value; when it first came and last moved. */
function AddressHoldingRow({ row, rank, enterClass }: { row: TokenRow; rank: number; enterClass?: string }) {
  const { t, locale } = useI18n();
  const last = whenText(row.lastTs, row.lastHeight, locale);
  const first = whenText(row.firstTs, row.firstHeight, locale);
  return (
    <FeedHoldingRow
      tokenId={row.tokenId}
      name={row.name}
      decimals={row.decimals}
      artworkUrl={row.artworkUrl}
      amount={toBigIntAmt(row.amount)}
      priceUsd={row.priceUsd}
      valueUsd={row.valueUsd}
      lead={{ rank: rank.toLocaleString(loc(locale)) }}
      enterClass={enterClass}
      facts={
        <>
          {last ? (
            <span>
              <FeedPhrase text={t("feed.active")} value={last} />
            </span>
          ) : null}
          {first && first !== last ? (
            <span className="feed-wide">
              <FeedPhrase text={t("feed.first")} value={first} />
            </span>
          ) : null}
        </>
      }
      more={() => (
        <>
          <FeedField label={t("address.colFirst")}>
            <WhenValue ts={row.firstTs} height={row.firstHeight} locale={locale} />
          </FeedField>
          <FeedField label={t("address.colLast")}>
            <WhenValue ts={row.lastTs} height={row.lastHeight} locale={locale} />
          </FeedField>
        </>
      )}
    />
  );
}

function ErgFigure({
  nano,
  locale,
  signed = false,
  size = "md",
  tone,
}: {
  nano: bigint;
  locale?: string;
  signed?: boolean;
  size?: "sm" | "md" | "lg";
  tone?: "up" | "down";
}) {
  const sign = signed ? (nano > 0n ? "+" : nano < 0n ? "−" : "") : "";
  const core = formatErgPrecise(nano < 0n ? -nano : nano, locale, false);
  const dot = core.lastIndexOf(".");
  const intPart = dot === -1 ? core : core.slice(0, dot);
  const frac = dot === -1 ? null : core.slice(dot);
  return (
    <span
      className={clsx(
        "inline-block whitespace-nowrap tabular-nums tracking-tight",
        tone === "up"
          ? "text-[var(--up)]"
          : tone === "down"
            ? "text-[var(--down)]"
            : "text-[var(--text)]"
      )}
    >
      {sign}
      <span className={size === "lg" ? "text-[28px] font-semibold leading-none" : size === "sm" ? "text-[13px] font-medium" : "text-[15px] font-medium"}>
        {intPart}
        {frac}
      </span>
      <span
        className={clsx(
          "ml-1 shrink-0 font-medium",
          size === "lg" ? "text-[13px]" : "text-[12px]",
          tone ? "opacity-70" : "text-[var(--muted)]"
        )}
      >
        ERG
      </span>
    </span>
  );
}

/** Where the name came from, or a way to suggest one. Personal wallets get no suggest link. */
function AddressNameSource({
  address,
  name,
  named,
  t,
}: {
  address: string;
  name: AddressRegistryName | null;
  named: boolean;
  t: (k: string) => string;
}) {
  if (name?.source === "contracts") {
    // The site's book outranks the registry: its name is the title then, and it has no file here.
    if (named) return null;
    return (
      <p className="mt-1 min-w-0 -mr-[calc(2.75rem+0.5rem)] whitespace-nowrap text-[11px] leading-[1.2] text-[var(--muted-2)]">
        {t("address.nameByContract")}
      </p>
    );
  }
  if (name) {
    return (
      <p className="mt-1 min-w-0 -mr-[calc(2.75rem+0.5rem)] whitespace-nowrap text-[11px] leading-[1.2] text-[var(--muted-2)]">
        {t(name.by === "project" ? "address.nameByProject" : "address.nameByErgoscan")}
        {" · "}
        <a href={name.fileUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
          ergo-names
        </a>
      </p>
    );
  }
  if (named || isP2pkAddress(address)) return null;
  return (
    <p className="mt-1 text-[11px] leading-[1.2]">
      <a href={suggestNameUrl(address)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
        {t("address.suggestName")}
      </a>
    </p>
  );
}

function CopyChip({
  text,
  copyLabel,
  copiedLabel,
}: {
  text: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void copyText(text)?.then(() => {
          setOk(true);
          window.setTimeout(() => setOk(false), 1200);
        });
      }}
      className="chip-press inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-[6px] text-[var(--muted)] transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--wash)] hover:text-[var(--text)]"
      aria-label={ok ? copiedLabel : copyLabel}
    >
      {ok ? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M2.4 6.2 4.8 8.6 9.6 3.4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <rect x="4" y="4" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M3 8.2V3.4A1.2 1.2 0 0 1 4.2 2.2H8"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}
