"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Shell } from "@/components/Shell";
import { AddressKindKey } from "@/components/AddressKindKey";
import { Feed, FeedBoard, FeedCount, FeedEmpty, FeedPlate, FeedSort } from "@/components/feed/Feed";
import { FeedAddressRow } from "@/components/feed/FeedHolderRow";
import { HolderBandStrip } from "@/components/HolderBandStrip";
import { KpiChipRail } from "@/components/KpiGrid";
import { RankWindow } from "@/components/RankWindow";
import { getGateway } from "@/lib/config";
import { useFavoriteAddresses } from "@/lib/favorites";
import { useT, useI18n } from "@/lib/i18n/I18nProvider";
import { useChainTipRefresh, usePageSync } from "@/lib/page-sync";
import {
  ADDRESS_PACK,
  joinAddressListFilter,
  parseAddressListBands,
  parseAddressListKinds,
  normalizeAddressListFilter,
  type AddressListDir,
  type AddressListItem,
  type AddressListSort,
  type AddressesPageData,
} from "@/lib/list-snapshots";
import { HOLDER_BAND_IDS, bandCount, mergeBands, type HolderBandId } from "@/lib/holder-bands";
import { mergeKinds, type ListEntityId } from "@/lib/address-pips";
import { ENTER_MS, SNAPSHOT_FETCH, enteringIds, snapshotPath, useEnterIds } from "@/lib/keyed-enter";
import { say } from "@/lib/kayolo/events";

/** Sort chips, in the order a reader asks: who holds most, who is busiest. */
const ADDRESS_SORTS: AddressListSort[] = ["erg", "txs", "tokens", "last", "first", "address"];

function pathFor(
  offset: number,
  sort: AddressListSort,
  dir: AddressListDir,
  height?: number | null,
  bands: readonly HolderBandId[] = [],
  kinds: readonly ListEntityId[] = [],
  limit = ADDRESS_PACK
): string {
  const q = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    sort,
    dir,
  });
  const bandQ = joinAddressListFilter(bands);
  const kindQ = joinAddressListFilter(kinds);
  if (bandQ) q.set("band", bandQ);
  if (kindQ) q.set("kind", kindQ);
  return snapshotPath(`/v1/page/addresses?${q.toString()}`, height);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function serverHonors(
  j: AddressesPageData,
  want: number,
  sort: AddressListSort,
  dir: AddressListDir,
  bands: readonly HolderBandId[],
  kinds: readonly ListEntityId[]
): boolean {
  if (typeof j.offset !== "number") return false;
  if (j.sort != null && (j.sort !== sort || j.dir !== dir)) return false;
  if (j.sort == null && (sort !== "erg" || dir !== "desc")) return false;
  if (!sameSet(parseAddressListBands(j.band), bands)) return false;
  if (!sameSet(parseAddressListKinds(j.kind), kinds)) return false;
  if (!j.items.length) return true;
  return (j.items[0]?.rank ?? 0) === want + 1;
}

function writeFilterQuery(bands: readonly HolderBandId[], kinds: readonly ListEntityId[]) {
  if (typeof window === "undefined") return;
  const u = new URL(window.location.href);
  u.searchParams.delete("band");
  u.searchParams.delete("kind");
  const bandQ = joinAddressListFilter(bands);
  const kindQ = joinAddressListFilter(kinds);
  if (bandQ) u.searchParams.set("band", bandQ);
  if (kindQ) u.searchParams.set("kind", kindQ);
  const next = `${u.pathname}${u.search}${u.hash}`;
  const now = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== now) window.history.replaceState(window.history.state, "", next);
}

function toggleId<T>(list: readonly T[], id: T): T[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function nanoCmp(a: string, b: string): number {
  try {
    const na = BigInt(String(a).split(".")[0] || "0");
    const nb = BigInt(String(b).split(".")[0] || "0");
    if (na === nb) return 0;
    return na < nb ? -1 : 1;
  } catch {
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  }
}

function tsCmp(a: number | null | undefined, b: number | null | undefined, mul: number): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * mul;
}

function orderLocal(
  rows: AddressListItem[],
  sort: AddressListSort,
  dir: AddressListDir
): AddressListItem[] {
  const mul = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let c = 0;
    if (sort === "address") c = a.address.localeCompare(b.address) * mul;
    else if (sort === "tokens") c = (a.tokenCount - b.tokenCount) * mul;
    else if (sort === "txs") c = (a.txCount - b.txCount) * mul;
    else if (sort === "first") c = tsCmp(a.firstTs, b.firstTs, mul);
    else if (sort === "last") c = tsCmp(a.lastTs, b.lastTs, mul);
    else c = nanoCmp(a.nanoerg, b.nanoerg) * mul;
    return c || a.address.localeCompare(b.address);
  });
}

function seedFilter(initial: AddressesPageData): {
  bands: HolderBandId[];
  kinds: ListEntityId[];
} {
  return normalizeAddressListFilter(
    parseAddressListBands(initial.band),
    parseAddressListKinds(initial.kind)
  );
}

export function AddressesView({ initial }: { initial: AddressesPageData }) {
  const t = useT();
  const { locale } = useI18n();
  const loc = locale === "ru" ? "ru-RU" : "en-US";
  const { markSynced, tip } = usePageSync();
  const tipRef = useRef(tip);
  tipRef.current = tip;
  const seed = seedFilter(initial);
  const [items, setItems] = useState<AddressListItem[]>(initial.items);
  const [offset, setOffset] = useState(0);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(initial.items.length > 0);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<AddressListSort>("erg");
  const [dir, setDir] = useState<AddressListDir>("desc");
  const [selBands, setSelBands] = useState<HolderBandId[]>(seed.bands);
  const [selKinds, setSelKinds] = useState<ListEntityId[]>(seed.kinds);
  const [bands, setBands] = useState(initial.bands);
  const [paged, setPaged] = useState(typeof initial.offset === "number");
  const [windowMax, setWindowMax] = useState<number | null>(null);
  const [filterTotal, setFilterTotal] = useState<number | null>(initial.total ?? null);
  const seedIds = initial.items.map((row) => row.address);
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
  const bandRef = useRef(selBands);
  bandRef.current = selBands;
  const kindRef = useRef(selKinds);
  kindRef.current = selKinds;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const wideRef = useRef<{ key: string; items: AddressListItem[] } | null>(null);

  const applyRows = useCallback(
    (next: AddressListItem[], mode: "page" | "soft" = "soft") => {
      setItems((prev) => {
        enter.mark(
          mode === "page"
            ? next.map((row) => row.address)
            : enteringIds(
                prev.map((row) => ({ id: row.address })),
                next.map((row) => ({ id: row.address }))
              )
        );
        return next;
      });
      if (mode === "page" && next.length) packEnter.mark(["pack"]);
    },
    [enter.mark, packEnter.mark]
  );

  const loadRows = useCallback(
    (silent = false) => {
      if (!silent && itemsRef.current.length) setPending(true);
      const want = offsetRef.current;
      const sortNow = sortRef.current;
      const dirNow = dirRef.current;
      const bandNow = bandRef.current;
      const kindNow = kindRef.current;
      const gw = getGateway();
      const height = tipRef.current?.height;
      const filtered = bandNow.length > 0 || kindNow.length > 0;

      const mode = silent ? "soft" : "page";
      const take = (j: AddressesPageData) => {
        if (j.bands) setBands(j.bands);
        if (typeof j.total === "number") setFilterTotal(j.total);
        else setFilterTotal(null);
        setErr(null);
        markSynced(j.updatedAt);
      };

      void fetch(`${gw}${pathFor(want, sortNow, dirNow, height, bandNow, kindNow)}`, SNAPSHOT_FETCH)
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json() as Promise<AddressesPageData & { stale?: boolean }>;
        })
        .then(async (j) => {
          if (j.stale || !Array.isArray(j.items)) {
            setReady(true);
            return;
          }

          if (serverHonors(j, want, sortNow, dirNow, bandNow, kindNow)) {
            wideRef.current = null;
            setPaged(true);
            setWindowMax(null);
            if (!j.items.length && want > 0) {
              setOffset((o) => Math.max(0, o - ADDRESS_PACK));
              return;
            }
            applyRows(j.items, mode);
            take(j);
            setReady(true);
            return;
          }

          if (filtered) {
            setReady(true);
            return;
          }

          setPaged(false);
          const key = `${sortNow}:${dirNow}`;
          if (!wideRef.current || wideRef.current.key !== key) {
            const wr = await fetch(
              `${gw}${pathFor(0, sortNow, dirNow, height, [], [], 100)}`,
              SNAPSHOT_FETCH
            );
            if (!wr.ok) throw new Error(String(wr.status));
            const wj = (await wr.json()) as AddressesPageData & { stale?: boolean };
            if (wj.stale || !Array.isArray(wj.items)) {
              setReady(true);
              return;
            }
            const sorted =
              wj.sort === sortNow && wj.dir === dirNow ? wj.items : orderLocal(wj.items, sortNow, dirNow);
            wideRef.current = { key, items: sorted };
            take(wj);
          } else {
            take(j);
          }

          const all = wideRef.current.items;
          setWindowMax(all.length);
          const slice = all.slice(want, want + ADDRESS_PACK).map((row, i) => ({
            ...row,
            rank: want + i + 1,
          }));
          if (!slice.length && want > 0) {
            setOffset((o) => Math.max(0, o - ADDRESS_PACK));
            return;
          }
          applyRows(slice, mode);
          setReady(true);
        })
        .catch((e) => {
          if (!silent) setErr(String(e));
          setReady(true);
        })
        .finally(() => {
          if (!silent) setPending(false);
        });
    },
    [applyRows, markSynced]
  );

  const painted = useRef(false);
  useEffect(() => {
    if (painted.current) return;
    painted.current = true;
    if (initial.items.length) {
      markSynced(initial.updatedAt);
      return;
    }
    loadRows();
  }, [initial, loadRows, markSynced]);

  useEffect(() => {
    if (opened.current) return;
    if (!ready && !items.length) return;
    opened.current = true;
    const ids = items.map((row) => row.address);
    enter.mark(ids);
    if (ids.length) packEnter.mark(["pack"]);
    setListReady(true);
  }, [ready, items, enter.mark, packEnter.mark]);

  useChainTipRefresh(true, () => {
    wideRef.current = null;
    loadRows(true);
  });

  const loadRef = useRef(loadRows);
  loadRef.current = loadRows;
  const packKey = `${offset}:${sort}:${dir}:${selBands.join(",")}:${selKinds.join(",")}`;
  const packSeen = useRef(packKey);
  useEffect(() => {
    if (packSeen.current === packKey) return;
    packSeen.current = packKey;
    loadRef.current();
  }, [packKey]);

  useEffect(() => {
    writeFilterQuery(selBands, selKinds);
  }, [selBands, selKinds]);

  const catalogN = bandCount(bands?.all);
  const mixed = selBands.length > 0 && selKinds.length > 0;
  const layerN = mixed
    ? 0
    : selBands.length
      ? selBands.reduce(
          (n, id) => n + (mergeBands(bands?.all).find((row) => row.id === id)?.n ?? 0),
          0
        )
      : selKinds.length
        ? selKinds.reduce(
            (n, id) => n + (mergeKinds(bands?.kinds).find((row) => row.id === id)?.n ?? 0),
            0
          )
        : catalogN;
  const packTotal = paged
    ? mixed
      ? null
      : filterTotal != null
        ? filterTotal
        : layerN > 0
          ? layerN
          : null
    : windowMax;
  const { ids: favIds, toggle: toggleFav } = useFavoriteAddresses();
  const favReady = favIds != null;
  const favSet = useMemo(() => new Set(favIds ?? []), [favIds]);
  const filtered = selBands.length > 0 || selKinds.length > 0;
  const allOn = !filtered;

  const onSort = (key: AddressListSort) => {
    setOffset(0);
    if (sort === key) {
      setDir((d) => (d === "desc" ? "asc" : "desc"));
      return;
    }
    setSort(key);
    setDir(key === "address" ? "asc" : "desc");
  };

  // Kayolo answers a filter once its rows are in (a look and a nod, or a tilt at an empty list).
  const told = () => say({ k: "ui:filter", el: document.activeElement });

  const onBand = (id: HolderBandId) => {
    told();
    setOffset(0);
    const next = normalizeAddressListFilter(parseAddressListBands(toggleId(selBands, id)), selKinds);
    setSelBands(next.bands);
    setSelKinds(next.kinds);
  };

  const onKind = (id: ListEntityId) => {
    told();
    setOffset(0);
    const next = normalizeAddressListFilter(selBands, parseAddressListKinds(toggleId(selKinds, id)));
    setSelBands(next.bands);
    setSelKinds(next.kinds);
  };

  const onAll = () => {
    told();
    setOffset(0);
    setSelBands([]);
    setSelKinds([]);
  };

  const packHint = allOn
    ? t("addresses.packHint")
    : selBands.length === 1 && selKinds.length === 0
      ? t("addresses.packHintBand").replace("{name}", t(`addresses.band.${selBands[0]}`))
      : selKinds.length === 1 && selBands.length === 0
        ? t("addresses.packHintKind").replace("{name}", t(`addresses.pip.${selKinds[0]}`))
        : t("addresses.packHintSet");

  const emptyCopy =
    filtered && ready && !pending ? t("addresses.filterEmpty") : t("addresses.warming");

  return (
    <Shell>
      <KpiChipRail className="addr-drop grid grid-cols-2 items-stretch gap-2 sm:grid-cols-5">
        <HolderBandStrip
          raw={bands?.all}
          t={t}
          loc={loc}
          selected={selBands}
          onSelect={onBand}
          enterFrom={0}
        />
        <AddressKindKey
          raw={bands?.kinds}
          t={t}
          loc={loc}
          allN={catalogN}
          allSelected={allOn}
          selected={selKinds}
          onAll={onAll}
          onSelect={onKind}
          enterFrom={HOLDER_BAND_IDS.length}
        />
      </KpiChipRail>

      {err && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-200">
          {err}
        </p>
      )}

      {!listReady && !err ? null : !items.length && !err ? (
        <Feed>
          <FeedEmpty k="addr" title={emptyCopy} />
        </Feed>
      ) : null}

      {listReady && items.length > 0 && (
        <div className="feed-sheet">
          <Feed busy={pending} className="is-rank" enterClass={packEnter.enterClass("pack")}>
            <FeedBoard
              plate={
                <FeedPlate
                  tag={t("addresses.title")}
                  now
                  count={packTotal != null ? <FeedCount k="feed.addresses" n={packTotal} /> : undefined}
                  end={
                    <FeedSort
                      label={t("feed.sort.label")}
                      options={ADDRESS_SORTS.map((key) => ({ key, label: t(`feed.sort.${key}`) }))}
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
                <FeedAddressRow
                  key={row.address}
                  row={row}
                  rank={row.rank || offset + i + 1}
                  sort={sort}
                  enterClass={enter.enterClass(row.address)}
                  fav={{ on: favSet.has(row.address), ready: favReady, toggle: toggleFav }}
                />
              ))}
            </FeedBoard>
          </Feed>

          <RankWindow
            offset={offset}
            pageSize={ADDRESS_PACK}
            shown={items.length}
            total={packTotal}
            loc={loc}
            ofLabel={t("addresses.packOf")}
            prevLabel={t("addresses.packPrev")}
            nextLabel={t("addresses.packNext")}
            tapeLabel={t("addresses.packTape")}
            hint={packHint}
            disabled={pending}
            onOffset={setOffset}
          />
        </div>
      )}
    </Shell>
  );
}
