"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import { KpiGrid } from "@/components/KpiGrid";
import {
  KpiMarkCoins,
  KpiMarkUsers,
  KpiMarkWorkflow,
} from "@/components/kpi-marks";
import { CatalogSearchTile } from "@/components/CatalogSearchTile";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { INK } from "@/lib/palette";
import { RankWindow } from "@/components/RankWindow";
import { TokenLogo } from "@/components/TokenBadge";
import { getGateway } from "@/lib/config";
import {
  formatRelTime,
  formatScaledAmount,
  formatTs,
  shortId,
  toBigIntAmt,
} from "@/lib/format";
import { TOKEN_CATALOG, tokenTickerInk } from "@/lib/token-meta";
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

function SortMark({ on, dir }: { on: boolean; dir: TokenListDir }) {
  return (
    <span className="sort-mark" aria-hidden>
      <span className={clsx("sort-caret sort-caret-up", on && dir === "asc" && "is-on")} />
      <span className={clsx("sort-caret sort-caret-dn", on && dir === "desc" && "is-on")} />
    </span>
  );
}

function SortCol({
  label,
  k,
  sort,
  dir,
  align,
  onSort,
  className,
}: {
  label: string;
  k: TokenListSort;
  sort: TokenListSort;
  dir: TokenListDir;
  align: "left" | "right";
  onSort: (k: TokenListSort) => void;
  className?: string;
}) {
  const t = useT();
  const on = sort === k;
  const hint = on
    ? `${label}, ${dir === "asc" ? t("addresses.sortAsc") : t("addresses.sortDesc")}`
    : label;
  return (
    <div
      className={clsx(
        "flex h-full min-w-0 items-center",
        align === "right" && "justify-end",
        className
      )}
      aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        aria-label={hint}
        className={clsx(
          "chip-press inline-flex shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[10px] px-2 py-1.5 text-[12px] font-medium leading-none transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-[var(--text)]",
          on ? "is-pressed bg-[var(--wash-strong)] text-[var(--text)]" : "text-[var(--muted)]"
        )}
      >
        {align === "right" ? (
          <>
            <SortMark on={on} dir={dir} />
            <span>{label}</span>
          </>
        ) : (
          <>
            <span>{label}</span>
            <SortMark on={on} dir={dir} />
          </>
        )}
      </button>
    </div>
  );
}

function fmtSupply(row: TokenListItem, locale: string, miss: string): string {
  if (row.emission == null || row.emission === "") return miss;
  try {
    return formatScaledAmount(toBigIntAmt(row.emission), row.decimals ?? 0, locale);
  } catch {
    return miss;
  }
}

function HeadLabel({ label, align }: { label: string; align: "left" | "right" }) {
  return (
    <div
      className={clsx(
        "flex h-full min-w-0 w-full items-center",
        align === "right" && "justify-end"
      )}
    >
      <span
        className={clsx(
          "whitespace-nowrap text-[12px] font-medium leading-none text-[var(--muted)]",
          align === "right" ? "text-right" : "text-left"
        )}
      >
        {label}
      </span>
    </div>
  );
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
  const [stuck, setStuck] = useState(false);
  // Rows the server already has go into the first HTML, with the same entry animation.
  const seedIds = initial.items.map((row) => row.tokenId);
  const enter = useEnterIds(ENTER_MS, seedIds);
  const packEnter = useEnterIds(ENTER_MS, seedIds.length ? ["pack"] : []);
  const [listReady, setListReady] = useState(seedIds.length > 0);
  const opened = useRef(seedIds.length > 0);
  const pinRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const el = pinRef.current;
    if (!el || !items.length) {
      setStuck(false);
      return;
    }
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
      mark: <KpiMarkCoins tone={INK.gold} />,
      ink: INK.gold,
      enter: 1,
    },
    {
      label: t("tokens.kpiHolders"),
      value: kpis.holderCount != null ? kpis.holderCount.toLocaleString(loc(locale)) : miss,
      unavailable: kpis.holderCount == null,
      sub: t("tokens.kpiTotal"),
      mark: <KpiMarkUsers tone={INK.violet} />,
      ink: INK.violet,
      enter: 2,
    },
    {
      label: t("tokens.kpiTxs"),
      value: kpis.txCount != null ? kpis.txCount.toLocaleString(loc(locale)) : miss,
      unavailable: kpis.txCount == null,
      sub: t("tokens.kpiTotal"),
      mark: <KpiMarkWorkflow tone={INK.cyan} />,
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
        <p className="text-[var(--muted)]">
          {q.trim() ? t("tokens.noMatch").replace("{q}", q.trim()) : t("tokens.empty")}
        </p>
      ) : null}

      {listReady && items.length > 0 && (
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
                "addr-head addr-lane addr-lane-x token-lane text-[12px] font-medium",
                stuck && "is-stuck"
              )}
            >
              <div className="token-lane-name">
                <div className="justify-center !px-2" aria-hidden="true" />
                <SortCol label={t("tokens.colName")} k="name" sort={sort} dir={dir} align="left" onSort={onSort} />
              </div>
              <div className="token-lane-id min-w-0 grid">
                <HeadLabel label={t("tokens.colId")} align="left" />
                <SortCol
                  label={t("tokens.colSupply")}
                  k="supply"
                  sort={sort}
                  dir={dir}
                  align="right"
                  onSort={onSort}
                />
              </div>
              <div className="token-lane-pair min-w-0 grid">
                <SortCol
                  label={t("tokens.colFirst")}
                  k="first"
                  sort={sort}
                  dir={dir}
                  align="left"
                  onSort={onSort}
                />
                <SortCol
                  label={t("tokens.colLast")}
                  k="last"
                  sort={sort}
                  dir={dir}
                  align="right"
                  onSort={onSort}
                />
              </div>
              <div className="token-lane-triple">
                <SortCol
                  label={t("tokens.colTxs")}
                  k="txs"
                  sort={sort}
                  dir={dir}
                  align="left"
                  onSort={onSort}
                />
                <SortCol
                  label={t("tokens.colHolders")}
                  k="holders"
                  sort={sort}
                  dir={dir}
                  align="right"
                  onSort={onSort}
                />
              </div>
            </div>
            {items.map((row) => (
              <TokenTapeRow
                key={row.tokenId}
                row={row}
                locale={locale}
                enterClass={enter.enterClass(row.tokenId)}
                fav={favIds?.includes(row.tokenId) ?? false}
                favReady={favReady}
                favTitle={
                  favIds?.includes(row.tokenId) ? t("favorites.remove") : t("favorites.add")
                }
                onToggleFav={() => toggleFav(row.tokenId)}
              />
            ))}
          </div>
          </div>
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

export function TokenTapeRow({
  row,
  locale,
  enterClass,
  fav = false,
  favReady = true,
  favTitle,
  onToggleFav,
}: {
  row: TokenListItem;
  locale: string;
  enterClass?: string;
  fav?: boolean;
  favReady?: boolean;
  favTitle?: string;
  onToggleFav?: () => void;
}) {
  const name = tokenName(row);
  const firstTs = row.firstTs;
  const lastTs = row.lastTs ?? row.firstTs;
  const href = `/token/${row.tokenId}`;
  return (
    <div
      className={clsx(
        "addr-lane addr-lane-x token-lane border-t border-[var(--border-soft)] py-2.5 text-[13px]",
        enterClass
      )}
      onPointerEnter={() => prefetchTokenHolders(row.tokenId)}
    >
      <div className="token-lane-name">
        <div className="flex items-center justify-center !px-2">
          <TokenLogo tokenId={row.tokenId} artworkUrl={row.artworkUrl} size={28} />
        </div>
        <div className="min-w-0 px-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {name ? (
              <Link
                prefetch={false}
                href={href}
                className="min-w-0 truncate font-semibold hover:underline"
                style={{ color: tokenTickerInk(row.tokenId) }}
                onFocus={() => prefetchTokenHolders(row.tokenId)}
              >
                {name}
              </Link>
            ) : null}
            {onToggleFav ? (
              <FavoriteHeart
                size="sm"
                on={fav}
                ready={favReady}
                title={favTitle ?? ""}
                onToggle={onToggleFav}
              />
            ) : null}
          </div>
        </div>
      </div>
      <div className="token-lane-id min-w-0 grid">
        <div className="min-w-0 px-2">
          <Link
            prefetch={false}
            href={href}
            className="block truncate font-mono text-[12px] text-accent hover:underline"
            title={row.tokenId}
            onFocus={() => prefetchTokenHolders(row.tokenId)}
          >
            {shortId(row.tokenId, 8)}
          </Link>
        </div>
        <div className="min-w-0 px-2 text-right tabular-nums">{fmtSupply(row, locale, "—")}</div>
      </div>
      <div className="token-lane-pair min-w-0 grid">
        <div
          suppressHydrationWarning
          className="min-w-0 px-2 text-left tabular-nums text-[var(--muted)]"
          title={firstTs != null ? formatTs(firstTs) : undefined}
        >
          {firstTs != null
            ? formatRelTime(firstTs, locale)
            : row.firstHeight != null
              ? `#${row.firstHeight.toLocaleString(loc(locale))}`
              : "—"}
        </div>
        <div
          suppressHydrationWarning
          className="min-w-0 px-2 text-right tabular-nums"
          title={lastTs != null ? formatTs(lastTs) : undefined}
        >
          {lastTs != null
            ? formatRelTime(lastTs, locale)
            : row.lastHeight != null
              ? `#${row.lastHeight.toLocaleString(loc(locale))}`
              : "—"}
        </div>
      </div>
      <div className="token-lane-triple">
        <div className="min-w-0 px-2 text-left tabular-nums text-[var(--muted)]">
          {row.txCount != null ? row.txCount.toLocaleString(loc(locale)) : "—"}
        </div>
        <div className="min-w-0 px-2 text-right tabular-nums">
          {row.holders != null ? row.holders.toLocaleString(loc(locale)) : "—"}
        </div>
      </div>
    </div>
  );
}
