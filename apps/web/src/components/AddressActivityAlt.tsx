"use client";

/**
 * Activity tab proposals (`?act=a|b`, `?act=off`). Same data as the current
 * tape: the tx row (height, time, fee, size) and the per-tx flow the page
 * already loads (net ERG, net tokens, from/to). No extra requests.
 *
 * A — day feed: rows grouped under a day header, time on the left.
 * B — tight table: counterparty · net ERG · tokens · when · tx, details on expand.
 */

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { TokenLogo } from "@/components/TokenBadge";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { describeParty } from "@/lib/address-labels";
import { tokenDecimals, tokenSymbol } from "@/lib/token-meta";
import type { AddrFlow } from "@/lib/tx-flow";
import {
  formatDottedDate,
  formatH24,
  formatRelTime,
  formatScaledAmount,
  formatScaledGlance,
  formatStamp,
  relAgeTone,
  relAgeToneClass,
  shortId,
  toBigIntAmt,
  toEpochMs,
} from "@/lib/format";
import "./address-activity-alt.css";

export type ActVariant = "a" | "b";
const ACT_STORAGE = "ergoscan.act";

/** `?act=a|b` picks a variant and remembers it; `?act=off` forgets it. */
export function useActVariant(): ActVariant | null {
  const [v, setV] = useState<ActVariant | null>(null);
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("act");
      if (q === "off") {
        localStorage.removeItem(ACT_STORAGE);
        return;
      }
      if (q === "a" || q === "b") {
        localStorage.setItem(ACT_STORAGE, q);
        setV(q);
        return;
      }
      const s = localStorage.getItem(ACT_STORAGE);
      if (s === "a" || s === "b") setV(s);
    } catch {
      /* storage blocked: default tape */
    }
  }, []);
  return v;
}

export type ActTx = {
  id: string;
  inclusionHeight: number | null;
  timestamp: number | null;
  numConfirmations?: number | null;
  size?: number | null;
  fee?: number | string | null;
  mempool?: boolean;
};

export type ActTokenMeta = {
  name: string | null;
  decimals: number;
  artworkUrl?: string | null;
};

type Props = {
  rows: ActTx[];
  flows: Record<string, AddrFlow | null | undefined>;
  tokenMeta: ReadonlyMap<string, ActTokenMeta>;
  self: string;
  enterClass?: (id: string) => string | undefined;
};

type Move = "in" | "out" | "self" | "swap" | "none";

type Model = {
  tx: ActTx;
  id: string;
  ms: number | null;
  move: Move;
  erg: bigint | null;
  tokens: [string, bigint][];
  party: string | null;
  others: string[];
  paidFee: boolean;
  fee: bigint | null;
  from: string[];
  to: string[];
};

/** ERG leg big enough to call a mixed-sign tx a swap (box minimum + fee stay below). */
const SWAP_ERG = 10_000_000n;

function uniqOthers(list: string[], self: string): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const a = raw.trim();
    if (!a || a === self || out.includes(a)) continue;
    out.push(a);
  }
  return out;
}

function modelOf(tx: ActTx, flow: AddrFlow | null | undefined, self: string): Model {
  const id = String(tx.id);
  const fee = tx.fee == null || tx.fee === "" ? null : toBigIntAmt(tx.fee);
  const base = {
    tx,
    id,
    ms: toEpochMs(tx.timestamp),
    fee,
  };
  if (!flow) {
    return { ...base, move: "none", erg: null, tokens: [], party: null, others: [], paidFee: false, from: [], to: [] };
  }
  const tokens = [...flow.tokens.entries()].filter(([, n]) => n !== 0n);
  const tokUp = tokens.some(([, n]) => n > 0n);
  const tokDown = tokens.some(([, n]) => n < 0n);
  const ergAbs = flow.erg < 0n ? -flow.erg : flow.erg;
  const ergLeg = ergAbs >= SWAP_ERG ? (flow.erg > 0n ? 1 : -1) : 0;
  const mixed =
    (tokUp && tokDown) || (ergLeg > 0 && tokDown) || (ergLeg < 0 && tokUp);
  const move: Move = mixed
    ? "swap"
    : flow.kind === "received"
      ? "in"
      : flow.kind === "sent"
        ? "out"
        : "self";
  const pool =
    move === "in" ? flow.from : move === "out" ? flow.to : move === "swap" ? [...flow.to, ...flow.from] : [];
  const others = uniqOthers(pool, self);
  const named = others.find((a) => describeParty(a).known);
  const party = named ?? others[0] ?? null;
  return {
    ...base,
    move,
    erg: flow.erg,
    tokens: tokens.sort((a, b) => (a[1] > 0n === b[1] > 0n ? 0 : a[1] > 0n ? -1 : 1)),
    party,
    others: party ? others.filter((a) => a !== party) : others,
    paidFee: flow.from.includes(self),
    from: flow.from,
    to: flow.to,
  };
}

function locTag(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function signOf(n: bigint): string {
  return n > 0n ? "+" : n < 0n ? "−" : "";
}

function toneOf(n: bigint | null): string {
  if (n == null || n === 0n) return "text-[var(--muted)]";
  return n > 0n ? "text-[var(--up)]" : "text-[var(--down)]";
}

function ErgNet({ nano, locale, className }: { nano: bigint | null; locale: string; className?: string }) {
  if (nano == null) return <span className="text-[var(--muted)]">—</span>;
  const abs = nano < 0n ? -nano : nano;
  const text = formatScaledAmount(abs, 9, locTag(locale));
  const exact = formatScaledAmount(abs, 9, locTag(locale), 9);
  return (
    <span
      className={clsx("act-erg-fig tabular-nums", toneOf(nano), className)}
      title={`${signOf(nano)}${exact} ERG`}
    >
      {signOf(nano)}
      {text}
      <span className="act-unit">ERG</span>
    </span>
  );
}

function DirMark({ move }: { move: Move }) {
  return (
    <span className={clsx("act-dir", `is-${move}`)} aria-hidden>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        {move === "in" ? (
          <path d="M17 7 7 17M7 8.5V17h8.5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
        ) : move === "out" ? (
          <path d="M7 17 17 7M8.5 7H17v8.5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
        ) : move === "self" ? (
          <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.6h-4.6" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
        ) : move === "swap" ? (
          <path d="M7.5 4 4 7.5 7.5 11M4 7.5h14M16.5 13l3.5 3.5-3.5 3.5M20 16.5H6" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M6 12h12" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
        )}
      </svg>
    </span>
  );
}

function PartyLink({ address, className }: { address: string; className?: string }) {
  const party = describeParty(address);
  const name = party.known;
  return (
    <Link
      prefetch={false}
      href={`/address/${encodeURIComponent(address)}`}
      title={address}
      className={clsx("act-party min-w-0 truncate hover:underline", !name && "font-mono tabular-nums", className)}
    >
      {name ?? shortId(address, 6)}
    </Link>
  );
}

function TokenChip({
  tid,
  amt,
  meta,
  locale,
  className,
}: {
  tid: string;
  amt: bigint;
  meta: ActTokenMeta | undefined;
  locale: string;
  className?: string;
}) {
  const dec = tokenDecimals(tid, meta?.decimals);
  const abs = amt < 0n ? -amt : amt;
  const glance = formatScaledGlance(abs, dec, locTag(locale));
  const sym = tokenSymbol(tid, meta?.name) || shortId(tid, 4);
  return (
    <Link
      prefetch={false}
      href={`/token/${tid}`}
      className={clsx("act-chip", className)}
      title={`${signOf(amt)}${glance.exact} ${sym}`}
    >
      <TokenLogo tokenId={tid} artworkUrl={meta?.artworkUrl ?? null} size={16} />
      <span className={clsx("tabular-nums", toneOf(amt))}>
        {signOf(amt)}
        {glance.text}
      </span>
      <span className="act-chip-sym">{sym}</span>
    </Link>
  );
}

function Chips({
  m,
  tokenMeta,
  locale,
  open,
  onMore,
  max = 2,
}: {
  m: Model;
  tokenMeta: ReadonlyMap<string, ActTokenMeta>;
  locale: string;
  open: boolean;
  onMore: () => void;
  max?: number;
}) {
  const { tn } = useI18n();
  if (!m.tokens.length) return null;
  const shown = open ? m.tokens : m.tokens.slice(0, max);
  const rest = m.tokens.length - shown.length;
  return (
    <span className={clsx("act-chips", open && "is-open")}>
      {shown.map(([tid, amt], i) => (
        <TokenChip
          key={tid}
          tid={tid}
          amt={amt}
          meta={tokenMeta.get(tid.toLowerCase())}
          locale={locale}
          className={!open && i > 0 ? "act-chip-2" : undefined}
        />
      ))}
      {rest > 0 ? (
        <button
          type="button"
          className="act-chip act-chip-more act-more-wide tabular-nums"
          title={tn("address.act.moreTokens", rest)}
          onClick={onMore}
        >
          +{rest}
        </button>
      ) : null}
      {!open && m.tokens.length > 1 ? (
        <button
          type="button"
          className="act-chip act-chip-more act-more-narrow tabular-nums"
          title={tn("address.act.moreTokens", m.tokens.length - 1)}
          onClick={onMore}
        >
          +{m.tokens.length - 1}
        </button>
      ) : null}
    </span>
  );
}

function PartyCell({ m, compact = false }: { m: Model; compact?: boolean }) {
  const { t, tn } = useI18n();
  const lead =
    m.move === "in"
      ? t("address.act.from")
      : m.move === "out"
        ? t("address.act.to")
        : m.move === "swap"
          ? t("address.act.with")
          : null;
  if (m.move === "self") {
    return <span className="act-party-self">{t("address.act.self")}</span>;
  }
  if (m.move === "none" || !m.party) {
    return <span className="text-[var(--muted)]">{m.move === "none" ? t("detail.tx") : "—"}</span>;
  }
  return (
    <span className="act-party-line">
      {lead && !compact ? <span className="act-lead">{lead}</span> : null}
      <PartyLink address={m.party} />
      {m.others.length > 0 ? (
        <span className="act-plus tabular-nums" title={tn("address.act.moreParties", m.others.length)}>
          +{m.others.length}
        </span>
      ) : null}
    </span>
  );
}

function kindWord(m: Model, t: (k: string) => string): string {
  switch (m.move) {
    case "in":
      return t("address.received");
    case "out":
      return t("address.sent");
    case "self":
      return t("address.intra");
    case "swap":
      return t("address.act.swap");
    default:
      return t("detail.tx");
  }
}

function HeightLink({ tx, locale }: { tx: ActTx; locale: string }) {
  if (tx.inclusionHeight == null) return null;
  return (
    <Link
      prefetch={false}
      href={`/block/${tx.inclusionHeight}`}
      className="act-height tabular-nums hover:underline"
    >
      {tx.inclusionHeight.toLocaleString(locTag(locale))}
    </Link>
  );
}

function TxLink({ id, className }: { id: string; className?: string }) {
  return (
    <Link prefetch={false} href={`/tx/${id}`} title={id} className={clsx("act-txid font-mono tabular-nums hover:underline", className)}>
      {shortId(id, 4)}
    </Link>
  );
}

function FeeText({ m, locale }: { m: Model; locale: string }) {
  if (!m.paidFee || m.fee == null || m.fee <= 0n) return null;
  return (
    <span className="tabular-nums">
      {formatScaledAmount(m.fee, 9, locTag(locale), 9)}
      <span className="act-unit">ERG</span>
    </span>
  );
}

/* ---------------------------------------------------------------- A: feed */

function dayKey(ms: number | null, pending?: boolean): string {
  if (pending) return "pending";
  return ms == null ? "unknown" : formatDottedDate(ms);
}

export function ActivityFeed({ rows, flows, tokenMeta, self, enterClass }: Props) {
  const { t, tn, locale } = useI18n();
  const models = rows.map((tx) => modelOf(tx, flows[String(tx.id)], self));
  const today = formatDottedDate(Date.now());
  const yesterday = formatDottedDate(Date.now() - 86_400_000);
  const days: { key: string; items: Model[] }[] = [];
  for (const m of models) {
    const key = dayKey(m.ms, m.tx.mempool);
    const last = days[days.length - 1];
    if (last && last.key === key) last.items.push(m);
    else days.push({ key, items: [m] });
  }
  return (
    <div className="act-feed">
      {days.map((day) => {
        let net = 0n;
        let known = false;
        for (const m of day.items) {
          if (m.erg == null) continue;
          known = true;
          net += m.erg;
        }
        const name =
          day.key === "pending"
            ? t("address.act.pending")
            : day.key === today
              ? t("address.act.today")
              : day.key === yesterday
                ? t("address.act.yesterday")
                : null;
        return (
          <section key={day.key} className="act-day">
            <header className="act-day-head">
              <span className="act-day-tag">{name ?? <span className="tabular-nums">{day.key}</span>}</span>
              {name && day.key !== "pending" ? (
                <span className="act-day-date tabular-nums">{day.key}</span>
              ) : null}
              <span className="act-day-count">{tn("address.act.txCount", day.items.length)}</span>
              {known && day.items.length > 1 ? (
                <ErgNet nano={net} locale={locale} className="act-day-net" />
              ) : null}
            </header>
            <ol className="act-day-list">
              {day.items.map((m) => (
                <FeedRow key={m.id} m={m} tokenMeta={tokenMeta} locale={locale} t={t} enterClass={enterClass?.(m.id)} />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function FeedRow({
  m,
  tokenMeta,
  locale,
  t,
  enterClass,
}: {
  m: Model;
  tokenMeta: ReadonlyMap<string, ActTokenMeta>;
  locale: string;
  t: (k: string) => string;
  enterClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const time = m.tx.mempool ? t("address.inMempool") : m.ms == null ? "—" : formatH24(m.ms, undefined, false);
  const fee = <FeeText m={m} locale={locale} />;
  return (
    <li className={clsx("act-feed-row", `is-${m.move}`, enterClass)}>
      <time className="act-time tabular-nums" title={m.ms != null ? formatStamp(m.ms) : undefined}>
        {m.tx.mempool ? "—" : time}
      </time>
      <DirMark move={m.move} />
      <div className="act-main">
        <div className="act-line1">
          <PartyCell m={m} />
        </div>
        <div className="act-line2">
          <span className="act-time-inline tabular-nums">{time}</span>
          <span className="act-kind">{kindWord(m, t)}</span>
          {m.tx.inclusionHeight != null ? <HeightLink tx={m.tx} locale={locale} /> : null}
          <TxLink id={m.id} />
          {m.paidFee && m.fee != null && m.fee > 0n ? (
            <span className="act-fee">
              {t("address.act.fee")} {fee}
            </span>
          ) : null}
        </div>
      </div>
      <div className="act-right">
        <Chips m={m} tokenMeta={tokenMeta} locale={locale} open={open} onMore={() => setOpen((v) => !v)} />
        <ErgNet nano={m.erg} locale={locale} className="act-erg" />
      </div>
    </li>
  );
}

/* --------------------------------------------------------------- B: table */

export function ActivityTable({ rows, flows, tokenMeta, self, enterClass }: Props) {
  const { t, locale } = useI18n();
  const models = rows.map((tx) => modelOf(tx, flows[String(tx.id)], self));
  return (
    <div className="act-table">
      <div className="act-thead" role="row">
        <span>{t("address.act.colParty")}</span>
        <span className="is-end">{t("address.act.colNet")}</span>
        <span>{t("tx.tab.tokens")}</span>
        <span className="is-end">{t("address.act.colWhen")}</span>
        <span className="act-th-tx">{t("address.colTx")}</span>
        <span aria-hidden />
      </div>
      {models.map((m) => (
        <TableRow key={m.id} m={m} tokenMeta={tokenMeta} locale={locale} self={self} enterClass={enterClass?.(m.id)} />
      ))}
    </div>
  );
}

function TableRow({
  m,
  tokenMeta,
  locale,
  self,
  enterClass,
}: {
  m: Model;
  tokenMeta: ReadonlyMap<string, ActTokenMeta>;
  locale: string;
  self: string;
  enterClass?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((v) => !v);
  return (
    <div className={clsx("act-tbody", open && "is-open", enterClass)}>
      <div
        className={clsx("act-tr", `is-${m.move}`)}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a,button")) return;
          toggle();
        }}
      >
        <div className="act-cp">
          <DirMark move={m.move} />
          <PartyCell m={m} />
        </div>
        <div className="act-net">
          <ErgNet nano={m.erg} locale={locale} />
        </div>
        <div className="act-tok">
          <Chips m={m} tokenMeta={tokenMeta} locale={locale} open={false} onMore={() => setOpen(true)} />
        </div>
        <div className="act-when">
          {m.tx.mempool ? (
            <span className="addr-pending-mark">{t("address.inMempool")}</span>
          ) : (
            <span
              className={clsx("tabular-nums", relAgeToneClass(relAgeTone(m.tx.timestamp)))}
              title={m.ms != null ? formatStamp(m.ms) : undefined}
            >
              {formatRelTime(m.tx.timestamp, locale)}
            </span>
          )}
        </div>
        <div className="act-tx">
          <TxLink id={m.id} />
        </div>
        <button
          type="button"
          className="act-caret"
          aria-expanded={open}
          aria-label={t("address.act.details")}
          onClick={toggle}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open ? <TableDetail m={m} tokenMeta={tokenMeta} locale={locale} self={self} /> : null}
    </div>
  );
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="act-field">
      <span className="act-field-label">{label}</span>
      <div className="act-field-value">{children}</div>
    </div>
  );
}

function PartyList({ list, self }: { list: string[]; self: string }) {
  const { t } = useI18n();
  if (!list.length) return <span className="text-[var(--muted)]">—</span>;
  return (
    <span className="act-party-list">
      {list.map((a) =>
        a === self ? (
          <span key={a} className="act-party-self">
            {t("address.thisAddress")}
          </span>
        ) : (
          <PartyLink key={a} address={a} />
        )
      )}
    </span>
  );
}

function TableDetail({
  m,
  tokenMeta,
  locale,
  self,
}: {
  m: Model;
  tokenMeta: ReadonlyMap<string, ActTokenMeta>;
  locale: string;
  self: string;
}) {
  const { t, tn } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="act-detail">
      <DetailField label={t("detail.tx")}>
        <span className="act-detail-id">
          <Link prefetch={false} href={`/tx/${m.id}`} className="act-txid font-mono tabular-nums hover:underline">
            {m.id}
          </Link>
          <button
            type="button"
            className="act-copy"
            onClick={() => {
              void navigator.clipboard?.writeText(m.id).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              });
            }}
          >
            {copied ? t("tx.copied") : t("tx.copy")}
          </button>
        </span>
      </DetailField>
      <DetailField label={t("address.colHeight")}>
        {m.tx.mempool ? (
          <span className="addr-pending-mark">{t("address.inMempool")}</span>
        ) : (
          <span className="act-inline">
            <HeightLink tx={m.tx} locale={locale} />
            {m.tx.numConfirmations != null ? (
              <span className="text-[var(--muted)]">
                {tn("address.act.confirmations", m.tx.numConfirmations, m.tx.numConfirmations.toLocaleString(locTag(locale)))}
              </span>
            ) : null}
          </span>
        )}
      </DetailField>
      <DetailField label={t("address.colTime")}>
        <span className="tabular-nums">{m.ms != null ? formatStamp(m.ms) : "—"}</span>
      </DetailField>
      {m.paidFee && m.fee != null && m.fee > 0n ? (
        <DetailField label={t("tx.fee")}>
          <FeeText m={m} locale={locale} />
        </DetailField>
      ) : null}
      {m.tx.size != null ? (
        <DetailField label={t("address.act.size")}>
          <span className="tabular-nums">
            {tn("address.act.bytes", m.tx.size, m.tx.size.toLocaleString(locTag(locale)))}
          </span>
        </DetailField>
      ) : null}
      <DetailField label={t("address.colFrom")}>
        <PartyList list={m.from} self={self} />
      </DetailField>
      <DetailField label={t("address.colTo")}>
        <PartyList list={m.to} self={self} />
      </DetailField>
      {m.tokens.length > 0 ? (
        <DetailField label={t("tx.tab.tokens")}>
          <span className="act-chips is-open">
            {m.tokens.map(([tid, amt]) => (
              <TokenChip key={tid} tid={tid} amt={amt} meta={tokenMeta.get(tid.toLowerCase())} locale={locale} />
            ))}
          </span>
        </DetailField>
      ) : null}
    </div>
  );
}
