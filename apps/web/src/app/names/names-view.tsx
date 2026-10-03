"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import { AddressPip } from "@/components/AddressPip";
import { AddressStatTile } from "@/components/AddressStatTile";
import { AddressActivityWhen } from "@/components/AddressTapeRow";
import { BookKindMark, type BookTileId } from "@/components/BookKindMark";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { NameMarquee } from "@/components/NameMarquee";
import { RankWindow } from "@/components/RankWindow";
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
import { formatErgFixed, shortId } from "@/lib/format";
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

function SortMark({ on, dir }: { on: boolean; dir: AddressListDir }) {
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
  k: SortKey;
  sort: SortKey;
  dir: AddressListDir;
  align: "left" | "right";
  onSort: (k: SortKey) => void;
  className: string;
}) {
  const t = useT();
  const on = sort === k;
  return (
    <div
      className={clsx("h-full min-w-0 items-center", align === "right" && "justify-end", className)}
      aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        aria-label={on ? `${label}, ${dir === "asc" ? t("addresses.sortAsc") : t("addresses.sortDesc")}` : label}
        className={clsx(
          "chip-press inline-flex shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[10px] px-2 py-1.5 text-[12px] font-medium leading-none transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-[var(--text)]",
          on ? "is-pressed bg-[var(--wash-strong)] text-[var(--text)]" : "text-[var(--muted)]"
        )}
      >
        {align === "right" ? <SortMark on={on} dir={dir} /> : null}
        <span>{label}</span>
        {align === "left" ? <SortMark on={on} dir={dir} /> : null}
      </button>
    </div>
  );
}

function HeadLabel({ label, className }: { label: string; className: string }) {
  return (
    <div className={clsx("h-full min-w-0 items-center px-2", className)}>
      <span className="whitespace-nowrap text-[12px] font-medium leading-none text-[var(--muted)]">{label}</span>
    </div>
  );
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
  const [stuck, setStuck] = useState(false);
  const enter = useEnterIds();
  const packEnter = useEnterIds();
  const [listReady, setListReady] = useState(false);
  const pinRef = useRef<HTMLDivElement>(null);
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
  }, [slice.length]);

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
      <div className="addr-drop mb-3 grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3 lg:grid-cols-6">
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
        <p className="text-[var(--muted)]">{t("addresses.book.empty")}</p>
      ) : (
        <div className="addr-sheet">
          <div ref={pinRef} className="h-px w-full" aria-hidden />
          <div className={packEnter.enterClass("pack")}>
          <div
            className={clsx(
              "addr-head addr-lane addr-lane-x book-lane text-[12px] font-medium",
              stuck && "is-stuck"
            )}
          >
            <SortCol className="book-name" label={t("addresses.colName")} k="name" sort={sort} dir={dir} align="left" onSort={onSort} />
            <HeadLabel className="book-addr" label={t("addresses.colAddress")} />
            <HeadLabel className="book-src" label={t("names.colSource")} />
            <SortCol className="book-txs" label={t("addresses.colTxs")} k="txs" sort={sort} dir={dir} align="right" onSort={onSort} />
            <SortCol className="book-erg" label={t("addresses.colErg")} k="erg" sort={sort} dir={dir} align="right" onSort={onSort} />
            <SortCol className="book-last" label={t("addresses.colLast")} k="last" sort={sort} dir={dir} align="right" onSort={onSort} />
          </div>
          {slice.map((row) => (
            <NameTapeRow
              key={row.address}
              row={row}
              stats={stats?.get(row.address)}
              t={t}
              loc={loc}
              enterClass={enter.enterClass(row.address)}
              fav={favSet.has(row.address)}
              favReady={favReady}
              onToggleFav={toggleFav}
            />
          ))}
          <p className="px-3 py-2 text-[11px] text-[var(--muted-2)]">
            {t("addresses.book.sourceNote")}{" "}
            <a href={NAMES_REGISTRY_URL} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              {t("addresses.book.registryLink")}
            </a>
          </p>
          </div>
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

function CopyAddress({ text, t }: { text: string; t: (k: string) => string }) {
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
      aria-label={ok ? t("tx.copied") : t("tx.copy")}
      title={ok ? t("tx.copied") : t("tx.copy")}
      className="chip-press inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-[6px] text-[var(--muted)] transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--wash)] hover:text-[var(--text)]"
    >
      {ok ? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M2.4 6.2 4.8 8.6 9.6 3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <rect x="4" y="4" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M3 8.2V3.4A1.2 1.2 0 0 1 4.2 2.2H8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

function NameTapeRow({
  row,
  stats,
  t,
  loc,
  enterClass,
  fav,
  favReady,
  onToggleFav,
}: {
  row: BookEntry;
  stats: NameStats | undefined;
  t: (k: string) => string;
  loc: string;
  enterClass?: string;
  fav: boolean;
  favReady: boolean;
  onToggleFav: (id: string) => void;
}) {
  const pip = listPip(row.address);
  const kind = directoryKind(row);
  const type =
    kind === "contract" ? t("address.type.contract") : kind ? typeLabel(kind, t) : t(`addresses.pip.${pip.id}`);
  const project = stats?.project ?? (row.registry ? row.note : undefined);
  const sub = project && project !== row.name ? `${project} · ${type}` : type;
  const by = stats?.by ?? row.registry?.by ?? null;
  const fileUrl = stats?.fileUrl ?? row.registry?.fileUrl ?? null;
  const nano = stats?.nanoerg ?? null;
  const aria = [row.name, shortId(row.address, 10), sub].join(" · ");
  return (
    <div
      className={clsx(
        "addr-lane addr-lane-x book-lane border-t border-[var(--border-soft)] py-2.5 text-[13px]",
        enterClass
      )}
      onPointerEnter={() => prefetchAddressPage(row.address)}
    >
      <div className="book-name min-w-0 flex-col justify-center px-3">
        <div className="flex min-h-[1.35em] min-w-0 items-center gap-2">
          <AddressPip
            address={row.address}
            nanoerg={nano ?? "0"}
            kindLabel={t(`addresses.pip.${pip.id}`)}
            className="h-[18px] w-[18px] shrink-0"
          />
          <Link
            href={`/address/${encodeURIComponent(row.address)}`}
            aria-label={aria}
            className="min-w-0 text-soft hover:underline"
            title={row.name}
            onFocus={() => prefetchAddressPage(row.address)}
          >
            <NameMarquee text={row.name} />
          </Link>
          <FavoriteHeart
            size="sm"
            on={fav}
            ready={favReady}
            title={fav ? t("favorites.remove") : t("favorites.add")}
            onToggle={() => onToggleFav(row.address)}
          />
        </div>
        <p className="mt-1 truncate pl-[26px] text-[11px] leading-none text-[var(--muted)]">
          {sub}
          <span className="font-mono sm:hidden"> · {shortId(row.address, 4)}</span>
        </p>
      </div>
      <div className="book-addr min-w-0 items-center gap-1 px-3">
        <span className="min-w-0 truncate font-mono text-[12px] leading-none text-[var(--muted)]" title={row.address}>
          {shortId(row.address, 6)}
        </span>
        <CopyAddress text={row.address} t={t} />
      </div>
      <div className="book-src min-w-0 flex-col justify-center px-3">
        {by ? (
          <>
            <p
              className={clsx("truncate leading-none", by === "project" ? "text-accent" : "text-[var(--text)]")}
              title={t(by === "project" ? "address.nameByProject" : "address.nameByErgoscan")}
            >
              {t(by === "project" ? "names.byProject" : "names.byErgoscan")}
            </p>
            {fileUrl ? (
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 w-fit text-[11px] leading-none text-accent hover:underline"
              >
                ergo-names
              </a>
            ) : null}
          </>
        ) : (
          <span className="text-[var(--muted)]">—</span>
        )}
      </div>
      <div className="book-txs items-center justify-end px-3 tabular-nums leading-none text-[var(--muted)]">
        {stats?.txCount != null ? stats.txCount.toLocaleString(loc) : "—"}
      </div>
      <div
        className={clsx(
          "book-erg items-center justify-end whitespace-nowrap px-3 font-medium tabular-nums leading-none",
          nano == null || nano === "0" ? "font-normal text-[var(--muted)]" : "text-[var(--up)]"
        )}
      >
        {nano != null ? formatErgFixed(nano, loc) : "—"}
      </div>
      <div className="book-last items-center justify-end">
        <AddressActivityWhen
          ts={stats?.lastTs ?? null}
          locale={loc}
          align="right"
          openLabel={t("addresses.openTx")}
          copyLabel={t("tx.copy")}
          copiedLabel={t("tx.copied")}
        />
      </div>
    </div>
  );
}
