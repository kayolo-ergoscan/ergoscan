"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { TokenAvatar } from "@/components/TokenBadge";
import { PrettyUsd } from "@/components/PrettyNum";
import { getGateway } from "@/lib/config";
import { useT } from "@/lib/i18n/I18nProvider";
import { useKeepFresh } from "@/lib/page-sync";
import { parseSiteTape, type SiteMarket } from "@/lib/site-market";
import { tokenTickerInk } from "@/lib/token-meta";
import type { SpectrumTapeRow } from "@/lib/list-snapshots";

/** Header ERG/USD. The ticker and the price chip share one fetch. */
export const ErgUsdContext = createContext<number | null>(null);

const TAPE_MS = 90_000;

/**
 * One request for the header price and the ticker.
 * Nested shells pass enabled=false so a page does not fetch twice.
 */
export function useSiteMarket(enabled: boolean, initial?: SiteMarket | null) {
  const [usd, setUsd] = useState<number | null>(initial?.usd ?? null);
  const [rows, setRows] = useState<SpectrumTapeRow[]>(initial?.tape ?? []);
  const [fresh, setFresh] = useState(false);

  const load = useCallback(() => {
    if (!enabled) return;
    void fetch(`${getGateway()}/v1/prices/erg`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (!p || typeof p !== "object") return;
        const price = (p as { usd?: unknown }).usd;
        if (typeof price === "number" && price > 0) setUsd(price);
        const tape = parseSiteTape((p as { tape?: unknown }).tape);
        if (tape.length >= 2) {
          setRows(tape);
          setFresh(true);
        }
      })
      .catch(() => null);
  }, [enabled]);

  useKeepFresh(load);

  useEffect(() => {
    if (!enabled) return;
    load();
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      load();
    }, TAPE_MS);
    return () => window.clearInterval(id);
  }, [enabled, load]);

  return { usd, rows, fresh };
}

function fmtChange(n: number): string {
  const digits = Math.abs(n) >= 10 ? 1 : 2;
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function paintTape(prev: SpectrumTapeRow[], next: SpectrumTapeRow[]): SpectrumTapeRow[] {
  if (prev.length < 2) return next;
  const byId = new Map(next.map((row) => [row.tokenId, row]));
  let changed = false;
  const painted = prev.map((old) => {
    const row = byId.get(old.tokenId);
    if (!row) return old;
    if (row.priceUsd === old.priceUsd && row.changePct === old.changePct && row.symbol === old.symbol) {
      return old;
    }
    changed = true;
    return { ...old, symbol: row.symbol, priceUsd: row.priceUsd, changePct: row.changePct };
  });
  return changed ? painted : prev;
}

export function PriceTape({ rows, fresh }: { rows: SpectrumTapeRow[]; fresh: boolean }) {
  const t = useT();
  const pinned = useRef(false);
  const [shown, setShown] = useState<SpectrumTapeRow[]>(() => (rows.length >= 2 ? rows : []));

  useEffect(() => {
    if (rows.length < 2) return;
    if (fresh && !pinned.current) {
      pinned.current = true;
      setShown(rows);
      return;
    }
    if (!pinned.current) return;
    setShown((prev) => paintTape(prev, rows));
  }, [rows, fresh]);

  const track = shown.length < 2 ? [] : [...shown, ...shown];
  const seconds = Math.max(32, (shown.length || 18) * 2.8);

  return (
    <div className="price-tape-slot">
      <div className="price-tape" aria-label={t("spectrum.tape")}>
        <div className="price-tape-view">
          {track.length > 0 ? (
            <div
              className="price-tape-run"
              style={{ ["--tape-s" as string]: `${seconds}s` }}
            >
              {track.map((row, i) => {
                const copy = i >= shown.length;
                const up = (row.changePct ?? 0) > 0;
                const down = (row.changePct ?? 0) < 0;
                return (
                  <Link
                    key={copy ? `${row.tokenId}:b` : row.tokenId}
                    href={`/token/${row.tokenId}`}
                    className="price-tape-chip"
                    aria-hidden={copy || undefined}
                    tabIndex={copy ? -1 : undefined}
                  >
                    <TokenAvatar tokenId={row.tokenId} symbol={row.symbol} size={14} />
                    <span className="price-tape-sym" style={{ color: tokenTickerInk(row.tokenId) }}>
                      {row.symbol}
                    </span>
                    <span className="price-tape-px">
                      <PrettyUsd n={row.priceUsd} digits={row.priceUsd >= 1 ? 2 : 4} />
                    </span>
                    <span className={`price-tape-chg${up ? " is-up" : ""}${down ? " is-down" : ""}`}>
                      {row.changePct != null ? fmtChange(row.changePct) : ""}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function useErgUsd(): number | null {
  return useContext(ErgUsdContext);
}
