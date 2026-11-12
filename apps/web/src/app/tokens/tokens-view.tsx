"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import { KpiGrid } from "@/components/KpiGrid";
import { KpiMark } from "@/components/kpi-marks";
import { CatalogSearchTile } from "@/components/CatalogSearchTile";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { INK } from "@/lib/palette";
import { RankWindow } from "@/components/RankWindow";
import {
  Feed,
  FeedBoard,
  FeedCount,
  FeedEmpty,
  FeedField,
  FeedFields,
  FeedIdLine,
  FeedPhrase,
  FeedPlate,
  FeedRow,
  FeedSort,
} from "@/components/feed/Feed";
import { TokenLogo } from "@/components/TokenBadge";
import { getGateway } from "@/lib/config";
import {
  formatRelTime,
  formatScaledAmount,
  formatScaledGlance,
  formatTs,
  shortId,
  toBigIntAmt,
} from "@/lib/format";
import { TOKEN_CATALOG } from "@/lib/token-meta";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { useChainTipRefresh, usePageSync } from "@/lib/page-sync";
import { SNAPSHOT_FETCH, enteringIds, snapshotPath, useEnterIds, ENTER_MS } from "@/lib/keyed-enter";
import { prefetchTokenHolders } from "@/lib/token-page-cache";
import { useFavoriteList } from "@/lib/favorites";
import {
  TOKEN_PACK,
  type TokenListDir,
  type TokenListItem,
  type TokenListSort,
  type TokenCatalogKpis,
  type TokensPageData,
} from "@/lib/list-snapshots";

const TOKEN_SORTS: TokenListSort[] = ["holders", "supply", "txs", "last", "first", "name"];

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function pathFor(
  offset: number,
  sort: TokenListSort,
  dir: TokenListDir,
  q: string,
  height?: number | null
): string {
  const params = new URLSearchParams({
    limit: String(TOKEN_PACK),
    offset: String(offset),
    sort,
    dir,
  });
  const qq = q.trim();
  if (qq) params.set("q", qq);
  return snapshotPath(`/v1/tokens?${params}`, height);
}

function tokenName(row: TokenListItem): string | null {
  const known = TOKEN_CATALOG[row.tokenId.toLowerCase()];
  const n = (row.name || known?.name || "").trim();
  return n || null;
}

function knownIdForQuery(q: string): string | null {
  const needle = q.trim().toLowerCase();
  if (!needle) return null;
  for (const [id, meta] of Object.entries(TOKEN_CATALOG)) {
    if (meta.symbol.toLowerCase() === needle || meta.name.toLowerCase() === needle) return id;
  }
  return null;
}

function rowMatchesQuery(row: TokenListItem, needle: string): boolean {
  const known = TOKEN_CATALOG[row.tokenId.toLowerCase()];
  return (
    (row.name ?? "").toLowerCase() === needle ||
    known?.symbol.toLowerCase() === needle ||
    known?.name.toLowerCase() === needle
  );
}

/** Catalog sorts by last-seen; pin an exact name hit so search isn't 25 LP/NFT cousins. */
async function pinExactName(q: string, items: TokenListItem[]): Promise<TokenListItem[]> {
  const needle = q.trim().toLowerCase();
  if (!needle || /^[0-9a-f]{64}$/.test(needle)) return items;
  if (items.some((r) => rowMatchesQuery(r, needle))) return items;
  let id = (knownIdForQuery(q) ?? "").toLowerCase();
  let overlay: string | null = null;
  const gw = getGateway();
  try {
    if (!/^[0-9a-f]{64}$/.test(id)) {
      const s = await fetch(
        `${gw}/v1/tokens/search?${new URLSearchParams({ q: q.trim(), limit: "40" })}`,
        SNAPSHOT_FETCH
      );
      if (!s.ok) return items;
      const body = (await s.json()) as { items?: { tokenId?: string; name?: string | null }[] };
      const hits = Array.isArray(body.items) ? body.items : [];
      const exact =
        hits.find((h) => (h.name ?? "").toLowerCase() === needle) ??
        hits.find((h) => (h.name ?? "").toLowerCase().startsWith(needle));
      id = (exact?.tokenId ?? "").toLowerCase();
      overlay = exact?.name ?? null;
    }
    if (!/^[0-9a-f]{64}$/.test(id) || items.some((r) => r.tokenId.toLowerCase() === id)) {
      return items;
    }
    const rowRes = await fetch(
      `${gw}/v1/tokens?${new URLSearchParams({ q: id, limit: "1" })}`,
      SNAPSHOT_FETCH
    );
    if (!rowRes.ok) return items;
    const page = (await rowRes.json()) as TokensPageData;
    const hit = (page.items ?? []).find((r) => r.tokenId.toLowerCase() === id);
    if (!hit) return items;
    const named = {
      ...hit,
      name: hit.name || overlay || TOKEN_CATALOG[id]?.symbol || null,
    };
    return [named, ...items.filter((r) => r.tokenId.toLowerCase() !== id)].slice(0, TOKEN_PACK);
  } catch {
    return items;
  }
}

export function TokensView({ initial }: { initial: TokensPageData }) {
  const t = useT();
  const { ids: favIds, toggle: toggleFav } = useFavoriteList("tokens");
  const favReady = favIds != null;
  const { locale } = useI18n();
  const { markSynced, tip } = usePageSync();
  const tipRef = useRef(tip);
  tipRef.current = tip;
  const miss = t("home.unavailable");
  const [q, setQ] = useState(initial.q);
  const [items, setItems] = useState<TokenListItem[]>(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [kpis, setKpis] = useState<TokenCatalogKpis>(initial.kpis);
  const [offset, setOffset] = useState(initial.offset || 0);
  const [sort, setSort] = useState<TokenListSort>(initial.sort || "holders");
  const [dir, setDir] = useState<TokenListDir>(initial.dir || "desc");
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(initial.items.length > 0);
  const [err, setErr] = useState<string | null>(null);
  // Rows the server already has go into the first HTML, with the same entry animation.
  const seedIds = initial.items.map((row) => row.tokenId);
  const enter = useEnterIds(ENTER_MS, seedIds);
  const packEnter = useEnterIds(ENTER_MS, seedIds.length ? ["pack"] : []);
  const [listReady, setListReady] = useState(seedIds.length > 0);
  const opened = useRef(seedIds.length > 0);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const sortRef = useRef(sort);
  sortRef.current = sort;
  const dirRef = useRef(dir);
  dirRef.current = dir;
  const qRef = useRef(q);
  qRef.current = q;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const load = useCallback(
    (silent = false) => {
      if (!silent && itemsRef.current.length) setPending(true);
      const want = offsetRef.current;
      void fetch(
        `${getGateway()}${pathFor(want, sortRef.current, dirRef.current, qRef.current, tipRef.current?.height)}`,
        SNAPSHOT_FETCH
      )
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json() as Promise<TokensPageData>;
        })
        .then(async (j) => {
          const next = Array.isArray(j.items) ? j.items : [];
          if (!next.length && want > 0) {
            setOffset((o) => Math.max(0, o - TOKEN_PACK));
            return;
          }
          const pinned = want === 0 ? await pinExactName(qRef.current, next) : next;
          setItems((prev) => {
            enter.mark(
              enteringIds(
                prev.map((r) => ({ id: r.tokenId })),
                pinned.map((r) => ({ id: r.tokenId }))
              )
            );
            return pinned;
          });
          if (typeof j.total === "number" && Number.isFinite(j.total)) setTotal(j.total);
          if (j.kpis) setKpis(j.kpis);
          setErr(null);
          setReady(true);
          markSynced(j.updatedAt);
        })
        .catch((e) => {
          if (!silent) setErr(String(e));
          setReady(true);
        })
        .finally(() => {
          if (!silent) setPending(false);
        });
    },
    [enter.mark, markSynced]
  );

  const painted = useRef(false);
  useEffect(() => {
    if (painted.current) return;
    painted.current = true;
    if (initial.items.length) {
      markSynced(initial.updatedAt);
      if (initial.q.trim()) {
        void pinExactName(initial.q, initial.items).then((pinned) => {
          setItems((prev) => {
            enter.mark(
              enteringIds(
                prev.map((r) => ({ id: r.tokenId })),
                pinned.map((r) => ({ id: r.tokenId }))
              )
            );
            return pinned;
          });
        });
      }
      return;
    }
    load();
  }, [initial, load, markSynced, enter.mark]);

  useEffect(() => {
    if (opened.current) return;
    if (!ready && !items.length) return;
    opened.current = true;
    const ids = items.map((row) => row.tokenId);
    enter.mark(ids);
    if (ids.length) packEnter.mark(["pack"]);
    setListReady(true);
  }, [ready, items, enter.mark, packEnter.mark]);

  const loadRef = useRef(load);
  loadRef.current = load;
  const packKey = `${offset}|${sort}|${dir}`;
  const packSeen = useRef(packKey);
  const skipPack = useRef(false);
  useEffect(() => {
    if (skipPack.current) {
      skipPack.current = false;
      packSeen.current = packKey;
      return;
    }
    if (packSeen.current === packKey) return;
    packSeen.current = packKey;
    loadRef.current();
  }, [packKey]);

  const qSeen = useRef(q);
  useEffect(() => {
    if (qSeen.current === q) return;
    qSeen.current = q;
    skipPack.current = true;
    setOffset(0);
    const tmr = window.setTimeout(() => loadRef.current(), q.trim() ? 220 : 0);
    return () => window.clearTimeout(tmr);
  }, [q]);

  useChainTipRefresh(true, () => {
    if (offsetRef.current !== 0) return;
    load(true);
  });

  useEffect(() => {
    const u = new URL(window.location.href);
    const qq = q.trim();
    if (qq) u.searchParams.set("q", qq);
    else u.searchParams.delete("q");
    const next = `${u.pathname}${u.search}${u.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, "", next);
    }
  }, [q]);

  const onSort = (key: TokenListSort) => {
    setOffset(0);
    if (sort === key) {
      setDir((d) => (d === "desc" ? "asc" : "desc"));
      return;
    }
    setSort(key);
    setDir(key === "name" ? "asc" : "desc");
  };

  const kpiItems = [
    {
      label: t("tokens.kpiTotal"),
      value: kpis.tokenCount != null ? kpis.tokenCount.toLocaleString(loc(locale)) : miss,
      unavailable: kpis.tokenCount == null,
      sub: t("tokens.kpiTokens"),
      mark: <KpiMark id="token" tone={INK.gold} />,
      ink: INK.gold,
      enter: 1,
    },
    {
      label: t("tokens.kpiHolders"),
      value: kpis.holderCount != null ? kpis.holderCount.toLocaleString(loc(locale)) : miss,
      unavailable: kpis.holderCount == null,
      sub: t("tokens.kpiTotal"),
      mark: <KpiMark id="holders" tone={INK.violet} />,
      ink: INK.violet,
      enter: 2,
    },
    {
      label: t("tokens.kpiTxs"),
      value: kpis.txCount != null ? kpis.txCount.toLocaleString(loc(locale)) : miss,
      unavailable: kpis.txCount == null,
      sub: t("tokens.kpiTotal"),
      mark: <KpiMark id="tx" tone={INK.cyan} />,
      ink: INK.cyan,
      enter: 3,
    },
  ];

  return (
    <Shell>
      <KpiGrid
        items={kpiItems}
        dense
        className="token-kpi mb-5"
        before={
          <CatalogSearchTile
            enter={0}
            q={q}
            onQ={setQ}
            searchLabel={t("tokens.search")}
            placeholder={t("tokens.placeholder")}
          />
        }
      />

      {err && (
        <p className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-200">
          {err}
        </p>
      )}

      {!listReady && !err ? null : !items.length && !err ? (
        <Feed>
          <FeedEmpty k="token" title={q.trim() ? t("tokens.noMatch").replace("{q}", q.trim()) : t("tokens.empty")} />
        </Feed>
      ) : null}

      {listReady && items.length > 0 && (
        <div className="feed-sheet">
          <Feed busy={pending} className="is-rank" enterClass={packEnter.enterClass("pack")}>
            <FeedBoard
              plate={
                <FeedPlate
                  tag={t("nav.tokens")}
                  now
                  count={total != null ? <FeedCount k="feed.tokens" n={total} /> : undefined}
                  end={
                    <FeedSort
                      label={t("feed.sort.label")}
                      options={TOKEN_SORTS.map((key) => ({ key, label: t(`feed.sort.${key}`) }))}
                      active={sort}
                      dir={dir}
                      onSort={onSort}
                      disabled={pending}
                    />
                  }
                />
              }
            >
              {items.map((row, i) => (
                <FeedTokenRow
                  key={row.tokenId}
                  row={row}
                  rank={offset + i + 1}
                  sort={sort}
                  enterClass={enter.enterClass(row.tokenId)}
                  fav={{
                    on: favIds?.includes(row.tokenId) ?? false,
                    ready: favReady,
                    title: favIds?.includes(row.tokenId) ? t("favorites.remove") : t("favorites.add"),
                    toggle: () => toggleFav(row.tokenId),
                  }}
                />
              ))}
            </FeedBoard>
          </Feed>
          <RankWindow
            offset={offset}
            pageSize={TOKEN_PACK}
            shown={items.length}
            total={total}
            loc={loc(locale)}
            ofLabel={t("addresses.packOf")}
            prevLabel={t("addresses.packPrev")}
            nextLabel={t("addresses.packNext")}
            tapeLabel={t("tokens.packTape")}
            hint={t("tokens.packHint")}
            disabled={pending}
            onOffset={setOffset}
          />
        </div>
      )}
    </Shell>
  );
}

function relOrHeight(ts: number | null | undefined, height: number | null | undefined, locale: string): string {
  if (ts != null) return formatRelTime(ts, locale);
  if (height != null) return `#${height.toLocaleString(loc(locale))}`;
  return "—";
}

/** One token on the ranked feed. The figure on the right is whatever the list is sorted by. */
export function FeedTokenRow({
  row,
  rank,
  sort,
  enterClass,
  fav,
}: {
  row: TokenListItem;
  rank: number;
  sort: TokenListSort;
  enterClass?: string;
  fav: { on: boolean; ready: boolean; title: string; toggle: () => void };
}) {
  const { t, tn, locale } = useI18n();
  const tag = loc(locale);
  const name = tokenName(row);
  const href = `/token/${row.tokenId}`;
  const lastTs = row.lastTs ?? row.firstTs;
  let supplyRaw: bigint | null = null;
  try {
    supplyRaw = row.emission == null || row.emission === "" ? null : toBigIntAmt(row.emission);
  } catch {
    supplyRaw = null;
  }
  const supply = supplyRaw == null ? null : formatScaledGlance(supplyRaw, row.decimals ?? 0, tag);
  const holders = row.holders != null ? row.holders.toLocaleString(tag) : "—";
  const txs = row.txCount != null ? row.txCount.toLocaleString(tag) : "—";
  const created = relOrHeight(row.firstTs, row.firstHeight, locale);
  const active = relOrHeight(lastTs, row.lastHeight, locale);
  const key = sort === "name" ? "holders" : sort;
  const value =
    key === "supply" ? (supply?.text ?? "—") : key === "txs" ? txs : key === "first" ? created : key === "last" ? active : holders;
  return (
    <FeedRow
      k="token"
      tile={<TokenLogo tokenId={row.tokenId} artworkUrl={row.artworkUrl} size={22} />}
      lead={{ rank: rank.toLocaleString(tag) }}
      enterClass={enterClass}
      onPointerEnter={() => prefetchTokenHolders(row.tokenId)}
      title={
        <>
          <Link
            prefetch={false}
            href={href}
            title={row.tokenId}
            className={clsx("feed-name hover:underline", name ? "font-semibold" : "font-mono tabular-nums")}
            onFocus={() => prefetchTokenHolders(row.tokenId)}
          >
            {name ?? shortId(row.tokenId, 8)}
          </Link>
          <FavoriteHeart size="sm" on={fav.on} ready={fav.ready} title={fav.title} onToggle={fav.toggle} />
        </>
      }
      facts={
        <>
          <span className="font-mono tabular-nums">{shortId(row.tokenId, 6)}</span>
          {key !== "holders" ? (
            <FeedCount k="feed.holders" n={row.holders ?? 0} />
          ) : null}
          {key !== "txs" ? (
            <FeedCount k="feed.txCount" n={row.txCount ?? 0} className="feed-mid" />
          ) : null}
          {key !== "supply" && supply ? (
            <span className="feed-wide" title={supply.exact}>
              {t("feed.supply")} <span className="tabular-nums">{supply.text}</span>
            </span>
          ) : null}
          {key !== "last" ? (
            <span>
              <FeedPhrase text={t("feed.active")} value={active} />
            </span>
          ) : null}
          {key !== "first" ? (
            <span className="feed-wide">
              <FeedPhrase text={t("feed.created")} value={created} />
            </span>
          ) : null}
        </>
      }
      value={
        <span
          className="feed-amt tabular-nums"
          title={key === "supply" ? supply?.exact : undefined}
          suppressHydrationWarning
        >
          {value}
        </span>
      }
      sub={t(`feed.sort.${key}`)}
      subMinor
      detail={() => (
        <FeedFields>
          <FeedField label={t("tokens.colPolicy")} wide>
            <FeedIdLine href={href} id={row.tokenId} />
          </FeedField>
          <FeedField label={t("tokens.colSupply")}>
            <span className="tabular-nums">{supplyRaw == null ? "—" : formatScaledAmount(supplyRaw, row.decimals ?? 0, tag)}</span>
          </FeedField>
          <FeedField label={t("token.decimals")}>
            <span className="tabular-nums">{row.decimals ?? 0}</span>
          </FeedField>
          <FeedField label={t("tokens.colHolders")}>
            <span className="tabular-nums">
              {holders}
              {row.unspentBoxes != null ? (
                <span className="text-[var(--muted-2)]"> · {tn("feed.boxes", row.unspentBoxes, row.unspentBoxes.toLocaleString(tag))}</span>
              ) : null}
            </span>
          </FeedField>
          <FeedField label={t("feed.sort.txs")}>
            <span className="tabular-nums">{txs}</span>
          </FeedField>
          <FeedField label={t("feed.sort.first")}>
            <span className="tabular-nums" suppressHydrationWarning>
              {row.firstTs != null ? formatTs(row.firstTs) : "—"}
              {row.firstHeight != null ? <span className="text-[var(--muted-2)]"> · #{row.firstHeight.toLocaleString(tag)}</span> : null}
            </span>
          </FeedField>
          <FeedField label={t("feed.sort.last")}>
            <span className="tabular-nums" suppressHydrationWarning>
              {lastTs != null ? formatTs(lastTs) : "—"}
              {row.lastHeight != null ? <span className="text-[var(--muted-2)]"> · #{row.lastHeight.toLocaleString(tag)}</span> : null}
            </span>
          </FeedField>
        </FeedFields>
      )}
    />
  );
}
