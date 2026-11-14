"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { NftCard, NftThumb } from "@/components/NftCard";
import { RankWindow } from "@/components/RankWindow";
import { Feed, FeedCount, FeedEmpty, FeedPlate } from "@/components/feed/Feed";
import { Shell } from "@/components/Shell";
import { getGateway } from "@/lib/config";
import { shortId } from "@/lib/format";
import { describeParty } from "@/lib/address-labels";
import { INK_TEXT } from "@/lib/palette";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { SNAPSHOT_FETCH, enteringIds, useEnterIds } from "@/lib/keyed-enter";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";
import { NFT_PACK, type NftCardSnap } from "@/lib/list-snapshots";
import { ERGODEX_V3_GROUP_SLUG } from "@ergoscan/shared";

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function parseCards(raw: unknown): NftCardSnap[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((it): it is NftCardSnap => {
    return !!it && typeof it === "object" && typeof (it as { tokenId?: string }).tokenId === "string";
  });
}

export function NftBrowseView({
  kind,
  title,
  slug,
  address,
  initialItems,
  initialTotal,
  initialReady,
  coverUrl,
  hintKey,
}: {
  kind: "series" | "issuer";
  title: string;
  slug?: string;
  address?: string;
  initialItems: NftCardSnap[];
  initialTotal: number;
  initialReady: boolean;
  coverUrl?: string | null;
  hintKey: string;
}) {
  const t = useT();
  const { locale } = useI18n();
  const { markSynced } = usePageSync();
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [ready, setReady] = useState(initialReady);
  const [name, setName] = useState(title);
  const [offset, setOffset] = useState(0);
  const [pending, setPending] = useState(false);
  const enter = useEnterIds();
  const opened = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  const path =
    kind === "series"
      ? `/v1/nfts/collections/${encodeURIComponent(slug ?? "")}`
      : `/v1/nfts/issuers/${encodeURIComponent(address ?? "")}`;

  const load = useCallback(
    (silent = false) => {
      if (!silent && itemsRef.current.length) setPending(true);
      const off = offsetRef.current;
      void fetch(`${getGateway()}${path}?limit=${NFT_PACK}&offset=${off}`, SNAPSHOT_FETCH)
        .then(async (r) => (r.ok ? r.json() : null))
        .then((j: { items?: unknown; total?: number; count?: number; name?: string; ready?: boolean } | null) => {
          if (!j || j.ready === false) {
            setReady(false);
            markSynced();
            return;
          }
          setReady(true);
          const next = parseCards(j.items);
          setItems((prev) => {
            enter.mark(
              enteringIds(
                prev.map((r) => ({ id: r.tokenId })),
                next.map((r) => ({ id: r.tokenId }))
              )
            );
            return next;
          });
          const n = typeof j.total === "number" ? j.total : typeof j.count === "number" ? j.count : next.length;
          setTotal(n);
          if (typeof j.name === "string" && j.name) setName(j.name);
          markSynced();
        })
        .catch(() => {
          /* keep painted */
        })
        .finally(() => {
          if (!silent) setPending(false);
        });
    },
    [enter.mark, markSynced, path]
  );

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (initialItems.length || initialReady) markSynced();
  }, [initialItems.length, initialReady, markSynced]);

  const loadRef = useRef(load);
  loadRef.current = load;
  const offSeen = useRef(offset);
  useEffect(() => {
    if (offSeen.current === offset) return;
    offSeen.current = offset;
    loadRef.current();
  }, [offset]);

  useKeepFresh(() => load(true));

  const party = address ? describeParty(address) : null;
  // «ErgoDex V3 positions»: grouped by contract, not by name.
  const v3 = kind === "series" && slug === ERGODEX_V3_GROUP_SLUG;
  const shownName = v3 ? t("nfts.group.ergodexV3") : name;

  return (
    <Shell>
      <Breadcrumbs
        items={[
          { href: "/nfts", label: t("nav.nfts") },
          ...(kind === "series"
            ? [{ href: "/nfts#series", label: t("nfts.tab.series") }]
            : []),
          { label: shownName },
        ]}
      />

      <div className="mb-6 flex min-w-0 items-center gap-4">
        <span className="addr-nft-thumb h-16 w-16 shrink-0 overflow-hidden rounded-[16px]">
          <NftThumb
            url={coverUrl ?? items.find((i) => i.artworkUrl)?.artworkUrl}
            tokenId={items.find((i) => i.tokenId)?.tokenId ?? name}
          />
        </span>
        <div className="min-w-0">
          <p className="text-[12px] text-[var(--muted)]">
            {kind === "series" ? t("nfts.collection.eyebrow") : t("nfts.issuer.eyebrow")}
          </p>
          <h1
            className="truncate text-[22px] font-semibold tracking-tight"
            style={{ color: INK_TEXT.coral }}
          >
            {shownName}
          </h1>
          {address ? (
            <p className="mt-1 truncate font-mono text-[12px] text-accent">
              <Link prefetch={false} href={`/address/${encodeURIComponent(address)}`} className="hover:underline">
                {party?.known ? `${party.known} · ${shortId(address, 8)}` : shortId(address, 10)}
              </Link>
            </p>
          ) : null}
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            {t(
              v3 ? "nfts.group.ergodexV3Count" : kind === "series" ? "nfts.collection.count" : "nfts.issuer.count"
            ).replace("{n}", String(total))}
          </p>
          <p className="mt-1 text-[12px] text-[var(--muted-2)]">{t(v3 ? "nfts.group.ergodexV3Hint" : hintKey)}</p>
        </div>
      </div>

      <div className="feed-sheet">
        <Feed busy={pending && items.length > 0}>
          {!items.length ? (
            <FeedEmpty
              k="nft"
              plate={<FeedPlate tag={shownName} />}
              title={
                !ready ? t("nfts.readyPreview") : kind === "series" ? t("nfts.empty.series") : t("nfts.empty.issuers")
              }
            />
          ) : (
            <section className="feed-day feed-gallery">
              <FeedPlate
                tag={kind === "series" ? t("nfts.tab.series") : t("nfts.issuer.eyebrow")}
                count={<FeedCount k="feed.nfts" n={total > 0 ? total : items.length} />}
              />
              <div className="addr-nft-grid">
                {items.map((row) => (
                  <NftCard
                    key={row.tokenId}
                    item={{
                      tokenId: row.tokenId,
                      name: row.name,
                      artworkUrl: row.artworkUrl,
                      ...(row.lp?.kind === "cl-key"
                        ? { collection: null, kind: "lp", kindLabel: t("nfts.kind.lp"), meta: row.lp.pair }
                        : {
                            collection: row.collection,
                            kind: row.kind,
                            kindLabel: row.kind ? t(`nfts.kind.${row.kind}`) : null,
                          }),
                    }}
                    enterClass={enter.enterClass(row.tokenId)}
                  />
                ))}
              </div>
            </section>
          )}
        </Feed>
        {ready ? (
          <RankWindow
            offset={offset}
            pageSize={NFT_PACK}
            shown={items.length}
            total={total > 0 ? total : null}
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
