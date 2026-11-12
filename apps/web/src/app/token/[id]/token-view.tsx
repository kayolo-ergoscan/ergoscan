"use client";

import { Tip, TipFigure } from "@/components/Tip";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { AddressPageSkeleton } from "@/components/AddressPageSkeleton";
import { AddrFactCard } from "@/components/AddrFactCard";
import {
  Feed,
  FeedAmount,
  FeedBoard,
  FeedCount,
  FeedDays,
  FeedEmpty,
  FeedField,
  FeedFields,
  FeedIdLine,
  FeedPlate,
  FeedRow,
  FeedSkeleton,
  FeedSort,
  type FeedLead,
} from "@/components/feed/Feed";
import { FeedHolderRow } from "@/components/feed/FeedHolderRow";
import { MeaningPhraseField, MeaningTitle, meaningFacts, meaningLang, useMeaningRow } from "@/components/feed/FeedMeaning";
import { meaningTile, parseMeaning } from "@/lib/tx-meaning-row";
import { MEANING_VOCAB, type CompactMeaning } from "@ergoscan/shared";
import { compactFigure, KpiLabelMark, KpiNum, KpiTileRail } from "@/components/KpiGrid";
import { KpiMark } from "@/components/kpi-marks";
import { NameMarquee } from "@/components/NameMarquee";
import { NftThumb } from "@/components/NftCard";
import { describeParty, isFeeAddress } from "@/lib/address-labels";
import { safeMediaUrl } from "@/lib/nft-art";
import { useMediaSrc } from "@/lib/use-media-src";
import { TokenAvatar } from "@/components/TokenBadge";
import { SegBar, segItem } from "@/components/SegBar";
import { RankWindow } from "@/components/RankWindow";
import { addrTapeHasMore, holderKeysetCursor, txKeysetCursor } from "@/lib/rank-window";
import { getGateway } from "@/lib/config";
import {
  formatEmissionGlance,
  formatRelTime,
  formatScaledAmount,
  formatStamp,
  shortId,
  toBigIntAmt,
  toEpochMs,
} from "@/lib/format";
import { tokenDescLines } from "@/lib/token-desc";
import { resolveTokenMeta, tokenTickerInk } from "@/lib/token-meta";
import { HOME, INK } from "@/lib/palette";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { setHashTab } from "@/lib/hash-tab";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";
import { SNAPSHOT_FETCH, enteringIds, useEnterIds } from "@/lib/keyed-enter";
import type { TokenHoldersPage, TokenListItem } from "@/lib/list-snapshots";
import { peekTokenHolders, putTokenHolders } from "@/lib/token-page-cache";
import { useFavoriteAddresses, useFavoriteOf } from "@/lib/favorites";

const HOLDERS_PACK = 25;
const TX_PACK = 25;
const TOKEN_TABS = ["holders", "txs", "swaps", "mintburn"] as const;
type Tab = (typeof TOKEN_TABS)[number];
type TokenTxKind = "mint" | "burn" | "transfer" | "swap";
type AmountDir = "asc" | "desc";

type TokenNft = {
  kind: string | null;
  sha256: string | null;
  url: string | null;
  coverUrl: string | null;
  extraUrls: string[];
  ipfsCid: string | null;
  royaltyPercent: number | null;
  collectionTokenId: string | null;
  collectionName: string | null;
  mintAddress: string | null;
  mintTxId: string | null;
  mintHeight: number | null;
};

interface TokenData {
  tokenId: string;
  name: string | null;
  description: string | null;
  decimals: number;
  emissionAmount: number | string | null;
  boxId: string | null;
  isNft?: boolean;
  artworkUrl?: string | null;
  nft?: TokenNft | null;
  holders?: number | null;
  txCount?: number | null;
  unspentBoxes?: number | null;
  firstHeight?: number | null;
  lastHeight?: number | null;
}

interface Holder {
  rank: number;
  address: string;
  amount: number | string;
  amountUi: number;
  boxes: number;
  sharePct: number | null;
  nanoerg?: string | null;
  txCount?: number | null;
  tokenCount?: number | null;
  firstTs?: number | null;
  lastTs?: number | null;
  firstTxId?: string | null;
  lastTxId?: string | null;
}

type HoldersData = TokenHoldersPage;

interface TokenTxRow {
  id: string;
  inclusionHeight: number | null;
  timestamp: number | null;
  created: string;
  spent: string;
  net: string;
  moved?: string;
  kind: TokenTxKind;
  from?: string[];
  to?: string[];
  /** What the tx did (gateway list form); absent on old responses. */
  meaning?: CompactMeaning;
}

function readTokenTab(): Tab {
  if (typeof window === "undefined") return "holders";
  const h = window.location.hash.replace("#", "");
  if (h === "transactions") return "txs";
  if (h === "swap" || h === "swaps") return "swaps";
  if (h === "mint" || h === "burn") return "mintburn";
  return TOKEN_TABS.includes(h as Tab) ? (h as Tab) : "holders";
}

function catalogHit(items: TokenListItem[] | undefined, tokenId: string): TokenListItem | null {
  const hit = (items ?? []).find((row) => row.tokenId.toLowerCase() === tokenId);
  return hit ?? null;
}

function catalogToTokenData(tokenId: string, row: TokenListItem | null): TokenData | null {
  if (!row) return null;
  return {
    tokenId,
    name: row.name,
    description: null,
    decimals: row.decimals,
    emissionAmount: row.emission,
    boxId: null,
    isNft: row.emission != null && Number(row.emission) === 1 && row.decimals === 0,
    artworkUrl: row.artworkUrl,
    holders: row.holders,
    txCount: row.txCount,
    unspentBoxes: row.unspentBoxes,
    firstHeight: row.firstHeight,
    lastHeight: row.lastHeight,
  };
}

function mergeTokenData(prev: TokenData | null, next: TokenData): TokenData {
  return {
    tokenId: next.tokenId || prev?.tokenId || "",
    name: next.name ?? prev?.name ?? null,
    description: next.description ?? prev?.description ?? null,
    decimals: next.decimals ?? prev?.decimals ?? 0,
    emissionAmount: next.emissionAmount ?? prev?.emissionAmount ?? null,
    boxId: next.boxId ?? prev?.boxId ?? null,
    isNft: next.isNft ?? prev?.isNft,
    artworkUrl: next.artworkUrl ?? prev?.artworkUrl,
    nft: next.nft ?? prev?.nft ?? null,
    holders: next.holders ?? prev?.holders,
    txCount: next.txCount ?? prev?.txCount,
    unspentBoxes: next.unspentBoxes ?? prev?.unspentBoxes,
    firstHeight: next.firstHeight ?? prev?.firstHeight,
    lastHeight: next.lastHeight ?? prev?.lastHeight,
  };
}

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function moreTxCursor(
  rows: TokenTxRow[],
  nextCursor?: string | null
): string | null {
  if (nextCursor) return nextCursor;
  return txKeysetCursor(rows[rows.length - 1]);
}

function moreHolderCursor(data: HoldersData | null): string | null {
  if (!data?.holders.length) return null;
  return (
    data.pagination?.nextCursor ||
    holderKeysetCursor(data.holders[data.holders.length - 1])
  );
}

function holderAmount(row: Holder): bigint {
  try {
    return toBigIntAmt(row.amount);
  } catch {
    try {
      return toBigIntAmt(String(row.amountUi ?? 0));
    } catch {
      return 0n;
    }
  }
}

function orderHolders(rows: Holder[], dir: AmountDir, offset: number): Holder[] {
  const sorted = [...rows].sort((a, b) => {
    const av = holderAmount(a);
    const bv = holderAmount(b);
    if (av === bv) return a.address.localeCompare(b.address);
    const lt = av < bv;
    if (dir === "asc") return lt ? -1 : 1;
    return lt ? 1 : -1;
  });
  return sorted.map((row, i) => ({ ...row, rank: offset + i + 1 }));
}

function descLabel(key: string): string {
  const words = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!words) return key;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function descValue(raw: string): string {
  if (raw === "true") return "Yes";
  if (raw === "false") return "No";
  return raw;
}

function DescPaint({ lines }: { lines: { key?: string; value: string }[] }) {
  return (
    <>
      {lines.map((line, i) =>
        line.key != null ? (
          <div key={line.key} className="contents">
            <span className="whitespace-nowrap text-[var(--muted-2)]">{descLabel(line.key)}</span>
            <span className="min-w-0 break-words text-[var(--text)]">{descValue(line.value)}</span>
          </div>
        ) : (
          <span key={i} className="col-span-2 block whitespace-pre-wrap break-words">
            {line.value}
          </span>
        )
      )}
    </>
  );
}

function DescCard({
  label,
  ink,
  mark,
  description,
  empty,
  enter,
}: {
  label: string;
  ink: string;
  mark: ReactNode;
  description: string | null;
  empty: string;
  enter?: number;
}) {
  const lines = useMemo(
    () => (description ? tokenDescLines(description) : []),
    [description]
  );

  return (
    <article
      className={clsx(
        "kpi-tile supply-card token-desc-card relative col-span-2 flex h-full min-h-0 min-w-0 items-stretch gap-2 overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-3 py-1.5 lg:col-span-1 lg:row-span-2",
        enter != null && "home-tile-enter"
      )}
      style={{
        ["--kpi-ink" as string]: ink,
        ...(enter != null ? { ["--enter" as string]: enter } : {}),
      }}
    >
      <KpiTileRail />
      <div className="kpi-tile-body flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="kpi-label-row">
          <KpiLabelMark mark={mark} color={ink} />
          <p
            className="relative z-[1] shrink-0 truncate bg-[var(--module)] pb-1 pr-10 text-[13px] leading-[1.15]"
            style={{ color: HOME.forming }}
          >
            {label}
          </p>
        </div>
        {description ? (
          <div className="token-desc-body scrollbar-none">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <DescPaint lines={lines} />
            </div>
          </div>
        ) : (
          <p className="supply-tile-copy is-empty">{empty}</p>
        )}
      </div>
      <div className="kpi-tile-mark relative z-[1] self-start" style={{ color: ink }} aria-hidden>
        {mark}
      </div>
    </article>
  );
}

export function TokenView({
  tokenId,
  initial,
  initialHolders,
}: {
  tokenId: string;
  initial: TokenListItem | null;
  initialHolders: HoldersData | null;
}) {
  const t = useT();
  const { locale } = useI18n();
  const { ids: favIds, toggle: toggleFav } = useFavoriteAddresses();
  const tokenFav = useFavoriteOf("tokens", tokenId);
  const favReady = favIds != null;
  const favSet = useMemo(() => new Set(favIds ?? []), [favIds]);
  const { markSynced } = usePageSync();
  const [catalog, setCatalog] = useState<TokenListItem | null>(initial);
  const [data, setData] = useState<TokenData | null>(() => catalogToTokenData(tokenId, initial));
  const [holders, setHolders] = useState<HoldersData | null>(initialHolders);
  const [holderOff, setHolderOff] = useState(0);
  const [holderDir, setHolderDir] = useState<AmountDir>("desc");
  const [holdersPending, setHoldersPending] = useState(false);
  const [holdersFailed, setHoldersFailed] = useState(false);
  const [holdersSettled, setHoldersSettled] = useState(() => initialHolders != null);
  const [listReady, setListReady] = useState(() => Boolean(initialHolders?.holders.length));
  const [txs, setTxs] = useState<TokenTxRow[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [txOff, setTxOff] = useState(0);
  const [txPending, setTxPending] = useState(false);
  const [txFailed, setTxFailed] = useState(false);
  const [txListReady, setTxListReady] = useState(false);
  const [txSettled, setTxSettled] = useState(false);
  const [txHasMore, setTxHasMore] = useState(false);
  const [tab, setTab] = useState<Tab>("holders");
  const [err, setErr] = useState<string | null>(null);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const holdersRef = useRef(holders);
  holdersRef.current = holders;
  const txsRef = useRef(txs);
  txsRef.current = txs;
  const txFlowRef = useRef<"all" | "mintburn" | "swap">("all");
  const holderEnter = useEnterIds();
  const txEnter = useEnterIds();
  const packEnter = useEnterIds();
  const txPackEnter = useEnterIds();
  const pinRef = useRef<HTMLDivElement>(null);
  const twinRoot = useRef<HTMLDivElement>(null);
  const twinAddr = useRef("");
  const quietHolders = useRef(false);
  const skipHoldersFetch = useRef(Boolean(initialHolders?.holders.length));
  const holderCursorRef = useRef<string | null>(null);
  const holderCursorStack = useRef<(string | null)[]>([]);
  const holderOffRef = useRef(0);
  holderOffRef.current = holderOff;
  const holderDirRef = useRef(holderDir);
  holderDirRef.current = holderDir;
  const txCursorRef = useRef<string | null>(null);
  const txCursorStack = useRef<(string | null)[]>([]);
  const txOffRef = useRef(0);
  txOffRef.current = txOff;
  const txNextCursorRef = useRef<string | null>(null);
  const txGen = useRef(0);

  useEffect(() => {
    setTab(readTokenTab());
    const onHash = () => setTab(readTokenTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [tokenId]);

  const load = useCallback(
    (silent = false) => {
      if (!tokenId) return;
      if (!silent) setErr(null);
      const gw = getGateway();
      const jobs: Promise<unknown>[] = [];
      if (silent || !catalogRef.current) {
        jobs.push(
          fetch(
            `${gw}/v1/tokens?${new URLSearchParams({ q: tokenId, limit: "1", names: "0" })}`,
            SNAPSHOT_FETCH
          )
            .then(async (r) => (r.ok ? r.json() : null))
            .then((j: { items?: TokenListItem[] } | null) => {
              const hit = catalogHit(j?.items, tokenId);
              if (hit) setCatalog(hit);
            })
            .catch(() => {
              /* catalog optional */
            })
        );
      }
      jobs.push(
        fetch(`${gw}/v1/tokens/${tokenId}?market=0`)
          .then(async (r) => (r.ok ? (r.json() as Promise<TokenData>) : null))
          .then((j) => {
            if (j) setData((prev) => mergeTokenData(prev, j));
          })
      );
      void Promise.all(jobs)
        .then(() => markSynced())
        .catch((e) => {
          if (!silent && !catalogRef.current) setErr(String(e));
        });
    },
    [tokenId, markSynced]
  );

  useKeepFresh(load);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setHolderOff(0);
    holderOffRef.current = 0;
    holderCursorRef.current = null;
    holderCursorStack.current = [];
    setHolderDir("desc");
    setHoldersFailed(false);
    setTxOff(0);
    txOffRef.current = 0;
    txCursorRef.current = null;
    txCursorStack.current = [];
    txNextCursorRef.current = null;
    setTxs([]);
    setTxTotal(0);
    setTxFailed(false);
    setTxListReady(false);
    setTxHasMore(false);
    txFlowRef.current = "all";
    const painted = holdersRef.current;
    if (painted?.holders.length) {
      putTokenHolders(tokenId, painted);
      return;
    }
    const cached = peekTokenHolders(tokenId);
    if (cached?.holders.length) {
      quietHolders.current = true;
      setHolders(cached);
    }
  }, [tokenId]);

  const loadHolders = useCallback(async () => {
    if (!tokenId) return;
    const packCursor = holderCursorRef.current;
    const params = new URLSearchParams({
      limit: String(HOLDERS_PACK),
      offset: String(holderOffRef.current),
      dir: holderDirRef.current,
    });
    if (packCursor) params.set("cursor", packCursor);
    const r = await fetch(`${getGateway()}/v1/tokens/${tokenId}/holders?${params}`, {
      cache: "no-store",
    });
    if (!r.ok) throw new Error(String(r.status));
    const next = (await r.json()) as HoldersData;
    if (packCursor && !(next.holders?.length)) {
      const prev = holderCursorStack.current.pop() ?? null;
      holderCursorRef.current = prev;
      const back = holderCursorStack.current.length * HOLDERS_PACK;
      holderOffRef.current = back;
      setHolderOff(back);
      return;
    }
    const quiet = quietHolders.current;
    quietHolders.current = false;
    const prev = holdersRef.current;
    if (!quiet && prev?.holders.length) {
      const ids = enteringIds(
        prev.holders.map((row) => ({ id: row.address })),
        next.holders.map((row) => ({ id: row.address }))
      );
      holderEnter.mark(ids);
      if (ids.length) packEnter.mark(["pack"]);
    } else if (!quiet && !prev?.holders.length) {
      const ids = next.holders.map((row) => row.address);
      holderEnter.mark(ids);
      if (ids.length) packEnter.mark(["pack"]);
    }
    setHolders(next);
    setHoldersFailed(false);
    setHoldersSettled(true);
    if (!packCursor && holderOffRef.current === 0) {
      putTokenHolders(tokenId, next);
    }
    if (packCursor || holderOffRef.current > 0) {
      pinRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [tokenId, holderEnter.mark, packEnter.mark]);

  const loadTxs = useCallback(async (gen = txGen.current) => {
    if (!tokenId) return;
    const flow = txFlowRef.current;
    const packCursor = txCursorRef.current;
    const params = new URLSearchParams({
      limit: String(TX_PACK),
      offset: String(txOffRef.current),
      flow,
    });
    if (packCursor) params.set("cursor", packCursor);
    const r = await fetch(`${getGateway()}/v1/tokens/${tokenId}/txs?${params}`, {
      cache: "no-store",
    });
    if (gen !== txGen.current) return;
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as {
      items?: TokenTxRow[];
      pagination?: { total?: number; hasMore?: boolean; nextCursor?: string | null };
    };
    const next = (Array.isArray(j?.items) ? j.items : []).map((row) => {
      const meaning = parseMeaning(row.meaning);
      return meaning ? { ...row, meaning } : { ...row, meaning: undefined };
    });
    if (gen !== txGen.current) return;
    if (packCursor && !next.length) {
      const prev = txCursorStack.current.pop() ?? null;
      txCursorRef.current = prev;
      const back = txCursorStack.current.length * TX_PACK;
      txOffRef.current = back;
      setTxOff(back);
      return;
    }
    const prev = txsRef.current;
    const ids = prev.length
      ? enteringIds(
          prev.map((row) => ({ id: row.id })),
          next.map((row) => ({ id: row.id }))
        )
      : next.map((row) => row.id);
    txEnter.mark(ids);
    if (ids.length) txPackEnter.mark(["pack"]);
    setTxs(next);
    setTxFailed(false);
    setTxHasMore(Boolean(j.pagination?.hasMore));
    txNextCursorRef.current = j.pagination?.nextCursor ?? moreTxCursor(next, null);
    if (typeof j.pagination?.total === "number") {
      setTxTotal(j.pagination.total);
    } else {
      setTxTotal(next.length);
    }
    setTxSettled(true);
    if (!next.length) setTxListReady(true);
    if (packCursor || txOffRef.current > 0) {
      pinRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [tokenId, txEnter.mark, txPackEnter.mark]);

  useEffect(() => {
    if (!tokenId) return;
    if (tab !== "holders") return;
    if (catalogRef.current?.holders === 0 && !holdersRef.current?.holders.length) {
      setHolders({ holders: [], uniqueAddresses: 0 });
      setHoldersPending(false);
      setHoldersFailed(false);
      setHoldersSettled(true);
      setListReady(true);
      return;
    }
    if (skipHoldersFetch.current) {
      skipHoldersFetch.current = false;
      return;
    }
    let cancelled = false;
    const had = holdersRef.current?.holders.length ?? 0;
    if (had) setHoldersPending(true);
    void loadHolders()
      .catch(() => {
        if (!cancelled) {
          setHoldersFailed(true);
          setHoldersSettled(true);
        }
      })
      .finally(() => {
        if (!cancelled) setHoldersPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tokenId, holderDir, loadHolders]);

  useEffect(() => {
    if (!tokenId) return;
    if (tab !== "txs" && tab !== "swaps" && tab !== "mintburn") return;
    const flow = tab === "mintburn" ? "mintburn" : tab === "swaps" ? "swap" : "all";
    if (txFlowRef.current !== flow) {
      txGen.current += 1;
      txFlowRef.current = flow;
      txCursorRef.current = null;
      txCursorStack.current = [];
      txNextCursorRef.current = null;
      txOffRef.current = 0;
      setTxOff(0);
      setTxs([]);
      setTxTotal(0);
      setTxHasMore(false);
      setTxListReady(false);
      setTxSettled(false);
      setTxFailed(false);
    }
    const gen = txGen.current;
    let cancelled = false;
    const had = txsRef.current.length;
    if (had) setTxPending(true);
    void loadTxs(gen)
      .catch(() => {
        if (!cancelled && gen === txGen.current) setTxFailed(true);
      })
      .finally(() => {
        if (!cancelled && gen === txGen.current) {
          setTxPending(false);
          setTxSettled(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tokenId, tab, loadTxs]);

  useEffect(() => {
    if (tab !== "txs" && tab !== "swaps" && tab !== "mintburn") return;
    if (!txs.length) {
      if (txSettled && txFailed) setTxListReady(true);
      return;
    }
    if (txListReady) return;
    setTxListReady(true);
  }, [tab, txs, txFailed, txSettled, txListReady]);

  useLayoutEffect(() => {
    if (tab !== "txs" && tab !== "swaps" && tab !== "mintburn") return;
    if (!txSettled || !txs.length) return;
    txEnter.mark(txs.map((row) => row.id));
    txPackEnter.mark(["pack"]);
  }, [tab, txSettled, txs, txEnter.mark, txPackEnter.mark]);

  useLayoutEffect(() => {
    if (tab !== "holders") return;
    const rows = holdersRef.current?.holders ?? [];
    if (!rows.length) return;
    holderEnter.mark(rows.map((row) => row.address));
    packEnter.mark(["pack"]);
  }, [tab, holdersSettled, holderEnter.mark, packEnter.mark]);

  useEffect(() => {
    if (tab !== "holders") return;
    const rows = holders?.holders ?? [];
    if (!rows.length) {
      if (holdersSettled && !holdersPending && (holdersFailed || holders?.uniqueAddresses === 0)) {
        setListReady(true);
      }
      return;
    }
    if (listReady) return;
    setListReady(true);
  }, [tab, holders, holdersFailed, holdersPending, holdersSettled, listReady]);

  const rawName = (data?.name ?? catalog?.name ?? "").trim();
  const named = rawName && !rawName.includes("\uFFFD") ? rawName : null;
  const meta = resolveTokenMeta(tokenId, named, named);
  const sym = named ? meta.symbol : shortId(tokenId, 8);
  const nft = data?.nft ?? null;
  const typeLabel = nft?.kind
    ? t(`token.nft.kind.${nft.kind}`)
    : data?.isNft
      ? t("token.type.nft")
      : t("token.type.token");
  const previewUrl = nft?.coverUrl || data?.artworkUrl || catalog?.artworkUrl || nft?.url;
  const settled = catalog != null || data != null;
  const dash = "—";
  const decimals = data?.decimals ?? catalog?.decimals ?? 0;
  const emission = data?.emissionAmount ?? catalog?.emission ?? null;
  const supplyGlance = (() => {
    if (emission == null || emission === "") return null;
    try {
      return formatEmissionGlance(toBigIntAmt(emission), decimals, locale);
    } catch {
      return null;
    }
  })();
  const holderN = data?.holders ?? catalog?.holders ?? null;
  const txN = data?.txCount ?? catalog?.txCount ?? null;
  const boxN = data?.unspentBoxes ?? catalog?.unspentBoxes ?? null;
  const firstHeight = data?.firstHeight ?? catalog?.firstHeight ?? null;
  const lastHeight = data?.lastHeight ?? catalog?.lastHeight ?? null;
  const firstTs = catalog?.firstTs ?? null;
  const lastTs = catalog?.lastTs ?? null;
  const descRaw = (data?.description ?? "").trim();
  const description = (() => {
    if (!descRaw || descRaw === "0") return null;
    const n = String(meta.name ?? "").trim().toLowerCase();
    const s = String(sym).toLowerCase();
    const d = descRaw.toLowerCase();
    if (d === n || d === s) return null;
    return descRaw;
  })();
  const holderTotal = holders?.pagination?.total ?? holderN ?? holders?.uniqueAddresses ?? 0;
  const holderRows = useMemo(
    () => orderHolders(holders?.holders ?? [], holderDir, holderOff),
    [holders, holderDir, holderOff]
  );
  const loading = !settled && !err;

  const onTab = (idTab: Tab) => {
    if (idTab === tab) {
      setHashTab(idTab);
      return;
    }
    if (
      (idTab === "txs" || idTab === "swaps" || idTab === "mintburn") &&
      (tab === "txs" || tab === "swaps" || tab === "mintburn")
    ) {
      const flow = idTab === "mintburn" ? "mintburn" : idTab === "swaps" ? "swap" : "all";
      if (txFlowRef.current !== flow) {
        txGen.current += 1;
        txFlowRef.current = flow;
        txCursorRef.current = null;
        txCursorStack.current = [];
        txNextCursorRef.current = null;
        txOffRef.current = 0;
        setTxOff(0);
        setTxs([]);
        setTxTotal(0);
        setTxHasMore(false);
        setTxFailed(false);
        setTxListReady(false);
        setTxSettled(false);
        setTxPending(true);
      }
    }
    setTab(idTab);
    setHashTab(idTab);
  };

  return (
    <Shell>
      {loading && <AddressPageSkeleton />}
      {err && !settled && (
        <p className="text-amber-300">
          {t("token.notFound")}: {err}
        </p>
      )}

      {settled && (
        <>
          <div className="addr-lane">
            <div className="col-span-2 flex min-h-0 flex-col gap-2 lg:col-span-1 lg:row-span-2">
              <AddrFactCard
                className="min-h-0 h-auto flex-1"
                enter={0}
                label={typeLabel}
                ink={INK.violet}
                mark={
                  (data?.isNft || Number(emission) === 1 || nft?.kind) &&
                  previewUrl ? (
                    <span className="h-12 w-12 overflow-hidden rounded-[14px] bg-[var(--wash)]">
                      <NftThumb
                        url={previewUrl}
                        tokenId={tokenId}
                        className="h-full w-full object-cover"
                      />
                    </span>
                  ) : (
                    <TokenAvatar tokenId={tokenId} symbol={sym} size={40} />
                  )
                }
              >
                <h1
                  className="mt-0.5 min-w-0 text-[17px] font-semibold leading-[1.15] tracking-tight"
                  style={{ color: tokenTickerInk(tokenId) }}
                >
                  <NameMarquee text={sym} fade pxPerSec={16} />
                </h1>
                <p className="mt-0.5 flex min-w-0 items-center gap-1">
                  <code className="min-w-0 truncate font-mono text-[12px] leading-[1.15] text-accent">
                    {shortId(tokenId, 8)}
                  </code>
                  <CopyChip text={tokenId} copyLabel={t("tx.copy")} copiedLabel={t("tx.copied")} />
                  <FavoriteHeart
                    on={tokenFav.on}
                    ready={tokenFav.ready}
                    title={tokenFav.on ? t("favorites.remove") : t("favorites.add")}
                    onToggle={tokenFav.toggle}
                  />
                  {decimals ? (
                    <span className="ml-auto shrink-0 text-[12px] leading-[1.15] text-[var(--muted-2)]">
                      {decimals} {t("token.cap.decimals")}
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-[12px] leading-snug text-[var(--muted-2)]">
                  {t("token.emission")}{" "}
                  <Tip
                    content={
                      supplyGlance && supplyGlance.exact !== supplyGlance.text
                        ? () => <TipFigure>{supplyGlance.exact}</TipFigure>
                        : null
                    }
                  >
                    <span className="tabular-nums">{supplyGlance?.text ?? dash}</span>
                  </Tip>
                </p>
              </AddrFactCard>
              <SegBar cols={4} className="tab-fit shrink-0">
                {TOKEN_TABS.map((idTab) => (
                  <a
                    key={idTab}
                    href={`#${idTab}`}
                    onClick={(e) => {
                      e.preventDefault();
                      onTab(idTab);
                    }}
                    className={segItem(tab === idTab)}
                  >
                    {t(`token.tab.${idTab}`)}
                  </a>
                ))}
              </SegBar>
            </div>

            <DescCard
              key={tokenId}
              enter={1}
              label={t("token.card.description")}
              ink={INK.cyan}
              mark={<KpiMark id="info" />}
              description={description}
              empty={t("token.descEmpty")}
            />

            <AddrFactCard
              enter={2}
              label={t("token.card.holders")}
              ink={INK.sky}
              mark={<KpiMark id="holders" />}
            >
              <p className="mt-0.5 text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight">
                <KpiNum compact={compactFigure(holderN)}>{holderN != null ? holderN.toLocaleString(loc(locale)) : dash}</KpiNum>
              </p>
              <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
                {t("token.cap.holders")}
              </p>
            </AddrFactCard>

            <AddrFactCard
              enter={3}
              label={t("token.card.boxes")}
              ink={INK.sky}
              mark={<KpiMark id="box" />}
            >
              <p
                className={clsx(
                  "mt-0.5 text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight",
                  (boxN == null || boxN <= 0) && "text-[var(--muted)]"
                )}
              >
                {boxN != null && boxN > 0 ? (
                  <KpiNum compact={compactFigure(boxN)}>{boxN.toLocaleString(loc(locale))}</KpiNum>
                ) : (
                  dash
                )}
              </p>
              <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
                {t("token.cap.boxes")}
              </p>
            </AddrFactCard>

            <AddrFactCard
              enter={4}
              label={t("token.card.txs")}
              ink={INK.cyan}
              mark={<KpiMark id="tx" />}
            >
              <p className="mt-0.5 text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight">
                <KpiNum compact={compactFigure(txN)}>{txN != null ? txN.toLocaleString(loc(locale)) : dash}</KpiNum>
              </p>
              <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
                {t("token.cap.txs")}
              </p>
            </AddrFactCard>

            <AddrFactCard
              enter={5}
              label={t("token.card.activity")}
              ink={INK.teal}
              mark={<KpiMark id="activity" />}
            >
              <p className="mt-0.5 text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight">
                <KpiNum>
                  {lastTs != null
                    ? formatRelTime(lastTs, locale)
                    : lastHeight != null
                      ? `#${lastHeight.toLocaleString(loc(locale))}`
                      : dash}
                </KpiNum>
              </p>
              <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">
                {firstTs != null
                  ? `${t("token.firstActivity")} · ${formatRelTime(firstTs, locale)}`
                  : firstHeight != null
                    ? `${t("token.firstActivity")} · #${firstHeight.toLocaleString(loc(locale))}`
                    : t("token.cap.activity")}
              </p>
            </AddrFactCard>
          </div>

          {nft && (nft.kind || nft.url || nft.mintAddress || nft.collectionTokenId) ? (
            <NftInfoPanel nft={nft} tokenId={tokenId} locale={locale} t={t} />
          ) : null}

          {tab === "holders" && (
            <div className="mt-2">
              {holderRows.length === 0 && (!holdersSettled || holdersPending) ? (
                <Feed>
                  <FeedSkeleton />
                </Feed>
              ) : holderRows.length === 0 ? (
                <Feed>
                  <FeedEmpty k="addr" title={holdersFailed ? t("token.holdersErr") : t("token.holdersEmpty")} />
                </Feed>
              ) : (
              <div key={tab} className="feed-sheet">
                <div ref={pinRef} className="h-px w-full" aria-hidden />
                <Feed busy={holdersPending} className="is-rank" enterClass={packEnter.enterClass("pack")}>
                  <FeedBoard
                    plate={
                      <FeedPlate
                        tag={t("token.tab.holders")}
                        now
                        count={holderTotal > 0 ? <FeedCount k="feed.holders" n={holderTotal} /> : undefined}
                        end={
                          <FeedSort
                            label={t("feed.sort.label")}
                            options={[{ key: "share", label: t("feed.sort.share") }]}
                            active="share"
                            dir={holderDir}
                            disabled={holdersPending}
                            onSort={() => {
                              holderCursorStack.current = [];
                              holderCursorRef.current = null;
                              holderOffRef.current = 0;
                              setHolderOff(0);
                              setHolderDir((d) => (d === "desc" ? "asc" : "desc"));
                            }}
                          />
                        }
                      />
                    }
                  >
                    {holderRows.map((h) => (
                      <FeedHolderRow
                        key={h.address}
                        row={h}
                        rank={h.rank}
                        decimals={decimals}
                        enterClass={holderEnter.enterClass(h.address)}
                        fav={{ on: favSet.has(h.address), ready: favReady, toggle: toggleFav }}
                      />
                    ))}
                  </FeedBoard>
                </Feed>
                {(holderRows.length > 0 || holderOff > 0 || holderTotal > 0) && (
                  <RankWindow
                    offset={holderOff}
                    pageSize={HOLDERS_PACK}
                    shown={holders?.holders.length ?? 0}
                    total={holderTotal > 0 ? holderTotal : null}
                    hasMore={addrTapeHasMore(
                      holders?.holders.length ?? 0,
                      holderTotal,
                      holders?.pagination?.hasMore
                    )}
                    scrub={false}
                    loc={loc(locale)}
                    ofLabel={t("addresses.packOf")}
                    prevLabel={t("token.packPrev")}
                    nextLabel={t("token.packNext")}
                    tapeLabel={t("token.packTape")}
                    hint={t("token.packHint")}
                    disabled={holdersPending}
                    onOffset={(next) => {
                      const cur = holderOff;
                      if (next < cur) {
                        const prevCur = holderCursorStack.current.pop() ?? null;
                        holderCursorRef.current = prevCur;
                        holderOffRef.current = Math.max(0, cur - HOLDERS_PACK);
                        setHolderOff(holderOffRef.current);
                        setHoldersPending(true);
                        void loadHolders()
                          .catch(() => setHoldersFailed(true))
                          .finally(() => setHoldersPending(false));
                        return;
                      }
                      if (next <= cur) return;
                      const nxt = moreHolderCursor(holders);
                      if (
                        !addrTapeHasMore(
                          holders?.holders.length ?? 0,
                          holderTotal,
                          holders?.pagination?.hasMore
                        ) ||
                        !nxt
                      ) {
                        return;
                      }
                      holderCursorStack.current.push(holderCursorRef.current);
                      holderCursorRef.current = nxt;
                      holderOffRef.current = cur + HOLDERS_PACK;
                      setHolderOff(holderOffRef.current);
                      setHoldersPending(true);
                      void loadHolders()
                        .catch(() => setHoldersFailed(true))
                        .finally(() => setHoldersPending(false));
                    }}
                  />
                )}
              </div>
              )}
            </div>
          )}

          {(tab === "txs" || tab === "swaps" || tab === "mintburn") && (
            <div className="mt-2">
              {!txSettled ? (
                <Feed>
                  <FeedSkeleton />
                </Feed>
              ) : !txs.length ? (
                <Feed>
                  <FeedEmpty
                    k={tab === "mintburn" ? "mint" : tab === "swaps" ? "swap" : "transfer"}
                    title={
                      txFailed && (txN ?? 0) > 0
                        ? t("token.txsTapeOff")
                        : txFailed
                          ? t("token.txsWarm")
                          : tab === "mintburn"
                            ? t("token.noMintBurn")
                            : tab === "swaps"
                              ? t("token.noSwaps")
                              : t("token.noTxs")
                    }
                  />
                </Feed>
              ) : (
              <div key={tab} className="feed-sheet">
                <div ref={pinRef} className="h-px w-full" aria-hidden />
                <div
                  ref={twinRoot}
                  onPointerOver={(e) => {
                    const el = (e.target as HTMLElement).closest?.("[data-addr]");
                    const addr = el?.getAttribute("data-addr") ?? "";
                    const root = twinRoot.current;
                    if (!root || addr === twinAddr.current) return;
                    root.querySelectorAll(".is-twin").forEach((n) => n.classList.remove("is-twin"));
                    twinAddr.current = "";
                    if (!addr) return;
                    const nodes = root.querySelectorAll(
                      `[data-addr="${CSS.escape(addr)}"]`
                    );
                    if (nodes.length < 2) return;
                    twinAddr.current = addr;
                    nodes.forEach((n) => n.classList.add("is-twin"));
                  }}
                  onPointerLeave={() => {
                    twinAddr.current = "";
                    twinRoot.current
                      ?.querySelectorAll(".is-twin")
                      .forEach((n) => n.classList.remove("is-twin"));
                  }}
                >
                  <Feed busy={txPending} enterClass={txPackEnter.enterClass("pack")}>
                    <FeedDays
                      items={txs}
                      seconds
                      msOf={(tx) => toEpochMs(tx.timestamp)}
                      countOf={(n) => <FeedCount k="feed.txCount" n={n} />}
                      render={(tx, lead) => (
                        <FeedTokenTxRow
                          key={tx.id}
                          tx={tx}
                          lead={lead}
                          decimals={decimals}
                          unit={sym}
                          enterClass={txEnter.enterClass(tx.id)}
                        />
                      )}
                    />
                  </Feed>
                </div>
                {(txs.length > 0 || txOff > 0) && (
                  <RankWindow
                    offset={txOff}
                    pageSize={TX_PACK}
                    shown={txs.length}
                    total={txHasMore ? (txTotal > TX_PACK ? txTotal : null) : txOff + txs.length}
                    hasMore={txHasMore}
                    scrub={false}
                    loc={loc(locale)}
                    ofLabel={t("addresses.packOf")}
                    prevLabel={t("token.packPrev")}
                    nextLabel={t("token.packNext")}
                    tapeLabel={
                      tab === "mintburn"
                        ? t("token.packTapeMint")
                        : tab === "swaps"
                          ? t("token.packTapeSwaps")
                          : t("token.packTapeTxs")
                    }
                    hint={
                      tab === "mintburn"
                        ? t("token.packHintMint")
                        : tab === "swaps"
                          ? t("token.packHintSwaps")
                          : t("token.packHintTxs")
                    }
                    disabled={txPending}
                    onOffset={(next) => {
                      const cur = txOff;
                      if (next < cur) {
                        const prevCur = txCursorStack.current.pop() ?? null;
                        txCursorRef.current = prevCur;
                        txOffRef.current = Math.max(0, cur - TX_PACK);
                        setTxOff(txOffRef.current);
                        setTxPending(true);
                        void loadTxs()
                          .catch(() => setTxFailed(true))
                          .finally(() => setTxPending(false));
                        return;
                      }
                      if (next <= cur) return;
                      const nxt = moreTxCursor(txs, txNextCursorRef.current);
                      if (!txHasMore || !nxt) {
                        return;
                      }
                      txCursorStack.current.push(txCursorRef.current);
                      txCursorRef.current = nxt;
                      txOffRef.current = cur + TX_PACK;
                      setTxOff(txOffRef.current);
                      setTxPending(true);
                      void loadTxs()
                        .catch(() => setTxFailed(true))
                        .finally(() => setTxPending(false));
                    }}
                  />
                )}
              </div>
              )}
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

function clipNftFact(value: string): string {
  return value.length <= 48 ? value : value.slice(0, 48);
}

function NftInfoPanel({
  nft,
  tokenId,
  locale,
  t,
}: {
  nft: TokenNft;
  tokenId: string;
  locale: string;
  t: (key: string) => string;
}) {
  const audio = useMediaSrc(nft.kind === "audio" ? nft.url : null, "audio");
  const video = useMediaSrc(nft.kind === "video" ? nft.url : null, "video");
  const poster = useMediaSrc(nft.kind === "video" ? nft.coverUrl : null, "image");
  const fileHref =
    nft.kind === "file" || (!audio.src && !video.src && nft.kind !== "image")
      ? safeMediaUrl(nft.url, "any")
      : null;
  const mintParty = nft.mintAddress ? describeParty(nft.mintAddress) : null;
  const rows: { label: string; node: ReactNode }[] = [];
  if (nft.mintHeight != null) {
    rows.push({
      label: t("token.nft.mintHeight"),
      node: <span className="tabular-nums">#{nft.mintHeight.toLocaleString(loc(locale))}</span>,
    });
  }
  if (nft.mintAddress) {
    rows.push({
      label: t("token.nft.mintAddress"),
      node: (
        <Link prefetch={false} href={`/address/${encodeURIComponent(nft.mintAddress)}`} className="truncate text-accent hover:underline">
          {mintParty?.known || mintParty?.short || shortId(nft.mintAddress, 8)}
        </Link>
      ),
    });
  }
  if (nft.mintTxId) {
    rows.push({
      label: t("token.nft.mintTx"),
      node: (
        <Link prefetch={false} href={`/tx/${encodeURIComponent(nft.mintTxId)}`} className="truncate font-mono text-accent hover:underline">
          {clipNftFact(nft.mintTxId)}
        </Link>
      ),
    });
  }
  if (nft.royaltyPercent != null && nft.royaltyPercent > 0) {
    rows.push({
      label: t("token.nft.royalty"),
      node: <span className="tabular-nums">{`${nft.royaltyPercent}%`}</span>,
    });
  }
  if (nft.collectionTokenId) {
    rows.push({
      label: t("token.nft.collection"),
      node: (
        <Link
          prefetch={false}
          href={`/token/${encodeURIComponent(nft.collectionTokenId)}`}
          className="truncate text-accent hover:underline"
        >
          {nft.collectionName || shortId(nft.collectionTokenId, 8)}
        </Link>
      ),
    });
  }
  if (nft.url) {
    const href = safeMediaUrl(nft.url, "any");
    rows.push({
      label: t("token.nft.url"),
      node: href ? (
        <a href={href} target="_blank" rel="noreferrer" className="truncate text-accent hover:underline">
          {clipNftFact(href.replace(/^https?:\/\//i, ""))}
        </a>
      ) : (
        <span className="truncate">{clipNftFact(nft.url)}</span>
      ),
    });
  }
  if (nft.ipfsCid) {
    rows.push({
      label: t("token.nft.cid"),
      node: <span className="truncate font-mono text-[12px]">{nft.ipfsCid}</span>,
    });
  }
  if (nft.sha256) {
    rows.push({
      label: t("token.nft.sha256"),
      node: (
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate font-mono text-[12px] text-accent">{clipNftFact(nft.sha256)}</span>
          <CopyChip text={nft.sha256} copyLabel={t("tx.copy")} copiedLabel={t("tx.copied")} />
        </span>
      ),
    });
  }
  const artUrl = nft.coverUrl || nft.url;
  const showArt = Boolean(artUrl) && nft.kind !== "audio" && nft.kind !== "video";
  const showFrame = nft.kind !== "audio" && nft.kind !== "video";
  return (
    <section
      className="home-tile-enter mt-2 flex flex-col gap-2"
      style={{ ["--enter" as string]: 6 }}
    >
      {audio.src ? (
        <audio
          controls
          preload="metadata"
          className="w-full"
          src={audio.src}
          onError={audio.onError}
        />
      ) : null}
      {video.src ? (
        <video
          controls
          preload="metadata"
          className="max-h-[360px] w-full rounded-[20px] bg-black/40"
          src={video.src}
          poster={poster.src ?? undefined}
          onError={video.onError}
        />
      ) : null}
      {fileHref && nft.kind === "file" ? (
        <a
          href={fileHref}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-[13px] text-accent hover:underline"
        >
          {t("token.nft.openFile")}
        </a>
      ) : null}
      <div className="addr-lane" style={showArt ? undefined : { alignItems: "center" }}>
        {showFrame ? (
          <div className="addr-nft-thumb col-span-2 overflow-hidden rounded-[20px] lg:col-span-1">
            <NftThumb url={showArt ? artUrl : null} tokenId={tokenId} />
          </div>
        ) : null}
        <div
          className={clsx(
            "col-span-2 flex min-h-0 min-w-0",
            showFrame ? "lg:col-span-3" : "lg:col-span-4"
          )}
        >
          <dl
            className="grid min-h-0 w-full min-w-0 flex-1 grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 gap-y-2"
            style={
              showArt
                ? { gridTemplateRows: `repeat(${Math.max(rows.length, 1)}, minmax(0, 1fr))` }
                : undefined
            }
          >
            {rows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="flex items-center text-[12px] leading-snug text-[var(--muted-2)]">{row.label}</dt>
                <dd className="flex min-w-0 items-center text-[13px] leading-snug">{row.node}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

/** `0.00000151` with 8 decimals → raw 151, so the tx-tape formatter can trim zeros. */
function scaledDecimalToRaw(text: string, decimals: number): bigint {
  const trimmed = text.trim();
  const neg = trimmed.startsWith("-");
  const [whole, frac = ""] = (neg ? trimmed.slice(1) : trimmed).split(".");
  const scale = Math.max(0, decimals);
  const fracDigits = frac.replace(/\D/g, "");
  const padded = (fracDigits + "0".repeat(scale)).slice(0, scale);
  const digits = `${whole.replace(/\D/g, "") || "0"}${padded}`.replace(/^0+(?=\d)/, "") || "0";
  try {
    const n = BigInt(digits);
    return neg ? -n : n;
  } catch {
    return 0n;
  }
}

function tokenTapeAmount(tx: TokenTxRow): {
  raw: bigint;
  signed: boolean;
  tone?: "up" | "down";
} {
  const created = toBigIntAmt(tx.created);
  const spent = toBigIntAmt(tx.spent);
  if (tx.kind === "mint" || tx.kind === "burn") {
    const net = tx.net != null && tx.net !== "" ? toBigIntAmt(tx.net) : created - spent;
    return { raw: net, signed: true, tone: net < 0n ? "down" : "up" };
  }
  if (tx.moved != null && tx.moved !== "") {
    return { raw: toBigIntAmt(tx.moved), signed: false };
  }
  const vol = created >= spent ? created : spent;
  return { raw: vol, signed: false };
}

function partyList(list: string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of list ?? []) {
    const a = typeof raw === "string" ? raw.trim() : "";
    if (!a || out.includes(a) || isFeeAddress(a)) continue;
    out.push(a);
  }
  return out;
}

function FeedParty({
  list,
  many,
  manyHint,
  chars = 6,
}: {
  list: string[];
  many: string;
  manyHint: string;
  /** Ends kept of an unnamed address. */
  chars?: number;
}) {
  if (!list.length) return <span className="text-[var(--muted)]">—</span>;
  if (list.length > 1) {
    return (
      <Tip content={manyHint}>
        <span className="feed-party-many">{many}</span>
      </Tip>
    );
  }
  const head = list[0] ?? "";
  const party = describeParty(head);
  return (
    <Link
      prefetch={false}
      href={`/address/${encodeURIComponent(head)}`}
      data-addr={head}
      title={head}
      className={clsx("feed-party hover:underline", !party.known && "font-mono tabular-nums")}
    >
      {party.known || (chars === 6 ? party.short : null) || shortId(head, chars)}
    </Link>
  );
}

/** A pool's name without the pair in brackets: "ErgoDex AMM Pool". */
function poolShort(address: string): string {
  const party = describeParty(address);
  return party.known ? party.known.replace(/\s*\(.*\)\s*$/, "") : party.short || shortId(address, 6);
}

/**
 * One token tx on the feed: who to whom, how much of this token, mint and burn
 * signed. A swap with a pool on one side reads as a trade: the trader and
 * Buy/Sell, then the pool.
 */
function FeedTokenTxRow({
  tx,
  lead,
  decimals,
  unit,
  enterClass,
}: {
  tx: TokenTxRow;
  lead: FeedLead;
  decimals: number;
  unit: string;
  enterClass?: string;
}) {
  const { t, locale } = useI18n();
  const tag = loc(locale);
  const r = useMeaningRow(tx.meaning);
  const amt = tokenTapeAmount(tx);
  const raw = tx.kind === "swap" && tx.moved?.includes(".") ? scaledDecimalToRaw(tx.moved, decimals) : amt.raw;
  // The list words (MEANING_VOCAB) for a row the gateway sent without a meaning.
  const kindLabel =
    MEANING_VOCAB[tx.kind === "mint" ? "token-issue" : tx.kind === "burn" ? "burn" : tx.kind === "swap" ? "swap" : "send"][
      meaningLang(locale)
    ];
  const from = partyList(tx.from);
  const to = partyList(tx.to);
  const many = t("address.multiple");
  const manyHint = t("address.multipleHint");
  const isPool = (a: string) => {
    const party = describeParty(a);
    return party.kind === "pool" || /\bpool\b/i.test(party.known ?? "");
  };
  const poolFrom = tx.kind === "swap" ? from.find(isPool) : undefined;
  const poolTo = tx.kind === "swap" ? to.find(isPool) : undefined;
  const pool = poolFrom && !poolTo ? poolFrom : poolTo && !poolFrom ? poolTo : undefined;
  const side: "buy" | "sell" | null = pool ? (pool === poolFrom ? "buy" : "sell") : null;
  const trader = side === "buy" ? to.filter((a) => !isPool(a)) : side === "sell" ? from.filter((a) => !isPool(a)) : [];
  const trade = side != null && pool != null && trader.length > 0;
  const height =
    tx.inclusionHeight != null ? (
      <Link prefetch={false} href={`/block/${tx.inclusionHeight}`} className="tabular-nums">
        {tx.inclusionHeight.toLocaleString(tag)}
      </Link>
    ) : null;
  const value = <FeedAmount raw={raw} decimals={decimals} unit={unit} signed={amt.signed} glance />;
  const fields = (
    <>
      <FeedField label={t("token.colFrom")}>
        <span className="feed-list">
          {from.length ? from.map((a) => <FeedParty key={a} list={[a]} many={many} manyHint={manyHint} />) : "—"}
        </span>
      </FeedField>
      <FeedField label={t("token.colTo")}>
        <span className="feed-list">
          {to.length ? to.map((a) => <FeedParty key={a} list={[a]} many={many} manyHint={manyHint} />) : "—"}
        </span>
      </FeedField>
      <FeedField label={t("token.colAmount")}>
        <span className="tabular-nums">
          {amt.signed && raw > 0n ? "+" : amt.signed && raw < 0n ? "−" : ""}
          {formatScaledAmount(raw < 0n ? -raw : raw, decimals, tag)}
        </span>
      </FeedField>
      <FeedField label={t("address.colTime")}>
        <span className="tabular-nums" suppressHydrationWarning>
          {tx.timestamp != null ? formatStamp(tx.timestamp) : "—"}
        </span>
      </FeedField>
      <FeedField label={t("detail.block")}>{height ?? "—"}</FeedField>
    </>
  );
  if (r && tx.meaning) {
    // What the tx did (shared words), with this token's own amount on the right.
    const [mk, mg] = meaningTile(tx.meaning);
    return (
      <FeedRow
        k={mk}
        glyph={mg}
        tileTitle={r.where ? `${r.word} · ${r.where}` : r.word}
        lead={lead}
        leadSub={!lead.same ? height : undefined}
        href={`/tx/${tx.id}`}
        enterClass={enterClass}
        className={r.quiet ? "mx-row is-quiet" : "mx-row"}
        title={<MeaningTitle r={r} href={`/tx/${tx.id}`} title={tx.id} />}
        facts={meaningFacts(r)}
        value={value}
        detail={() => (
          <FeedFields>
            <MeaningPhraseField m={tx.meaning!} />
            <FeedField label={t("detail.tx")} wide>
              <FeedIdLine href={`/tx/${tx.id}`} id={tx.id} />
            </FeedField>
            {fields}
          </FeedFields>
        )}
      />
    );
  }
  return (
    <FeedRow
      k={trade ? (side === "buy" ? "in" : "out") : tx.kind}
      glyph={tx.kind}
      tileTitle={trade ? `${kindLabel} · ${t(side === "buy" ? "feed.buy" : "feed.sell")}` : kindLabel}
      lead={lead}
      leadSub={!lead.same ? height : undefined}
      href={`/tx/${tx.id}`}
      enterClass={enterClass}
      title={
        trade ? (
          <span className="feed-route">
            <FeedParty list={trader} many={many} manyHint={manyHint} chars={5} />
            <span className="feed-side" data-k={side === "buy" ? "in" : "out"}>
              {t(side === "buy" ? "feed.buy" : "feed.sell")}
            </span>
          </span>
        ) : (
          <span className="feed-route">
            <FeedParty list={from} many={many} manyHint={manyHint} />
            <span className="feed-route-arrow" aria-hidden>
              →
            </span>
            <FeedParty list={to} many={many} manyHint={manyHint} />
          </span>
        )
      }
      facts={
        trade && pool ? (
          <>
            <Link
              prefetch={false}
              href={`/address/${encodeURIComponent(pool)}`}
              data-addr={pool}
              title={describeParty(pool).known ?? pool}
            >
              {poolShort(pool)}
            </Link>
            <Link prefetch={false} href={`/tx/${tx.id}`} title={tx.id} className="feed-wide font-mono tabular-nums">
              {shortId(tx.id, 8)}
            </Link>
          </>
        ) : (
          <>
            <span className="feed-kind">{kindLabel}</span>
            <Link prefetch={false} href={`/tx/${tx.id}`} title={tx.id} className="font-mono tabular-nums">
              {shortId(tx.id, 8)}
            </Link>
            {height ? <span className="feed-phone-only">{height}</span> : null}
          </>
        )
      }
      value={value}
      detail={() => (
        <FeedFields>
          <FeedField label={t("detail.tx")} wide>
            <FeedIdLine href={`/tx/${tx.id}`} id={tx.id} />
          </FeedField>
          {fields}
        </FeedFields>
      )}
    />
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
