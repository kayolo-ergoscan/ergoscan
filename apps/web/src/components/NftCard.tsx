"use client";

import Link from "next/link";
import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { KpiMark } from "@/components/kpi-marks";
import { shortId } from "@/lib/format";
import { tokenIdenticonSrc } from "@/lib/token-identicon";
import { useMediaSrc } from "@/lib/use-media-src";

export type NftCardItem = {
  tokenId: string;
  name?: string | null;
  collection?: string | null;
  artworkUrl?: string | null;
  kind?: string | null;
  kindLabel?: string | null;
  meta?: string | null;
};

export function NftThumb({
  url,
  tokenId,
  className,
}: {
  url?: string | null;
  tokenId?: string | null;
  className?: string;
}) {
  const { src, onError } = useMediaSrc(url, "image");
  const missing = !String(url || "").trim();
  const art = useRef<HTMLImageElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    const img = art.current;
    if (img?.complete && img.naturalWidth > 0) setReady(true);
  }, [src]);
  if ((missing || !src) && tokenId) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={tokenIdenticonSrc(tokenId)}
        alt=""
        className={clsx("h-full w-full object-cover", className)}
      />
    );
  }
  if (!src) {
    return (
      <span
        className={clsx(
          "flex h-full w-full items-center justify-center text-white/25",
          className
        )}
      >
        <KpiMark id="nft" className="h-10 w-10" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={art}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={className}
      data-ready={ready ? "" : undefined}
      onLoad={() => setReady(true)}
      onError={onError}
    />
  );
}

export function NftCard({
  item,
  href,
  enterClass,
  sheetEnter,
}: {
  item: NftCardItem;
  href?: string;
  enterClass?: string;
  /** First-open page cascade. Later visits use enterClass. */
  sheetEnter?: number;
}) {
  const to = href ?? `/token/${item.tokenId}`;
  const titleName = item.name && !item.name.includes("\uFFFD") ? item.name : null;
  const title = titleName ? `${titleName} · ${item.tokenId}` : item.tokenId;
  const showColl = !!(item.collection && titleName && item.collection !== titleName);
  const badge = item.kind && item.kind !== "image" ? item.kindLabel : null;
  return (
    <Link
      prefetch={false}
      href={to}
      title={title}
      className={clsx("addr-nft-card chip-press", sheetEnter != null && "home-tile-enter", enterClass)}
      style={sheetEnter != null ? { ["--enter" as string]: sheetEnter } : undefined}
    >
      <span className="addr-nft-thumb relative">
        <NftThumb url={item.artworkUrl} tokenId={item.tokenId} />
      </span>
      <span className="nft-cap" data-k="nft">
        <span className={clsx("nft-cap-name", !titleName && "font-mono tabular-nums")}>
          {titleName || shortId(item.tokenId, 8)}
        </span>
        <span className="nft-cap-facts">
          <span className="feed-kind">{badge || "NFT"}</span>
          {showColl ? (
            <span>{item.collection}</span>
          ) : item.meta ? (
            <span>{item.meta}</span>
          ) : (
            <span className="font-mono tabular-nums">{shortId(item.tokenId, 4)}</span>
          )}
        </span>
      </span>
    </Link>
  );
}

export function NftGroupCard({
  href,
  name,
  coverUrl,
  count,
  hint,
  enterClass,
  sheetEnter,
}: {
  href: string;
  name: string;
  coverUrl?: string | null;
  count: number;
  hint?: string | null;
  enterClass?: string;
  sheetEnter?: number;
}) {
  return (
    <Link
      prefetch={false}
      href={href}
      className={clsx("addr-nft-card chip-press", sheetEnter != null && "home-tile-enter", enterClass)}
      style={sheetEnter != null ? { ["--enter" as string]: sheetEnter } : undefined}
    >
      <span className="addr-nft-thumb">
        <NftThumb url={coverUrl} tokenId={href} />
      </span>
      <span className="nft-cap" data-k="nft">
        <span className="nft-cap-name">{name}</span>
        <span className="nft-cap-facts">
          <span className="feed-kind tabular-nums">{count.toLocaleString()}</span>
          {hint ? <span>{hint}</span> : null}
        </span>
      </span>
    </Link>
  );
}
