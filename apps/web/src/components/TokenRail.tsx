"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getGateway } from "@/lib/config";
import { resolveTokenMeta } from "@/lib/token-meta";
import { TokenAvatar } from "./TokenBadge";

type Heat = {
  tokenId: string;
  symbol?: string;
  name?: string;
  volumeErg?: number;
  priceUsd?: number;
};

/**
 * Soft ticker under header — names + logos from live ranks (fail-open empty).
 */
export function TokenRail() {
  const [items, setItems] = useState<Heat[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`${getGateway()}/v1/defi/ranks`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const flow = (d.flow || d.traded || []) as Heat[];
        if (Array.isArray(flow) && flow.length) {
          setItems(
            flow.slice(0, 14).filter((t) => t.tokenId && t.tokenId.length > 20)
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!items.length) return null;

  return (
    <div className="border-b border-[var(--border-soft)] bg-black/20">
      <div className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-3 py-1.5 scrollbar-none sm:px-4 md:px-6">
        <span className="mr-1 shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-2)]">
          Flow
        </span>
        {items.map((t) => {
          const meta = resolveTokenMeta(t.tokenId, t.symbol, t.name);
          const vol =
            t.volumeErg != null && t.volumeErg > 0
              ? t.volumeErg >= 1000
                ? `${(t.volumeErg / 1000).toFixed(1)}k`
                : t.volumeErg.toFixed(0)
              : null;
          return (
            <Link
              prefetch={false}
              key={t.tokenId}
              href={`/token/${t.tokenId}`}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-soft)] bg-[var(--wash-faint)] px-2 py-1 transition hover:border-[var(--border)] hover:bg-[var(--wash)]"
            >
              <TokenAvatar tokenId={t.tokenId} symbol={meta.symbol} size={16} />
              <span className="text-[11px] font-medium text-[#f5f5f7]">
                {meta.symbol}
              </span>
              {vol != null && (
                <span className="text-[10px] tabular-nums text-[var(--muted)]">
                  {vol} Σ
                </span>
              )}
            </Link>
          );
        })}
        <Link
          prefetch={false}
          href="/defi/spectrum"
          className="ml-1 shrink-0 text-[10px] font-medium text-accent/90 hover:text-accent"
        >
          DeFi →
        </Link>
      </div>
    </div>
  );
}
