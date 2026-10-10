"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { AddrFactCard } from "@/components/AddrFactCard";
import { Shell } from "@/components/Shell";
import { KpiNum } from "@/components/KpiGrid";
import { CatalogSearchTile } from "@/components/CatalogSearchTile";
import { NftCard, NftGroupCard } from "@/components/NftCard";
import {
  KpiMarkCaseSensitive,
  KpiMarkFingerprint,
  KpiMarkGroup,
  KpiMarkPalette,
} from "@/components/kpi-marks";
import { RankWindow } from "@/components/RankWindow";
import { SegBar, segItem } from "@/components/SegBar";
import { getGateway } from "@/lib/config";
import { describeParty } from "@/lib/address-labels";
import { INK } from "@/lib/palette";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { readHashTab, setHashTab } from "@/lib/hash-tab";
import { SNAPSHOT_FETCH, enteringIds, snapshotPath, useEnterIds } from "@/lib/keyed-enter";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";
import {
  NFT_PACK,
  type NftCardSnap,
  type NftHomeSnap,
  type NftSeriesSnap,
} from "@/lib/list-snapshots";

const NFT_KIND_CHIPS = ["image", "audio", "video"] as const;

const NFT_NAV = ["catalog", "series", "feed"] as const;
const NFT_TABS = ["catalog", "series", "feed", "search"] as const;
type Tab = (typeof NFT_TABS)[number];

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function readNftTab(): Tab {
  const h =
    typeof window === "undefined" ? "catalog" : window.location.hash.replace(/^#/, "");
  if (h === "collections") return "series";
  if (h === "issuers") return "catalog";
  return readHashTab(NFT_TABS, "catalog");
}

function parseCards(raw: unknown): NftCardSnap[] {
  if (!Array.isArray(raw)) return [];
  const out: NftCardSnap[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const r = it as { tokenId?: string };
    if (typeof r.tokenId !== "string" || !r.tokenId) continue;
    out.push(it as NftCardSnap);
  }
  return out;
}

export function NftsView({ initial }: { initial: NftHomeSnap }) {
  const t = useT();
  const { locale } = useI18n();
  const { markSynced, tip } = usePageSync();
  const tipRef = useRef(tip);
  tipRef.current = tip;
  const [tab, setTab] = useState<Tab>("catalog");
  const [catalog, setCatalog] = useState(initial.catalog);
  const [catalogTotal, setCatalogTotal] = useState(initial.catalogTotal);
  const [filterTotal, setFilterTotal] = useState(initial.catalogTotal);
  const [named, setNamed] = useState(initial.named);
  const [withArt, setWithArt] = useState(initial.withArt);
  const [series, setSeries] = useState(initial.series);
  const [feed, setFeed] = useState(initial.feed);
  const [ready, setReady] = useState(initial.ready);
  const [kindReady, setKindReady] = useState(initial.kindReady);
  const [kind, setKind] = useState("");
  const [offset, setOffset] = useState(0);
  const [pending, setPending] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<NftCardSnap[]>([]);
  const [searchPending, setSearchPending] = useState(false);
  const enter = useEnterIds();
  const opened = useRef(false);
  /** Header tiles are 0–4. The grid continues the same cascade only on first paint. */
  const sheetRef = useRef(true);
  const [sheetOn, setSheetOn] = useState(true);
  const endSheet = useCallback(() => {
    if (!sheetRef.current) return;
    sheetRef.current = false;
    setSheetOn(false);
  }, []);
  const leaveSearchTo = useRef<(typeof NFT_NAV)[number]>("catalog");
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const miss = t("home.unavailable");
  const previewing = !ready;

  const applyCards = useCallback(
    (prev: NftCardSnap[], next: NftCardSnap[]) => {
      enter.mark(
        enteringIds(
          prev.map((r) => ({ id: r.tokenId })),
          next.map((r) => ({ id: r.tokenId }))
        )
      );
      return next;
    },
    [enter.mark]
  );

  const loadCatalog = useCallback(
    (silent = false) => {
      if (!silent && catalogRef.current.length) setPending(true);
      const off = offsetRef.current;
      const kindQ = kindRef.current ? `&kind=${encodeURIComponent(kindRef.current)}` : "";
      void fetch(
        `${getGateway()}${snapshotPath(`/v1/nfts/catalog?limit=${NFT_PACK}&offset=${off}${kindQ}`, tipRef.current?.height)}`,
        SNAPSHOT_FETCH
      )
        .then(async (r) => (r.ok ? r.json() : null))
        .then((j: {
          items?: unknown;
          total?: number;
          named?: number;
          withArt?: number;
          ready?: boolean;
          kind?: string | null;
          kindReady?: boolean;
        } | null) => {
          if (!j || j.ready === false) {
            setReady(false);
            markSynced();
            return;
          }
          if (kindRef.current && j.kind !== kindRef.current) {
            setKindReady(false);
            setFilterTotal(0);
            setCatalog([]);
            markSynced();
            return;
          }
          setReady(true);
          const next = parseCards(j.items);
          setCatalog((prev) => applyCards(prev, next));
          if (typeof j.total === "number") {
            setFilterTotal(j.total);
            if (!kindRef.current) setCatalogTotal(j.total);
          }
          if (!kindRef.current) {
            if (typeof j.named === "number") setNamed(j.named);
            if (typeof j.withArt === "number") setWithArt(j.withArt);
          }
          if (typeof j.kindReady === "boolean") setKindReady(j.kindReady);
          markSynced();
        })
        .catch(() => {
          /* keep painted */
        })
        .finally(() => {
          if (!silent) setPending(false);
        });
    },
    [applyCards, markSynced]
  );

  const seriesRef = useRef(series);
  seriesRef.current = series;
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const searchHitsRef = useRef(searchHits);
  searchHitsRef.current = searchHits;
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const markShown = useCallback(
    (next: Tab) => {
      const ids =
        next === "series"
          ? seriesRef.current.map((row) => row.slug)
          : next === "feed"
            ? feedRef.current.map((row) => row.tokenId)
            : next === "catalog"
              ? catalogRef.current.map((row) => row.tokenId)
              : searchHitsRef.current.map((row) => row.tokenId);
      enter.mark(ids);
    },
    [enter.mark]
  );

  const loadSides = useCallback(
    (silent = false) => {
      void Promise.all([
        fetch(`${getGateway()}/v1/nfts/collections?limit=${NFT_PACK}`, SNAPSHOT_FETCH).then(
          async (r) => (r.ok ? r.json() : null)
        ),
        fetch(`${getGateway()}/v1/nfts/recent?limit=${NFT_PACK}`, SNAPSHOT_FETCH).then(
          async (r) => (r.ok ? r.json() : null)
        ),
      ])
        .then(([coll, rec]) => {
          if (Array.isArray(coll?.collections)) {
            const next = coll.collections as NftSeriesSnap[];
            enter.mark(
              enteringIds(
                seriesRef.current.map((r) => ({ id: r.slug })),
                next.map((r) => ({ id: r.slug }))
              )
            );
            setSeries(next);
          }
          if (rec && rec.ready !== false) {
            setFeed((prev) => applyCards(prev, parseCards(rec.items)));
          }
          if (!silent) markSynced();
        })
        .catch(() => {
          /* keep painted */
        });
    },
    [applyCards, enter.mark, markSynced]
  );

  useEffect(() => {
    const first = readNftTab();
    if (first !== "catalog") setTab(first);
    const onHash = () => {
      const next = readNftTab();
      if (next === tabRef.current) return;
      endSheet();
      markShown(next);
      tabRef.current = next;
      setTab(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [endSheet, markShown]);

  useEffect(() => {
    const n = Math.max(catalogRef.current.length, 1);
    const last = 5 + n - 1;
    const id = window.setTimeout(endSheet, 75 + last * 25 + 420);
    return () => window.clearTimeout(id);
  }, [endSheet]);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (initial.catalog.length || initial.ready) markSynced();
  }, [initial.catalog.length, initial.ready, markSynced]);

  const loadCatalogRef = useRef(loadCatalog);
  loadCatalogRef.current = loadCatalog;
  const offSeen = useRef(offset);
  useEffect(() => {
    if (offSeen.current === offset) return;
    offSeen.current = offset;
    endSheet();
    loadCatalogRef.current();
  }, [offset]);

  useKeepFresh(() => {
    loadCatalog(true);
    loadSides(true);
  });

  useEffect(() => {
    if (tab !== "search") return;
    const q = searchQ.trim();
    if (q.length < 2) {
      setSearchHits([]);
      setSearchPending(false);
      return;
    }
    const ac = new AbortController();
    const had = searchHits.length > 0;
    const tmr = setTimeout(() => {
      if (had) setSearchPending(true);
      void fetch(
        `${getGateway()}/v1/nfts/search?q=${encodeURIComponent(q)}&limit=${NFT_PACK}`,
        { ...SNAPSHOT_FETCH, signal: ac.signal }
      )
        .then(async (r) => (r.ok ? r.json() : null))
        .then((d) => {
          const next = parseCards(d?.items);
          setSearchHits((prev) => applyCards(prev, next));
        })
        .catch(() => {
          /* abort */
        })
        .finally(() => setSearchPending(false));
    }, 280);
    return () => {
      clearTimeout(tmr);
      ac.abort();
    };
    // searchHits.length only gates dim — do not re-run the query when hits change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, searchQ, applyCards]);

  const onKind = (next: string) => {
    endSheet();
    if (tab !== "catalog") onTab("catalog");
    if (next === kindRef.current) return;
    kindRef.current = next;
    setKind(next);
    if (offset !== 0) {
      setOffset(0);
    } else {
      loadCatalog();
    }
  };

  const onTab = (next: Tab) => {
    if (next === tabRef.current) {
      setHashTab(next);
      return;
    }
    endSheet();
    markShown(next);
    tabRef.current = next;
    setTab(next);
    setHashTab(next);
  };

  const onSearchQ = (v: string) => {
    setSearchQ(v);
    const qq = v.trim();
    if (qq.length >= 2) {
      if (tab !== "search") {
        if (tab === "catalog" || tab === "series" || tab === "feed") {
          leaveSearchTo.current = tab;
        }
        onTab("search");
      }
      return;
    }
    if (tab === "search") onTab(leaveSearchTo.current);
  };

  const kpiValue = (n: number) => {
    if (previewing) return miss;
    return n.toLocaleString(loc(locale));
  };

  const painted =
    tab === "catalog"
      ? catalog
      : tab === "series"
        ? series
        : tab === "feed"
          ? feed
          : searchHits;
  const empty = painted.length === 0;
  const dim =
    (tab === "catalog" && pending && catalog.length > 0) ||
    (tab === "search" && searchPending && searchHits.length > 0);

  return (
    <Shell>
      <div className="mb-3 grid grid-cols-2 items-stretch gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <NftMini
          enter={0}
          label={t("nfts.kpiIndexed")}
          value={kpiValue(catalogTotal)}
          miss={previewing}
          sub={t("nfts.kpiIndexedSub")}
          ink={INK.gold}
          mark={<KpiMarkFingerprint className="h-9 w-9" />}
          selected={tab === "catalog" && !kind}
          onSelect={() => onKind("")}
        />
        <NftMini
          enter={1}
          label={t("nfts.kpiNamed")}
          value={kpiValue(named)}
          miss={previewing}
          sub={t("nfts.kpiNamedSub")}
          ink={INK.violet}
          mark={<KpiMarkCaseSensitive className="h-9 w-9" />}
        />
        <CatalogSearchTile
          enter={2}
          className="max-lg:hidden"
          q={searchQ}
          onQ={onSearchQ}
          searchLabel={t("nfts.tab.search")}
          placeholder={t("nfts.search.placeholder")}
        />
        <NftMini
          enter={3}
          label={t("nfts.kpiArt")}
          value={kpiValue(withArt)}
          miss={previewing}
          sub={t("nfts.kpiArtSub")}
          ink={INK.cyan}
          mark={<KpiMarkPalette className="h-9 w-9" />}
        />
        <NftMini
          enter={4}
          label={t("nfts.kpiSeries")}
          value={kpiValue(series.length)}
          miss={previewing}
          sub={t("nfts.kpiSeriesSub")}
          ink={INK.gold}
          mark={<KpiMarkGroup className="h-9 w-9" />}
          selected={tab === "series"}
          onSelect={() => onTab("series")}
        />
      </div>

      <SegBar cols={3} className={tab === "catalog" || tab === "search" ? "mb-2" : "mb-3"}>
        {NFT_NAV.map((idTab) => (
          <a
            key={idTab}
            href={`#${idTab}`}
            onClick={(e) => {
              e.preventDefault();
              onTab(idTab);
            }}
            className={segItem(tab === idTab)}
          >
            {t(`nfts.tab.${idTab}`)}
          </a>
        ))}
      </SegBar>
      {tab === "catalog" || tab === "search" ? (
        <SegBar cols={4} className="mb-3">
          <button
            type="button"
            onClick={() => onKind("")}
            className={segItem(!kind)}
          >
            {t("nfts.kind.all")}
          </button>
          {NFT_KIND_CHIPS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onKind(id)}
              className={segItem(kind === id)}
            >
              {t(`nfts.kind.${id}`)}
            </button>
          ))}
        </SegBar>
      ) : null}

      <div className="addr-sheet">
        {empty && !previewing ? (
          <p className="mb-3 text-[var(--muted)]">
            {tab === "catalog"
              ? kind
                ? kindReady
                  ? t("nfts.empty.kind")
                  : t("nfts.kindWarm")
                : t("nfts.empty.catalog")
              : tab === "series"
                ? t("nfts.empty.series")
                : tab === "feed"
                    ? t("nfts.empty.feed")
                    : searchQ.trim().length >= 2
                      ? t("nfts.search.empty")
                      : t("nfts.empty.catalog")}
          </p>
        ) : null}
        {previewing && empty ? (
          <p className="mb-3 text-[var(--muted)]">{t("nfts.readyPreview")}</p>
        ) : null}

        <div
          className={clsx(
            "transition-opacity duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
            dim && "opacity-60"
          )}
        >
          {tab === "series" ? (
            <div className="addr-nft-grid">
              {series.map((c, i) => (
                <NftGroupCard
                  key={c.slug}
                  href={`/nfts/collection/${encodeURIComponent(c.slug)}`}
                  name={c.name}
                  coverUrl={c.coverUrl}
                  count={c.count}
                  hint={null}
                  sheetEnter={sheetOn ? 5 + i : undefined}
                  enterClass={sheetOn ? undefined : enter.enterClass(c.slug)}
                />
              ))}
            </div>
          ) : (
            <div className="addr-nft-grid">
              {(tab === "catalog" ? catalog : tab === "feed" ? feed : searchHits).map((row, i) => (
                <NftCard
                  key={row.tokenId}
                  sheetEnter={sheetOn ? 5 + i : undefined}
                  enterClass={sheetOn ? undefined : enter.enterClass(row.tokenId)}
                  item={{
                    tokenId: row.tokenId,
                    name: row.name,
                    collection: row.collection,
                    artworkUrl: row.artworkUrl,
                    kind: row.kind,
                    kindLabel: row.kind ? t(`nfts.kind.${row.kind}`) : null,
                    meta:
                      tab === "feed" && row.confirmed === false
                        ? t("nfts.mempool")
                        : row.issuerAddress
                          ? describeParty(row.issuerAddress).known ||
                            describeParty(row.issuerAddress).short
                          : null,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {tab === "catalog" && !previewing ? (
          <RankWindow
            offset={offset}
            pageSize={NFT_PACK}
            shown={catalog.length}
            total={(kind ? filterTotal : catalogTotal) > 0 ? (kind ? filterTotal : catalogTotal) : null}
            loc={loc(locale)}
            ofLabel={t("addresses.packOf")}
            prevLabel={t("addresses.packPrev")}
            nextLabel={t("addresses.packNext")}
            tapeLabel={t("nfts.packTape")}
            hint={t("nfts.packHint")}
            disabled={pending}
            onOffset={setOffset}
          />
        ) : null}
      </div>
    </Shell>
  );
}

function NftMini({
  enter,
  label,
  value,
  miss,
  sub,
  ink,
  mark,
  selected,
  onSelect,
}: {
  enter: number;
  label: string;
  value: string;
  miss: boolean;
  sub: string;
  ink: string;
  mark: ReactNode;
  selected?: boolean;
  onSelect?: () => void;
}) {
  return (
    <AddrFactCard
      enter={enter}
      className="kpi-tile--dense h-full"
      label={label}
      ink={ink}
      mark={mark}
      selected={selected}
      onSelect={onSelect}
    >
      <p
        className={clsx(
          "mt-0.5 text-[17px] font-semibold leading-[1.15] tabular-nums tracking-tight",
          miss && "text-[var(--muted)]"
        )}
      >
        <KpiNum>{value}</KpiNum>
      </p>
      <p className="mt-0.5 truncate text-[12px] leading-[1.15] text-[var(--muted-2)]">{sub}</p>
    </AddrFactCard>
  );
}

