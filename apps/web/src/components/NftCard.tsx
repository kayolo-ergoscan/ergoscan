"use client";

import Link from "next/link";
import clsx from "clsx";
import { KpiMarkNft } from "@/components/kpi-marks";
import { shortId } from "@/lib/format";
import { tokenIdenticonSrc } from "@/lib/token-identicon";
import { useMediaSrc } from "@/lib/use-media-src";
import { tokenTickerInk } from "@/lib/token-meta";
import { INK } from "@/lib/palette";

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
  if (missing && tokenId) {
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
        <KpiMarkNft className="h-10 w-10" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={className}
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
      href={to}
      title={title}
      className={clsx("addr-nft-card chip-press", sheetEnter != null && "home-tile-enter", enterClass)}
      style={sheetEnter != null ? { ["--enter" as string]: sheetEnter } : undefined}
    >
      <span className="addr-nft-thumb relative">
        <NftThumb url={item.artworkUrl} tokenId={item.tokenId} />
        {badge ? (
          <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium leading-none text-white/90">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
        <span className="truncate text-[13px] font-medium" style={{ color: tokenTickerInk(item.tokenId) }}>
          {titleName || shortId(item.tokenId, 8)}
        </span>
        {showColl ? (
          <span className="truncate text-[12px] text-[var(--muted)]">{item.collection}</span>
        ) : item.meta ? (
          <span className="truncate text-[12px] text-[var(--muted)]">{item.meta}</span>
        ) : badge ? (
          <span className="truncate text-[12px] text-[var(--muted)]">{badge}</span>
        ) : null}
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
      href={href}
      className={clsx("addr-nft-card chip-press", sheetEnter != null && "home-tile-enter", enterClass)}
      style={sheetEnter != null ? { ["--enter" as string]: sheetEnter } : undefined}
    >
      <span className="addr-nft-thumb">
        <NftThumb url={coverUrl} tokenId={href} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
        <span className="truncate text-[13px] font-medium" style={{ color: INK.coral }}>
          {name}
        </span>
        {hint ? (
          <span className="truncate text-[12px] text-[var(--muted)]">{hint}</span>
        ) : null}
        <span className="tabular-nums text-[12px] text-accent">{count.toLocaleString()}</span>
      </span>
    </Link>
  );
}
