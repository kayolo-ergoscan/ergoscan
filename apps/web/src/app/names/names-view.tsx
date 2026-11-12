"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import { AddressStatTile } from "@/components/AddressStatTile";
import { BookKindMark, type BookTileId } from "@/components/BookKindMark";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { RankWindow } from "@/components/RankWindow";
import {
  Feed,
  FeedAmount,
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
  feedLoc,
  type FeedKind,
} from "@/components/feed/Feed";
import type { FeedGlyphId } from "@/components/feed/FeedGlyph";
import {
  BOOK_DIRECTORY_KINDS,
  countBookKinds,
  directoryKind,
  listBookEntries,
  NAMES_REGISTRY_URL,
  type BookDirectoryKind,
  type BookEntry,
} from "@/lib/address-book";
import { listPip } from "@/lib/address-pips";
import { getGateway } from "@/lib/config";
import { useFavoriteAddresses } from "@/lib/favorites";
import { formatRelTime, formatScaledAmount, formatTs, shortId, toBigIntAmt } from "@/lib/format";
import { useT, useI18n } from "@/lib/i18n/I18nProvider";
import { enteringIds, useEnterIds } from "@/lib/keyed-enter";
import { ADDRESS_PACK, type AddressListDir } from "@/lib/list-snapshots";
import { prefetchAddressPage } from "@/lib/address-page-cache";
import { INK, KIND } from "@/lib/palette";

const TILES: BookTileId[] = ["all", ...BOOK_DIRECTORY_KINDS];

const TILE_INK: Record<BookTileId, string> = {
  all: "#c5c3cc",
  protocol: KIND.protocol,
  exchange: KIND.exchange,
  pool: KIND.pool,
  contract: KIND.contract,
  wallet: INK.cyan,
};

/** `/v1/names/stats`: balance and activity of each named address, and who named it. */
type NameStats = {
  address: string;
  nanoerg: string | null;
  tokenCount: number | null;
  txCount: number | null;
  lastTs: number | null;
  project: string;
  by: "project" | "ergoscan";
  fileUrl: string;
};

type SortKey = "name" | "txs" | "erg" | "last";

const NAME_SORTS: SortKey[] = ["name", "erg", "txs", "last"];

function typeLabel(kind: BookDirectoryKind, t: (k: string) => string): string {
  if (kind === "wallet") return t("addresses.pip.holder");
  if (kind === "contract") return t("addresses.book.leftover");
  return t(`addresses.pip.${kind}`);
}

function tileLabel(id: BookTileId, t: (k: string) => string): string {
  if (id === "all") return t("addresses.book.all");
  return typeLabel(id, t);
}

function statValue(s: NameStats | undefined, key: SortKey): number | null {
  if (!s) return null;
  if (key === "txs") return s.txCount;
  if (key === "erg") return s.nanoerg == null ? null : Number(s.nanoerg);
  if (key === "last") return s.lastTs;
  return null;
}

function useNameStats(): Map<string, NameStats> | null {
  const [stats, setStats] = useState<Map<string, NameStats> | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${getGateway()}/v1/names/stats`, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { items?: NameStats[] } | null) => {
        if (live && j?.items) setStats(new Map(j.items.map((s) => [s.address, s])));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return stats;
}

export function NamesView() {
  const t = useT();
  const { locale } = useI18n();
  const loc = locale === "ru" ? "ru-RU" : "en-US";
  const counts = useMemo(() => countBookKinds(), []);
  const stats = useNameStats();
  const [kind, setKind] = useState<BookTileId>("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [dir, setDir] = useState<AddressListDir>("asc");
  const [offset, setOffset] = useState(0);
  const enter = useEnterIds();
  const packEnter = useEnterIds();
  const [listReady, setListReady] = useState(false);
  const idsRef = useRef<string[]>([]);
  const painted = useRef(false);

  const rows = useMemo(() => {
    const byName = listBookEntries({ kind, dir: sort === "name" ? dir : "asc" });
    if (sort === "name" || !stats) return byName;
    const mul = dir === "asc" ? 1 : -1;
    return [...byName].sort((a, b) => {
      const va = statValue(stats.get(a.address), sort);
      const vb = statValue(stats.get(b.address), sort);
      if (va == null || vb == null) return va == null ? (vb == null ? 0 : 1) : -1;
      return (va - vb) * mul;
    });
  }, [kind, sort, dir, stats]);
  const slice = useMemo(() => rows.slice(offset, offset + ADDRESS_PACK), [rows, offset]);

  useEffect(() => {
    if (offset === 0) return;
    if (offset < rows.length) return;
    setOffset(Math.max(0, Math.floor(Math.max(0, rows.length - 1) / ADDRESS_PACK) * ADDRESS_PACK));
  }, [offset, rows.length]);

  const packKey = slice.map((e) => e.address).join("|");
  useEffect(() => {
    const next = packKey ? packKey.split("|") : [];
    if (!painted.current) {
      painted.current = true;
      idsRef.current = next;
      enter.mark(next);
      if (next.length) packEnter.mark(["pack"]);
      setListReady(true);
      return;
    }
    enter.mark(
      enteringIds(
        idsRef.current.map((id) => ({ id })),
        next.map((id) => ({ id }))
      )
    );
    idsRef.current = next;
  }, [packKey, enter.mark, packEnter.mark]);

  const { ids: favIds, toggle: toggleFav } = useFavoriteAddresses();
  const favReady = favIds != null;
  const favSet = useMemo(() => new Set(favIds ?? []), [favIds]);

  const onKind = (id: BookTileId) => {
    setKind(id);
    setOffset(0);
  };

  const onSort = (k: SortKey) => {
    setOffset(0);
    if (k === sort) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSort(k);
    setDir(k === "name" ? "asc" : "desc");
  };

  return (
    <Shell>
      <div className="addr-drop grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {TILES.map((id, i) => (
          <AddressStatTile
            key={id}
            enter={i}
            label={tileLabel(id, t)}
            n={counts[id]}
            caption={t(`names.tile.${id}Caption`)}
            detail={t(`names.tile.${id}Detail`)}
            hint={t(`names.tile.${id}Flavor`)}
            ink={TILE_INK[id]}
            loc={loc}
            mark={<BookKindMark id={id} />}
            selected={kind === id}
            onSelect={() => onKind(id)}
          />
        ))}
      </div>

      {!listReady ? null : rows.length === 0 ? (
        <Feed>
          <FeedEmpty k="addr" title={t("addresses.book.empty")} />
        </Feed>
      ) : (
        <div className="feed-sheet">
          <Feed className="is-rank" enterClass={packEnter.enterClass("pack")}>
            <FeedBoard
              plate={
                <FeedPlate
                  tag={tileLabel(kind, t)}
                  now
                  count={<FeedCount k="feed.names" n={rows.length} />}
                  end={
                    <FeedSort
                      label={t("feed.sort.label")}
                      options={NAME_SORTS.map((key) => ({ key, label: t(`feed.sort.${key}`) }))}
                      active={sort}
                      dir={dir}
                      onSort={onSort}
                    />
                  }
                />
              }
            >
              {slice.map((row, i) => (
                <NameFeedRow
                  key={row.address}
                  row={row}
                  rank={offset + i + 1}
                  sort={sort}
                  stats={stats?.get(row.address)}
                  enterClass={enter.enterClass(row.address)}
                  fav={{ on: favSet.has(row.address), ready: favReady, toggle: toggleFav }}
                />
              ))}
            </FeedBoard>
          </Feed>
          <p className="feed-note">
            {t("addresses.book.sourceNote")}{" "}
            <a href={NAMES_REGISTRY_URL} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              {t("addresses.book.registryLink")}
            </a>
          </p>
          <RankWindow
            offset={offset}
            pageSize={ADDRESS_PACK}
            shown={slice.length}
            total={rows.length}
            loc={loc}
            ofLabel={t("addresses.packOf")}
            prevLabel={t("addresses.packPrev")}
            nextLabel={t("addresses.packNext")}
            tapeLabel={t("addresses.packTape")}
            hint={t("addresses.book.packHint")}
            disabled={false}
            onOffset={setOffset}
          />
        </div>
      )}
    </Shell>
  );
}

const KIND_TILE: Record<BookDirectoryKind, [FeedKind, FeedGlyphId]> = {
  protocol: ["defi", "protocol"],
  exchange: ["exchange", "exchange"],
  pool: ["reward", "pool"],
  contract: ["contract", "contract"],
  wallet: ["addr", "holder"],
};

/** One named address. The figure on the right is what the list is sorted by; by name it is the balance. */
function NameFeedRow({
  row,
  rank,
  sort,
  stats,
  enterClass,
  fav,
}: {
  row: BookEntry;
  rank: number;
  sort: SortKey;
  stats: NameStats | undefined;
  enterClass?: string;
  fav: { on: boolean; ready: boolean; toggle: (address: string) => void };
}) {
  const { t, locale } = useI18n();
  const tag = feedLoc(locale);
  const kind = directoryKind(row);
  const pip = listPip(row.address);
  const [k, g] = kind ? KIND_TILE[kind] : (["addr", "holder"] as [FeedKind, FeedGlyphId]);
  const type =
    kind === "contract" ? t("address.type.contract") : kind ? typeLabel(kind, t) : t(`addresses.pip.${pip.id}`);
  const project = stats?.project ?? (row.registry ? row.note : undefined);
  const by = stats?.by ?? row.registry?.by ?? null;
  const fileUrl = stats?.fileUrl ?? row.registry?.fileUrl ?? null;
  const href = `/address/${encodeURIComponent(row.address)}`;
  let erg: bigint | null = null;
  try {
    erg = stats?.nanoerg != null ? toBigIntAmt(stats.nanoerg) : null;
  } catch {
    erg = null;
  }
  const active = stats?.lastTs != null ? formatRelTime(stats.lastTs, locale) : null;
  const byLabel = by ? t(by === "project" ? "names.byProject" : "names.byErgoscan") : null;
  const value =
    sort === "txs" ? (
      <span className="feed-amt tabular-nums">{stats?.txCount != null ? stats.txCount.toLocaleString(tag) : "—"}</span>
    ) : sort === "last" ? (
      <span className="feed-amt tabular-nums" suppressHydrationWarning>
        {active ?? "—"}
      </span>
    ) : (
      <FeedAmount raw={erg} glance />
    );
  return (
    <FeedRow
      k={k}
      glyph={g}
      tileTitle={type}
      lead={{ rank: rank.toLocaleString(tag) }}
      enterClass={enterClass}
      onPointerEnter={() => prefetchAddressPage(row.address)}
      title={
        <>
          <Link
            prefetch={false}
            href={href}
            title={row.address}
            className="feed-name hover:underline"
            onFocus={() => prefetchAddressPage(row.address)}
          >
            {row.name}
          </Link>
          <FavoriteHeart
            size="sm"
            on={fav.on}
            ready={fav.ready}
            title={fav.on ? t("favorites.remove") : t("favorites.add")}
            onToggle={() => fav.toggle(row.address)}
          />
        </>
      }
      facts={
        <>
          <span className="feed-kind">{type}</span>
          {project && project !== row.name ? <span className="feed-narrow-off">{project}</span> : null}
          <span className="font-mono tabular-nums">{shortId(row.address, 6)}</span>
          {byLabel ? <span className={clsx("feed-mid", by === "project" && "feed-accent")}>{byLabel}</span> : null}
          {sort !== "txs" && stats?.txCount != null ? (
            <FeedCount k="feed.txCount" n={stats.txCount} className="feed-mid" />
          ) : null}
          {sort !== "last" && active ? (
            <span className="feed-wide">
              <FeedPhrase text={t("feed.active")} value={active} />
            </span>
          ) : null}
        </>
      }
      value={value}
      sub={sort === "txs" || sort === "last" ? t(`feed.sort.${sort}`) : undefined}
      subMinor
      detail={() => (
        <FeedFields>
          <FeedField label={t("addresses.colAddress")} wide>
            <FeedIdLine href={href} id={row.address} />
          </FeedField>
          <FeedField label={t("addresses.colName")}>
            <span>{[row.name, project && project !== row.name ? project : null, type].filter(Boolean).join(" · ")}</span>
          </FeedField>
          <FeedField label={t("names.colSource")}>
            <span>
              {byLabel ?? "—"}
              {fileUrl ? (
                <>
                  {" · "}
                  <a href={fileUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    ergo-names
                  </a>
                </>
              ) : null}
            </span>
          </FeedField>
          <FeedField label={t("addresses.colErg")}>
            <span className="tabular-nums">{erg != null ? formatScaledAmount(erg, 9, tag) : "—"}</span>
          </FeedField>
          <FeedField label={t("addresses.colTxs")}>
            <span className="tabular-nums">
              {stats?.txCount != null ? stats.txCount.toLocaleString(tag) : "—"}
              {stats?.tokenCount ? (
                <span className="text-[var(--muted-2)]">
                  {" · "}
                  <FeedCount k="feed.tokens" n={stats.tokenCount} />
                </span>
              ) : null}
            </span>
          </FeedField>
          <FeedField label={t("addresses.colLast")}>
            <span className="tabular-nums" suppressHydrationWarning>
              {stats?.lastTs != null ? formatTs(stats.lastTs) : "—"}
              {active ? <span className="text-[var(--muted-2)]"> · {active}</span> : null}
            </span>
          </FeedField>
        </FeedFields>
      )}
    />
  );
}
