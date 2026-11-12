"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { mediaUrlFallbacks } from "@/lib/nft-art";
import { tokenIdenticonSrc } from "@/lib/token-identicon";
import { resolveTokenMeta, tokenLogoSrc } from "@/lib/token-meta";

type Size = "xs" | "sm" | "md";

const SIZE: Record<
  Size,
  { px: number; text: string; pad: string; gap: string }
> = {
  xs: { px: 16, text: "text-[11px]", pad: "px-1.5 py-0.5", gap: "gap-1" },
  sm: { px: 20, text: "text-[12px]", pad: "px-2 py-0.5", gap: "gap-1.5" },
  md: { px: 28, text: "text-[13px]", pad: "px-2.5 py-1", gap: "gap-2" },
};

/** File or identicon. No ring, no disc under the mark. */
function TokenMark({
  tokenId,
  src,
  size,
  className,
  onBroken,
}: {
  tokenId: string;
  src?: string | null;
  size: number | string;
  className?: string;
  onBroken?: () => void;
}) {
  const ident = useMemo(() => tokenIdenticonSrc(tokenId), [tokenId]);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [src, tokenId]);
  const href = !broken && src ? src : ident;
  const dim = typeof size === "number" ? { width: size, height: size } : undefined;
  return (
    <span
      className={clsx("inline-flex shrink-0 overflow-hidden", className)}
      style={{ ...dim, borderRadius: 4 }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={href}
        alt=""
        className="h-full w-full object-contain"
        loading={src ? "eager" : "lazy"}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => {
          if (src && !broken && onBroken) onBroken();
          else setBroken(true);
        }}
      />
    </span>
  );
}

/**
 * Token chip with local logo or identicon + human name.
 */
export function TokenBadge({
  tokenId,
  symbol,
  name,
  size = "sm",
  showName = false,
  link = true,
  className,
}: {
  tokenId?: string | null;
  symbol?: string | null;
  name?: string | null;
  size?: Size;
  showName?: boolean;
  link?: boolean;
  className?: string;
}) {
  const meta = useMemo(
    () => resolveTokenMeta(tokenId, symbol, name),
    [tokenId, symbol, name]
  );
  const s = SIZE[size];

  const inner = (
    <>
      <TokenMark tokenId={meta.tokenId} src={meta.logoUrl} size={s.px} />
      <span className={clsx("font-medium tracking-tight text-[var(--text)]", s.text)}>
        {meta.symbol}
      </span>
      {showName && meta.name !== meta.symbol && (
        <span className={clsx("hidden text-[var(--muted)] sm:inline", s.text)}>
          {meta.name}
        </span>
      )}
    </>
  );

  const cls = clsx(
    "inline-flex max-w-full items-center rounded-full border border-[var(--border)] bg-[var(--wash-faint)] transition-colors hover:border-[var(--border)] hover:bg-[var(--wash)]",
    s.pad,
    s.gap,
    className
  );

  if (!link || meta.isErg) {
    return (
      <span className={cls} title={meta.isErg ? "ERG" : meta.tokenId}>
        {inner}
      </span>
    );
  }

  return (
    <Link prefetch={false} href={`/token/${meta.tokenId}`} className={cls} title={meta.tokenId}>
      {inner}
    </Link>
  );
}

/** Catalog / tape mark: local file, then issuance art, then identicon. */
export function TokenLogo({
  tokenId,
  artworkUrl,
  size = 28,
}: {
  tokenId: string;
  artworkUrl?: string | null;
  size?: number;
}) {
  const id = tokenId.toLowerCase();
  const urls = useMemo(() => {
    const local = tokenLogoSrc(id);
    const art = mediaUrlFallbacks(artworkUrl, "image");
    if (local) return [local, ...art.filter((u) => u !== local)];
    return art;
  }, [artworkUrl, id]);
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
  }, [artworkUrl, id]);
  const src = urls[i] ?? null;

  return (
    <TokenMark
      tokenId={id}
      src={src}
      size={size}
      onBroken={() => setI((n) => n + 1)}
    />
  );
}

/** Compact avatar only (tables / rails) */
export function TokenAvatar({
  tokenId,
  symbol,
  size = 20,
}: {
  tokenId?: string | null;
  symbol?: string | null;
  size?: number;
}) {
  const meta = useMemo(() => resolveTokenMeta(tokenId, symbol), [tokenId, symbol]);
  return (
    <span title={meta.symbol} className="token-logo">
      <TokenMark tokenId={meta.tokenId} src={meta.logoUrl} size={size} />
    </span>
  );
}
