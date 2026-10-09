"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import {
  KpiMarkBox,
  KpiMarkBubbles,
  KpiMarkFootprints,
  KpiMarkScrollText,
  KpiMarkWalletMinimal,
  KpiMarkWorkflow,
} from "@/components/kpi-marks";
import { KpiNum } from "@/components/KpiGrid";
import { NftCard } from "@/components/NftCard";
import {
  peekAddressPageCache,
  putAddressPageCache,
} from "@/lib/address-page-cache";
import { RankWindow } from "@/components/RankWindow";
import { SegBar, segItem } from "@/components/SegBar";
import { PrettyUsd } from "@/components/PrettyNum";
import { getGateway, getWsUrl } from "@/lib/config";
import { TokenLogo } from "@/components/TokenBadge";
import {
  formatErgPrecise,
  formatFactWhen,
  formatGroupedNumber,
  formatRelTime,
  formatScaledGlance,
  formatTs,
  nanoToUsd,
  relAgeTone,
  relAgeToneClass,
  shortId,
  toBigIntAmt,
  laterEpochMs,
  toEpochMs,
} from "@/lib/format";
import { describeParty, isFeeAddress, isP2pkAddress } from "@/lib/address-labels";
import { suggestNameUrl } from "@/lib/address-book";
import type { AddressRegistryName } from "@/lib/list-snapshots";
import { useFavorite } from "@/lib/favorites";
import { NameMarquee } from "@/components/NameMarquee";
import { tokenDecimals, tokenSymbol, tokenTickerInk } from "@/lib/token-meta";
import { type AddrFlow, type AddrFlowKind } from "@/lib/tx-flow";
import { asAddrFlowKind, rentTapeTone } from "@ergoscan/shared";
import { INK } from "@/lib/palette";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { setHashTab } from "@/lib/hash-tab";
import { useChainTipRefresh, useKeepFresh, usePageSync } from "@/lib/page-sync";
import { ENTER_MS, enteringIds, useEnterIds } from "@/lib/keyed-enter";
import { addrTapeHasMore, txKeysetCursor } from "@/lib/rank-window";
import { cachedScoutRent, lookupScoutRent } from "@/lib/scout-rent";

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
}

type AddrActivityJson = {
  kind: AddrFlowKind;
  erg: string;
  from?: string[];
  to?: string[];
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
    out[id] = {
      kind,
      erg: toBigIntAmt(row.erg),
      tokens,
      from: (row.from ?? []).filter((a) => typeof a === "string" && a),
      to: (row.to ?? []).filter((a) => typeof a === "string" && a),
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

function signedErg(nano: bigint, locale?: string): string {
  const body = formatErgPrecise(nano < 0n ? -nano : nano, locale);
  if (nano > 0n) return `+${body}`;
  if (nano < 0n) return `−${body}`;
  return body;
}

function signedTokenGlance(
  raw: bigint,
  decimals: number,
  locale?: string
): { text: string; exact: string } {
  const { text, exact } = formatScaledGlance(raw < 0n ? -raw : raw, decimals, locale);
  if (raw > 0n) return { text: `+${text}`, exact: `+${exact}` };
  if (raw < 0n) return { text: `−${text}`, exact: `−${exact}` };
  return { text, exact };
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
  const [stuck, setStuck] = useState(false);
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
    if (tab !== "activity" && tab !== "boxes" && tab !== "tokens") {
      setStuck(false);
      return;
    }
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
  }, [tab, data?.recentTxs?.length, data?.unspentBoxes?.length, data?.balance?.tokens?.length, txPage, boxOffset, tokenOffset]);

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

  return (
    <Shell>
      {scanWait.bar ? (
        <ScanWait slow={scanWait.slow} label={t("common.loading")} />
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
                className="min-h-0 h-auto flex-1"
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
                  <NameMarquee text={name} fade />
                </h1>
                <p className="mt-0.5 flex min-w-0 items-center gap-1">
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
                <AddressNameSource
                  address={address}
                  name={data.name ?? null}
                  named={Boolean(party.known)}
                  t={t}
                />
              </AddrFactCard>
              <SegBar cols={4} className="shrink-0">
                {ADDR_TABS.map((idTab) => (
                  <a
                    key={idTab}
                    href={`#${idTab}`}
                    onClick={(e) => {
                      e.preventDefault();
                      if (idTab === tab) {
                        setHashTab(idTab);
                        return;
                      }
                      if (idTab === "activity") {
                        txEnter.mark(
                          (data ? activityRows(data) : []).map((tx) => String(tx.id))
                        );
                      } else if (idTab === "boxes") {
                        boxEnter.mark(
                          (data.unspentBoxes ?? []).map((b) => b.boxId)
                        );
                      } else if (idTab === "nfts") {
                        nftEnter.mark(nfts.map((row) => row.tokenId));
                      } else {
                        tokenEnter.mark(
                          tokenRows
                            .slice(tokenOffset, tokenOffset + TOKEN_PAGE)
                            .map((row) => row.tokenId)
                        );
                      }
                      setTab(idTab);
                      setHashTab(idTab);
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
              mark={<KpiMarkWalletMinimal className="h-9 w-9" />}
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
                    ${formatGroupedNumber(usd, 2, 2)}
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
              mark={<KpiMarkBox className="h-9 w-9" />}
            >
              <p className="mt-0.5 text-[22px] font-semibold leading-[1.15] tabular-nums tracking-tight">
                <KpiNum>
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
              mark={<KpiMarkBubbles className="h-9 w-9" />}
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
              mark={<KpiMarkScrollText className="h-9 w-9" />}
            >
              <p className="mt-0.5 text-[22px] font-semibold leading-[1.15] tabular-nums tracking-tight">
                <KpiNum>{txCount.toLocaleString(loc(locale))}</KpiNum>
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
              mark={<KpiMarkFootprints className="h-9 w-9" />}
            >
              <p className="mt-0.5 text-[22px] font-semibold leading-[1.15] tabular-nums tracking-tight">
                <KpiNum>{lastTs != null ? formatRelTime(lastTs) : "—"}</KpiNum>
              </p>
              <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
                {firstTs != null
                  ? `${t("address.firstActivity")} · ${formatRelTime(firstTs)}`
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

          {tab === "activity" && (
            <div className="addr-facts-body mt-6">
              {activityFirstWait ? null : err && !tapeRows.length && txPage === 0 ? (
                <p className="text-[var(--muted)]">{addrFailCopy(err, t)}</p>
              ) : !tapeRows.length && txPage === 0 ? (
                <FavKayolo line={t("address.noTxs")} />
              ) : null}
              {listReady && (tapeRows.length > 0 || txPage > 0) && (
                <div className="addr-sheet">
                  <div ref={pinRef} className="h-px w-full" aria-hidden />
                  <div className={packEnter.enterClass("pack")}>
                  <div
                    className={clsx(
                      "addr-pan transition-opacity duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                      listsPending && "opacity-60"
                    )}
                  >
                    <div
                      className={clsx("addr-head addr-lane addr-lane-x addr-history", stuck && "is-stuck")}
                    >
                      <div className="block-lane-pair">
                        <span>{t("address.colKind")}</span>
                        <span className="justify-end tabular-nums">{t("address.colAmount")}</span>
                      </div>
                      <div className="min-w-0 justify-end">{t("tx.tab.tokens")}</div>
                      <div className="block-lane-pair">
                        <span>{t("address.colFrom")}</span>
                        <span className="justify-end">{t("address.colTo")}</span>
                      </div>
                      <div className="addr-tail">
                        <span>{t("address.colTx")}</span>
                        <div className="addr-when-pair">
                          <span className="justify-end">{t("tx.fee")}</span>
                          <span className="justify-end tabular-nums">{t("address.colHeight")}</span>
                          <span className="justify-end">{t("address.colTime")}</span>
                        </div>
                      </div>
                    </div>
                    {tapeRows.map((tx) => (
                      <HistoryRow
                        key={String(tx.id)}
                        tx={tx}
                        flow={flows[String(tx.id)]}
                        locale={locale}
                        t={t}
                        tokenMeta={tokenMeta}
                        selfAddress={address}
                        enterClass={txEnter.enterClass(String(tx.id))}
                      />
                    ))}
                  </div>
                  </div>
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
            <div className="addr-facts-body mt-6">
              {tokensFirstWait ? null : tokensFailed && !tokenRows.length ? (
                <p className="text-[var(--muted)]">{t("address.err")}</p>
              ) : !tokenRows.length ? (
                <FavKayolo line={t("address.noTokens")} />
              ) : (
                <div className="addr-sheet">
                  <div ref={pinRef} className="h-px w-full" aria-hidden />
                  <div
                    className={clsx(
                      "addr-pan transition-opacity duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                      tokensLoading && tokenRows.length > 0 && "opacity-60"
                    )}
                  >
                    <div
                      className={clsx(
                        "addr-head addr-lane addr-lane-x addr-token-tape text-[12px] font-medium",
                        stuck && "is-stuck"
                      )}
                    >
                      <div className="min-w-0">{t("address.colToken")}</div>
                      <div className="block-lane-pair min-w-0 justify-between">
                        <span>{t("address.colAmount")}</span>
                        <span className="justify-end">{t("address.colPrice")}</span>
                      </div>
                      <div className="min-w-0 justify-end">{t("address.colValue")}</div>
                      <div className="block-lane-pair min-w-0 justify-between">
                        <span>{t("address.colFirst")}</span>
                        <span className="justify-end">{t("address.colId")}</span>
                      </div>
                      <div className="min-w-0 justify-end">{t("address.colLast")}</div>
                    </div>
                    {tokenPage.map((row) => (
                      <TokenHistoryRow
                        key={row.tokenId}
                        row={row}
                        locale={locale}
                        enterClass={tokenEnter.enterClass(row.tokenId)}
                      />
                    ))}
                  </div>
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
            <div className="addr-facts-body mt-6">
              {nftsFirstWait ? null : nftsFailed && !nfts.length ? (
                <p className="text-[var(--muted)]">{t("address.err")}</p>
              ) : !nftTotal && !nfts.length ? (
                <FavKayolo line={t("address.noNfts")} />
              ) : (
                <div className="addr-sheet">
                  <div
                    className={clsx(
                      "transition-opacity duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                      nftsLoading && nfts.length > 0 && "opacity-60"
                    )}
                  >
                    <div className="addr-nft-grid">
                      {nfts.map((row) => (
                        <NftCard
                          key={row.tokenId}
                          item={{
                            tokenId: row.tokenId,
                            name: row.name,
                            collection: row.collection,
                            artworkUrl: row.artworkUrl,
                            kind: row.kind,
                            kindLabel: row.kind ? t(`nfts.kind.${row.kind}`) : null,
                          }}
                          enterClass={nftEnter.enterClass(row.tokenId)}
                        />
                      ))}
                    </div>
                  </div>
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
            <div className="addr-facts-body mt-6">
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
                <div className="addr-sheet">
                  <div ref={pinRef} className="h-px w-full" aria-hidden />
                  <div
                    className={clsx(
                      "addr-pan transition-opacity duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                      listsPending && "opacity-60"
                    )}
                  >
                    <div
                      className={clsx("addr-head addr-lane addr-lane-x addr-boxes", stuck && "is-stuck")}
                    >
                      <div className="min-w-0">{t("address.colBox")}</div>
                      <div className="min-w-0 justify-end">{t("address.colAmount")}</div>
                      <div className="min-w-0 justify-end">{t("tx.tab.tokens")}</div>
                      <div className="min-w-0 justify-end">{t("address.colTx")}</div>
                      <div className="min-w-0 justify-end">{t("address.colHeight")}</div>
                    </div>
                    {(data.unspentBoxes ?? []).map((b) => (
                      <BoxHistoryRow
                        key={b.boxId}
                        box={b}
                        locale={locale}
                        t={t}
                        tokenMeta={tokenMeta}
                        enterClass={boxEnter.enterClass(b.boxId)}
                      />
                    ))}
                  </div>
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

function TokenAmtText({
  amt,
  decimals,
  locale,
  label,
  href,
  tokenId,
  className,
  signed = false,
}: {
  amt: bigint;
  decimals: number;
  locale?: string;
  label?: string;
  href?: string;
  tokenId?: string;
  className?: string;
  signed?: boolean;
}) {
  const glance = signed
    ? signedTokenGlance(amt, decimals, locale)
    : formatScaledGlance(amt, decimals, locale);
  const suffix = label ? ` ${label}` : "";
  const full = `${glance.exact}${suffix}`;
  const nameInk = tokenId ? { color: tokenTickerInk(tokenId) } : undefined;
  return (
    <span className={clsx("inline-flex min-w-0 max-w-full items-baseline gap-1 whitespace-nowrap", className)} title={full} aria-label={full}>
      <span className="shrink-0">{glance.text}</span>
      {label ? (
        href ? (
          <Link href={href} className="min-w-0 hover:underline" style={nameInk}>
            <NameMarquee text={label} />
          </Link>
        ) : (
          <NameMarquee text={label} style={nameInk} />
        )
      ) : null}
    </span>
  );
}

function TokenFlowPeek({
  lines,
  tokenMeta,
  locale,
  moreLabel,
  signed = true,
}: {
  lines: [string, bigint][];
  tokenMeta: Map<string, TokenRow>;
  locale: string;
  moreLabel: string;
  signed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [box, setBox] = useState<{
    left: number;
    width: number;
    height: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const head = lines.slice(0, 2);
  const rest = lines.slice(2);

  useEffect(() => {
    if (!open) return;
    const onPtr = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onMove = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPtr);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("pointerdown", onPtr);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setUp(false);
      setBox(null);
      return;
    }
    const menu = menuRef.current;
    const cell = rootRef.current?.closest(".addr-token-cell");
    if (!menu || !(cell instanceof HTMLElement)) return;
    const cellBox = cell.getBoundingClientRect();
    const sheet = rootRef.current?.closest(".addr-sheet");
    const foot = sheet?.querySelector(".addr-foot");
    const cols = sheet?.querySelector(".addr-head");
    const floor =
      Math.min(
        foot instanceof HTMLElement ? foot.getBoundingClientRect().top : Infinity,
        window.innerHeight
      ) - 8;
    const ceil =
      (cols instanceof HTMLElement ? cols.getBoundingClientRect().bottom : 8) + 8;
    const need = menu.scrollHeight;
    const goUp = cellBox.bottom + need > floor;
    const anchor = goUp ? Math.min(cellBox.top, floor) : cellBox.bottom;
    const room = goUp ? anchor - ceil : floor - cellBox.bottom;
    const height = Math.min(need, Math.max(48, room));
    setUp(goUp);
    setBox({
      left: cellBox.left,
      width: cellBox.width,
      maxHeight: height,
      height,
      ...(goUp
        ? { bottom: window.innerHeight - anchor }
        : { top: cellBox.bottom }),
    });
  }, [open, rest.length]);

  if (!lines.length) return null;

  const paint = (tid: string, amt: bigint, className: string) => {
    const meta = tokenMeta.get(tid.toLowerCase());
    const label = tokenSymbol(tid, meta?.name) || shortId(tid, 4);
    return (
      <TokenAmtText
        key={tid}
        amt={amt}
        decimals={tokenDecimals(tid, meta?.decimals)}
        locale={locale}
        label={label}
        tokenId={tid}
        href={`/token/${tid}`}
        signed={signed}
        className={clsx(
          "min-w-0 text-[12px] tabular-nums",
          signed
            ? amt > 0n
              ? "text-[var(--up)]"
              : "text-[var(--down)]"
            : "text-[var(--text)]",
          className
        )}
      />
    );
  };

  return (
    <div ref={rootRef} className="addr-token-peek">
      <div className="addr-token-peek-line">
        {head.map(([tid, amt], i) =>
          paint(
            tid,
            amt,
            i < head.length - 1
              ? "flex-1 overflow-hidden"
              : head.length > 1
                ? "max-w-[58%]"
                : "max-w-full"
          )
        )}
      </div>
      {rest.length > 0 && (
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => setOpen((v) => !v)}
          className={clsx(
            "chip-press mt-0.5 inline-flex shrink-0 items-center self-end overflow-hidden rounded-[10px] py-0.5 pl-2 pr-0 text-[12px] font-medium leading-none transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
            open
              ? "is-pressed bg-[var(--wash-strong)] text-[var(--text)]"
              : "text-[var(--muted)] hover:text-[var(--text)]"
          )}
        >
          {moreLabel}
        </button>
      )}
      {rest.length > 0 &&
        open &&
        createPortal(
          <div
            ref={menuRef}
            className={clsx("addr-token-menu is-open", up && "is-up")}
            role="listbox"
            onWheel={(e) => e.stopPropagation()}
            onScroll={(e) => e.stopPropagation()}
            style={
              box
                ? {
                    left: box.left,
                    width: box.width,
                    height: box.height,
                    maxHeight: box.maxHeight,
                    top: box.top,
                    bottom: box.bottom,
                  }
                : { left: 0, top: 0, visibility: "hidden" }
            }
          >
            {rest.map(([tid, amt]) => paint(tid, amt, "max-w-full"))}
          </div>,
          document.body
        )}
    </div>
  );
}

function AddrParty({
  side,
  kind,
  addresses,
  selfAddress,
  thisLabel,
  multipleLabel,
  multipleHint,
}: {
  side: "from" | "to";
  kind: AddrFlowKind | null;
  addresses: string[];
  selfAddress: string;
  thisLabel: string;
  multipleLabel: string;
  multipleHint: string;
}) {
  const t = useT();
  const others: string[] = [];
  const seen = new Set<string>();
  let hasSelf = false;
  for (const raw of addresses) {
    const address = raw.trim();
    if (!address || seen.has(address)) continue;
    seen.add(address);
    if (address === selfAddress) hasSelf = true;
    else others.push(address);
  }
  const mine =
    (side === "from" && kind === "sent") ||
    (side === "to" && kind === "received") ||
    (others.length === 0 && hasSelf);
  if (mine) return <span className="addr-this truncate">{thisLabel}</span>;
  if (others.length > 1) {
    return (
      <span className="addr-multi truncate" title={multipleHint}>
        {multipleLabel}
      </span>
    );
  }
  if (others.length === 1) {
    const head = others[0] ?? "";
    const party = describeParty(head);
    const name = isFeeAddress(head) ? t("tx.minerFee") : party.known;
    const label = name || party.short || shortId(head, 6);
    return (
      <Link
        href={`/address/${encodeURIComponent(head)}`}
        data-addr={head}
        title={head}
        className={clsx(
          "addr-party min-w-0 max-w-full text-[13px] leading-none hover:underline",
          name ? "block w-full" : "truncate font-mono",
          side === "to" && "text-right"
        )}
      >
        {name ? <NameMarquee text={name} className={side === "to" ? "text-right" : undefined} /> : label}
      </Link>
    );
  }
  return <span className="text-[var(--muted)]">—</span>;
}

function HistoryRow({
  tx,
  flow,
  locale,
  t,
  tokenMeta,
  selfAddress,
  enterClass,
}: {
  tx: TxRow;
  flow: AddrFlow | null | undefined;
  locale: string;
  t: (k: string) => string;
  tokenMeta: Map<string, TokenRow>;
  selfAddress: string;
  enterClass?: string;
}) {
  const kindLabel: Record<AddrFlowKind, string> = {
    sent: t("address.sent"),
    received: t("address.received"),
    intra: t("address.intra"),
  };
  const tokenLines = flow
    ? [...flow.tokens.entries()].filter(([, n]) => n !== 0n)
    : [];
  const ms = toEpochMs(tx.timestamp);
  const amountTone =
    flow == null
      ? undefined
      : flow.erg > 0n
        ? "up"
        : flow.erg < 0n
          ? "down"
          : undefined;

  return (
    <div
      className={clsx(
        "addr-lane addr-lane-x addr-history border-t border-[var(--border-soft)] py-2.5 text-[13px]",
        enterClass
      )}
    >
      <div className="block-lane-pair">
        <div className="flex min-w-0 items-center gap-2 px-3">
          <FlowMark kind={flow?.kind} />
          <span className="truncate text-[var(--muted)]">
            {flow ? kindLabel[flow.kind] : t("detail.tx")}
          </span>
        </div>
        <div className="whitespace-nowrap px-3 text-right">
          {flow ? (
            <ErgFigure nano={flow.erg} locale={locale} signed tone={amountTone} size="sm" />
          ) : (
            "—"
          )}
        </div>
      </div>
      <div className="addr-token-cell flex min-w-0 items-center justify-end px-3">
        <TokenFlowPeek
          lines={tokenLines}
          tokenMeta={tokenMeta}
          locale={locale}
          moreLabel={t("address.more")}
        />
      </div>
      <div className="block-lane-pair">
        <div className="flex min-w-0 items-center px-3">
          <AddrParty
            side="from"
            kind={flow?.kind ?? null}
            addresses={flow?.from ?? []}
            selfAddress={selfAddress}
            thisLabel={t("address.thisAddress")}
            multipleLabel={t("address.multiple")}
            multipleHint={t("address.multipleHint")}
          />
        </div>
        <div className="flex min-w-0 items-center justify-end px-3">
          <AddrParty
            side="to"
            kind={flow?.kind ?? null}
            addresses={flow?.to ?? []}
            selfAddress={selfAddress}
            thisLabel={t("address.thisAddress")}
            multipleLabel={t("address.multiple")}
            multipleHint={t("address.multipleHint")}
          />
        </div>
      </div>
      <div className="addr-tail">
        <div className="flex min-w-0 items-center px-3">
          <Link
            href={`/tx/${tx.id}`}
            className="addr-tx-mark"
            title={String(tx.id)}
            aria-label={tx.mempool ? `${String(tx.id)} ${t("address.pending")}` : String(tx.id)}
          >
            <KpiMarkWorkflow className="!h-[18px] !w-[18px]" />
          </Link>
        </div>
        <div className="addr-when-pair">
          <div className="px-3 text-right">
            {tx.fee == null || tx.fee === "" ? (
              <span className="text-[var(--muted)]">—</span>
            ) : (
              <ErgFigure nano={toBigIntAmt(tx.fee)} locale={locale} size="sm" />
            )}
          </div>
          <div className="px-3 text-right">
            {tx.mempool ? (
              <span className="addr-pending-mark" title={t("address.inMempool")}>
                {t("address.inMempool")}
              </span>
            ) : tx.inclusionHeight != null ? (
              <Link
                href={`/block/${tx.inclusionHeight}`}
                className="tabular-nums text-accent hover:underline"
              >
                {tx.inclusionHeight.toLocaleString(loc(locale))}
              </Link>
            ) : (
              <span className="text-[var(--muted)]">—</span>
            )}
          </div>
          <div className="px-3 text-right">
            <p className={clsx("whitespace-nowrap tabular-nums", relAgeToneClass(relAgeTone(tx.timestamp)))}>
              {formatRelTime(tx.timestamp)}
            </p>
            {ms != null && (
              <p className="mt-0.5 whitespace-nowrap text-[12px] tabular-nums text-[var(--muted-2)]">
                {formatFactWhen(ms, locale)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BoxHistoryRow({
  box,
  locale,
  t,
  tokenMeta,
  enterClass,
}: {
  box: BoxRow;
  locale: string;
  t: (k: string) => string;
  tokenMeta: Map<string, TokenRow>;
  enterClass?: string;
}) {
  const tokenLines = (box.assets ?? [])
    .map((a) => [a.tokenId.toLowerCase(), toBigIntAmt(a.amount)] as [string, bigint])
    .filter(([, n]) => n !== 0n);
  const height = box.creationHeight;
  const title =
    box.index != null ? `${box.boxId} #${box.index}` : box.boxId;

  return (
    <div
      className={clsx(
        "addr-lane addr-lane-x addr-boxes border-t border-[var(--border-soft)] py-2.5 text-[13px]",
        enterClass
      )}
    >
      <Link
        href={`/box/${box.boxId}`}
        title={title}
        className="min-w-0 truncate px-3 font-mono text-[12px] text-accent hover:underline"
      >
        {shortId(box.boxId, 10)}
      </Link>
      <div className="flex min-w-0 items-center justify-end px-3">
        <ErgFigure nano={toBigIntAmt(box.value)} locale={locale} tone="up" />
      </div>
      <div className="addr-token-cell flex min-w-0 items-center justify-end px-3">
        <TokenFlowPeek
          lines={tokenLines}
          tokenMeta={tokenMeta}
          locale={locale}
          moreLabel={t("address.more")}
          signed={false}
        />
      </div>
      <div className="flex min-w-0 items-center justify-end px-3">
        {box.transactionId ? (
          <Link
            href={`/tx/${box.transactionId}`}
            title={box.transactionId}
            className="font-mono text-[12px] text-accent hover:underline"
          >
            {shortId(box.transactionId, 10)}
          </Link>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        )}
      </div>
      <div className="flex min-w-0 items-center justify-end px-3">
        {height != null ? (
          <Link
            href={`/block/${height}`}
            className="tabular-nums text-accent hover:underline"
          >
            {height.toLocaleString(loc(locale))}
          </Link>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        )}
      </div>
    </div>
  );
}

function TokenWhen({
  ts,
  height,
  locale,
  align,
}: {
  ts: number | null | undefined;
  height: number | null | undefined;
  locale: string;
  align: "left" | "right";
}) {
  const rel = ts != null ? formatRelTime(ts) : null;
  const title = ts != null ? formatTs(ts) : undefined;
  const label =
    rel && rel !== "—"
      ? rel
      : height != null
        ? `#${height.toLocaleString(loc(locale))}`
        : "—";
  const body =
    height != null ? (
      <Link
        href={`/block/${height}`}
        className="truncate hover:underline"
        title={title}
      >
        {label}
      </Link>
    ) : (
      <span className="truncate" title={title}>
        {label}
      </span>
    );
  return (
    <div
      className={clsx(
        "flex h-full min-w-0 items-center whitespace-nowrap px-3 tabular-nums text-[var(--muted)]",
        align === "right" && "justify-end text-right"
      )}
    >
      {body}
    </div>
  );
}

function TokenHistoryRow({
  row,
  locale,
  enterClass,
}: {
  row: TokenRow;
  locale: string;
  enterClass?: string;
}) {
  const title = row.name ? `${row.name} · ${row.tokenId}` : row.tokenId;
  const label = tokenSymbol(row.tokenId, row.name) || shortId(row.tokenId, 10);
  const href = `/token/${row.tokenId}`;
  return (
    <div
      className={clsx(
        "addr-lane addr-lane-x addr-token-tape border-t border-[var(--border-soft)] py-2.5 text-[13px]",
        enterClass
      )}
    >
      <div className="flex min-w-0 items-center gap-2 px-3">
        <TokenLogo tokenId={row.tokenId} artworkUrl={row.artworkUrl} size={20} />
        <Link
          href={href}
          title={title}
          className="min-w-0 font-medium hover:underline"
          style={{ color: tokenTickerInk(row.tokenId) }}
        >
          <NameMarquee text={label} />
        </Link>
      </div>
      <div className="block-lane-pair">
        <div className="flex min-w-0 items-center px-3 tabular-nums">
          <TokenAmtText
            amt={toBigIntAmt(row.amount)}
            decimals={tokenDecimals(row.tokenId, row.decimals)}
            locale={locale}
          />
        </div>
        <div className="flex min-w-0 items-center justify-end px-3 tabular-nums text-[var(--muted)]">
          <PrettyUsd n={row.priceUsd} digits={6} />
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-end px-3 tabular-nums text-accent">
        <PrettyUsd n={row.valueUsd} />
      </div>
      <div className="block-lane-pair">
        <TokenWhen ts={row.firstTs} height={row.firstHeight} locale={locale} align="left" />
        <Link
          href={href}
          title={row.tokenId}
          className="flex shrink-0 items-center justify-end whitespace-nowrap px-3 font-mono text-[12px] text-accent hover:underline"
        >
          {shortId(row.tokenId, 8)}
        </Link>
      </div>
      <TokenWhen ts={row.lastTs} height={row.lastHeight} locale={locale} align="right" />
    </div>
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

function FlowMark({ kind }: { kind?: AddrFlowKind }) {
  const tone =
    kind === "received"
      ? "text-[var(--up)]"
      : kind === "sent" || kind === "intra"
        ? "text-[var(--down)]"
        : "text-[var(--muted)]";
  return (
    <span className={clsx("flex h-[18px] w-[18px] shrink-0 items-center justify-center", tone)} aria-hidden>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        {kind === "sent" ? (
          <>
            <path
              d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
              stroke="currentColor"
              strokeWidth="1.65"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M16 17l5-5-5-5M21 12H9"
              stroke="currentColor"
              strokeWidth="1.65"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : kind === "received" ? (
          <>
            <path
              d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"
              stroke="currentColor"
              strokeWidth="1.65"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M10 17l5-5-5-5M15 12H3"
              stroke="currentColor"
              strokeWidth="1.65"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : kind === "intra" ? (
          <>
            <path
              d="M8 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"
              stroke="currentColor"
              strokeWidth="1.65"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M16 5h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3"
              stroke="currentColor"
              strokeWidth="1.65"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M9 9h6.5M13.3 6.7 15.5 9l-2.2 2.3M15 15H8.5M10.7 12.7 8.5 15l2.2 2.3"
              stroke="currentColor"
              strokeWidth="1.65"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : (
          <path
            d="M4 12h6M8 9l-3 3 3 3M20 12h-6M16 9l3 3-3 3"
            stroke="currentColor"
            strokeWidth="1.65"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
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
        void navigator.clipboard?.writeText(text).then(() => {
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
