"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { AddressPip } from "@/components/AddressPip";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { NameMarquee } from "@/components/NameMarquee";
import { prefetchAddressPage } from "@/lib/address-page-cache";
import { listPip } from "@/lib/address-pips";
import {
  formatEmissionGlance,
  formatErgFixed,
  formatFactWhen,
  formatRelTime,
  relAgeTone,
  relAgeToneClass,
  shortId,
  toBigIntAmt,
} from "@/lib/format";

export type AddressTapeData = {
  address: string;
  nanoerg: string | null;
  tokenCount: number | null;
  txCount: number | null;
  firstTs: number | null;
  lastTs: number | null;
  firstTxId?: string | null;
  lastTxId?: string | null;
};

export function AddressTapeNameHead({ label }: { label: string }) {
  return (
    <div className="flex h-full min-w-0 items-center">
      <span className="whitespace-nowrap text-[12px] font-medium leading-none text-[var(--muted)]">
        {label}
      </span>
    </div>
  );
}

export function AddressTapeHead({
  stuck,
  address,
  name,
  erg,
  tokens,
  txs,
  first,
  last,
}: {
  stuck: boolean;
  address: string;
  name: string;
  erg: string;
  tokens: string;
  txs: string;
  first: string;
  last: string;
}) {
  return (
    <div
      className={clsx(
        "addr-head addr-lane addr-lane-x block-tx-pairs addr-list text-[12px] font-medium",
        stuck && "is-stuck"
      )}
    >
      <div className="block-lane-pair">
        <AddressTapeNameHead label={address} />
        <div className="min-w-0" aria-hidden />
      </div>
      <div className="block-lane-pair">
        <AddressTapeNameHead label={name} />
        <div className="flex h-full min-w-0 items-center justify-end">
          <span className="whitespace-nowrap text-[12px] font-medium leading-none text-[var(--muted)]">
            {txs}
          </span>
        </div>
      </div>
      <div className="block-lane-pair">
        <AddressTapeNameHead label={tokens} />
        <div className="flex h-full min-w-0 items-center justify-end">
          <span className="whitespace-nowrap text-[12px] font-medium leading-none text-[var(--muted)]">
            {erg}
          </span>
        </div>
      </div>
      <div className="block-lane-pair">
        <div className="min-w-0" aria-hidden />
        <div className="flex h-full min-w-0 items-center justify-end">
          <span className="whitespace-nowrap text-[12px] font-medium leading-none text-[var(--muted)]">
            {first}
          </span>
        </div>
      </div>
      <div className="block-lane-pair">
        <div className="min-w-0" aria-hidden />
        <div className="flex h-full min-w-0 items-center justify-end">
          <span className="whitespace-nowrap text-[12px] font-medium leading-none text-[var(--muted)]">
            {last}
          </span>
        </div>
      </div>
    </div>
  );
}

export function AddressActivityWhen({
  ts,
  txId,
  locale,
  align,
  openLabel,
  copyLabel,
  copiedLabel,
}: {
  ts: number | null | undefined;
  txId?: string | null;
  locale: string;
  align: "left" | "right";
  openLabel: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const rel = formatRelTime(ts);
  const stamp = formatFactWhen(ts, locale);
  const tone = relAgeTone(ts);
  const href = txId ? `/tx/${encodeURIComponent(txId)}` : null;
  const empty = rel === "—" && stamp === "—";
  const when = (
    <>
      <p className={clsx("whitespace-nowrap tabular-nums", relAgeToneClass(tone))}>{rel}</p>
      <p className="mt-0.5 whitespace-nowrap text-[12px] tabular-nums text-[var(--muted-2)]">
        {stamp}
      </p>
    </>
  );

  return (
    <div
      className={clsx(
        "group/act relative px-3",
        align === "right" ? "flex flex-col items-end text-right" : "flex flex-col items-start"
      )}
    >
      {empty ? (
        <span className="text-[var(--muted)]">—</span>
      ) : href ? (
        <Link
          prefetch={false}
          href={href}
          aria-label={`${openLabel} · ${rel} · ${stamp}`}
          className="block whitespace-nowrap"
        >
          {when}
        </Link>
      ) : (
        <div className="whitespace-nowrap">{when}</div>
      )}
      {href && txId ? (
        <div
          data-align={align}
          role="tooltip"
          className={clsx(
            "addr-act-chip pointer-events-none absolute bottom-[calc(100%+8px)] z-40 flex items-start gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--module)] px-2.5 py-2 opacity-0 shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-opacity duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
            "group-hover/act:pointer-events-auto group-hover/act:opacity-100 group-focus-within/act:pointer-events-auto group-focus-within/act:opacity-100",
            align === "right" ? "right-0" : "left-0"
          )}
        >
            <Link
              prefetch={false}
              href={href}
              className="max-w-[14.5rem] break-all text-left font-mono text-[11px] leading-snug text-[var(--accent)]"
            >
              {txId}
            </Link>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void navigator.clipboard?.writeText(txId).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1200);
                });
              }}
              aria-label={copied ? copiedLabel : copyLabel}
              className="chip-press mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-[6px] text-[var(--muted)] transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--wash)] hover:text-[var(--text)]"
            >
              {copied ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path
                    d="M2.4 6.2 4.8 8.6 9.6 3.4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <rect x="4" y="4" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
                  <path
                    d="M3 8.2V3.4A1.2 1.2 0 0 1 4.2 2.2H8"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </button>
          </div>
        ) : null}
    </div>
  );
}

export function AddressTapeRow({
  row,
  loc,
  t,
  enterClass,
  fav,
  favReady,
  onToggleFav,
}: {
  row: AddressTapeData;
  loc: string;
  t: (k: string) => string;
  enterClass?: string;
  fav: boolean;
  favReady: boolean;
  onToggleFav: (id: string) => void;
}) {
  const nano = row.nanoerg ?? "0";
  const pip = listPip(row.address, nano);
  const kindLabel = t(`addresses.pip.${pip.id}`);
  const aria = [shortId(row.address, 10), pip.name, pip.note, kindLabel]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      className={clsx(
        "addr-lane addr-lane-x block-tx-pairs addr-list relative z-0 border-t border-[var(--border-soft)] py-2.5 text-[13px] hover:z-30 focus-within:z-30",
        enterClass
      )}
      onPointerEnter={() => prefetchAddressPage(row.address)}
    >
      <div className="block-lane-pair">
        <div className="lane-id min-w-0 px-3">
          <div className="flex h-[18px] items-center gap-2">
            <AddressPip
              address={row.address}
              nanoerg={nano}
              kindLabel={kindLabel}
              kindGlyph
              className="h-[18px] w-[18px] shrink-0"
            />
            <Link
              prefetch={false}
              href={`/address/${encodeURIComponent(row.address)}`}
              aria-label={aria}
              className="min-w-0 whitespace-nowrap font-mono leading-none text-soft hover:underline lg:shrink-0"
              title={row.address}
              onFocus={() => prefetchAddressPage(row.address)}
            >
              <span className="lg:hidden">{shortId(row.address, 4)}</span>
              <span className="hidden lg:inline">{shortId(row.address, 10)}</span>
            </Link>
            <FavoriteHeart
              size="sm"
              on={fav}
              ready={favReady}
              title={fav ? t("favorites.remove") : t("favorites.add")}
              onToggle={() => onToggleFav(row.address)}
            />
          </div>
        </div>
      </div>
      <div className="block-lane-pair">
        <div className="flex min-w-0 items-center px-3">
          {pip.name ? (
            <NameMarquee text={pip.name} className="min-w-0 w-full text-[var(--text)]" />
          ) : null}
        </div>
        <div className="whitespace-nowrap px-3 text-right tabular-nums leading-none text-[var(--muted)]">
          {row.txCount != null ? row.txCount.toLocaleString(loc) : "—"}
        </div>
      </div>
      <div className="block-lane-pair">
        <div className="min-w-0 px-3 tabular-nums leading-none text-[var(--muted)]">
          {row.tokenCount != null ? row.tokenCount.toLocaleString(loc) : "—"}
        </div>
        <div
          className={clsx(
            "whitespace-nowrap px-3 text-right font-medium tabular-nums leading-none",
            row.nanoerg != null && "text-[var(--up)]"
          )}
        >
          {row.nanoerg != null ? formatErgFixed(row.nanoerg, loc) : "—"}
        </div>
      </div>
      <div className="block-lane-pair addr-act-pair">
        <div className="min-w-0" aria-hidden />
        <AddressActivityWhen
          ts={row.firstTs}
          txId={row.firstTxId}
          locale={loc}
          align="right"
          openLabel={t("addresses.openTx")}
          copyLabel={t("tx.copy")}
          copiedLabel={t("tx.copied")}
        />
      </div>
      <div className="block-lane-pair addr-act-pair">
        <div className="min-w-0" aria-hidden />
        <AddressActivityWhen
          ts={row.lastTs}
          txId={row.lastTxId}
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

function locTag(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function shareText(pct: number | null | undefined, locale: string): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct.toLocaleString(locTag(locale), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

export function TokenHolderTapeHead({
  stuck,
  address,
  name,
  txs,
  tokens,
  share,
  first,
  last,
}: {
  stuck: boolean;
  address: string;
  name: string;
  txs: string;
  tokens: string;
  share: ReactNode;
  first: string;
  last: string;
}) {
  return (
    <div
      className={clsx(
        "addr-head addr-lane addr-lane-x block-tx-pairs holder-tape text-[12px] font-medium",
        stuck && "is-stuck"
      )}
    >
      <div className="block-lane-pair">
        <AddressTapeNameHead label={address} />
        <div className="min-w-0" aria-hidden />
      </div>
      <div className="block-lane-pair">
        <AddressTapeNameHead label={name} />
        <div className="flex h-full min-w-0 items-center justify-end">
          <span className="whitespace-nowrap text-[12px] font-medium leading-none text-[var(--muted)]">
            {txs}
          </span>
        </div>
      </div>
      <div className="block-lane-pair">
        <AddressTapeNameHead label={tokens} />
        <div className="flex h-full min-w-0 items-center justify-end">{share}</div>
      </div>
      <div className="block-lane-pair">
        <div className="flex h-full min-w-0 items-center">
          <span className="whitespace-nowrap text-[12px] font-medium leading-none text-[var(--muted)]">
            {first}
          </span>
        </div>
        <div className="flex h-full min-w-0 items-center justify-end">
          <span className="whitespace-nowrap text-[12px] font-medium leading-none text-[var(--muted)]">
            {last}
          </span>
        </div>
      </div>
    </div>
  );
}

export function TokenHolderTapeRow({
  row,
  loc,
  t,
  decimals,
  enterClass,
  fav,
  favReady,
  onToggleFav,
}: {
  row: {
    address: string;
    amount: number | string;
    nanoerg?: string | null;
    txCount?: number | null;
    sharePct?: number | null;
    firstTs?: number | null;
    lastTs?: number | null;
    firstTxId?: string | null;
    lastTxId?: string | null;
  };
  loc: string;
  t: (k: string) => string;
  decimals: number;
  enterClass?: string;
  fav: boolean;
  favReady: boolean;
  onToggleFav: (id: string) => void;
}) {
  const nano = row.nanoerg ?? "0";
  const pip = listPip(row.address, nano);
  const kindLabel = t(`addresses.pip.${pip.id}`);
  const aria = [shortId(row.address, 10), pip.name, pip.note, kindLabel]
    .filter(Boolean)
    .join(" · ");
  const held = formatEmissionGlance(toBigIntAmt(row.amount), decimals, loc);
  return (
    <div
      className={clsx(
        "addr-lane addr-lane-x block-tx-pairs holder-tape relative z-0 border-t border-[var(--border-soft)] py-2.5 text-[13px] hover:z-30 focus-within:z-30",
        enterClass
      )}
      onPointerEnter={() => prefetchAddressPage(row.address)}
    >
      <div className="block-lane-pair">
        <div className="lane-id min-w-0 px-3">
          <div className="flex h-[18px] items-center gap-2">
            <AddressPip
              address={row.address}
              nanoerg={nano}
              kindLabel={kindLabel}
              kindGlyph
              className="h-[18px] w-[18px] shrink-0"
            />
            <Link
              prefetch={false}
              href={`/address/${encodeURIComponent(row.address)}`}
              aria-label={aria}
              className="min-w-0 whitespace-nowrap font-mono leading-none text-soft hover:underline lg:shrink-0"
              title={row.address}
              onFocus={() => prefetchAddressPage(row.address)}
            >
              <span className="lg:hidden">{shortId(row.address, 4)}</span>
              <span className="hidden lg:inline">{shortId(row.address, 10)}</span>
            </Link>
            <FavoriteHeart
              size="sm"
              on={fav}
              ready={favReady}
              title={fav ? t("favorites.remove") : t("favorites.add")}
              onToggle={() => onToggleFav(row.address)}
            />
          </div>
        </div>
        <div className="min-w-0" aria-hidden />
      </div>
      <div className="block-lane-pair">
        <div className="flex min-w-0 items-center px-3">
          {pip.name ? (
            <span className="block min-w-0 truncate text-[var(--text)]" title={pip.name}>
              {pip.name}
            </span>
          ) : null}
        </div>
        <div className="whitespace-nowrap px-3 text-right tabular-nums leading-none text-[var(--muted)]">
          {row.txCount != null ? row.txCount.toLocaleString(locTag(loc)) : "—"}
        </div>
      </div>
      <div className="block-lane-pair">
        <div
          className="min-w-0 px-3 tabular-nums leading-none text-[var(--muted)]"
          title={held.exact}
        >
          {held.text}
        </div>
        <div
          className={clsx(
            "whitespace-nowrap px-3 text-right font-medium tabular-nums leading-none",
            row.sharePct != null && "text-[var(--up)]"
          )}
        >
          {shareText(row.sharePct, loc)}
        </div>
      </div>
      <div className="block-lane-pair addr-act-pair">
        <AddressActivityWhen
          ts={row.firstTs}
          txId={row.firstTxId}
          locale={loc}
          align="left"
          openLabel={t("addresses.openTx")}
          copyLabel={t("tx.copy")}
          copiedLabel={t("tx.copied")}
        />
        <AddressActivityWhen
          ts={row.lastTs}
          txId={row.lastTxId}
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
