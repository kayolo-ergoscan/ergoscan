"use client";

/**
 * The pieces of a tx row read from the gateway's `meaning`: what happened, who did it, what
 * they gave and got. Words come from the shared module (meaningRow, sayMeaning, MEANING_VOCAB),
 * so every list says them the same way in RU and EN. FeedTxRow and the token tape use these;
 * a row without `meaning` keeps its old look.
 */

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  MEANING_VOCAB,
  assetLabel,
  meaningRow,
  sayMeaning,
  shortAddr,
  type CompactMeaning,
  type MeaningAssetLike,
  type MeaningParty,
  type MeaningRow,
} from "@ergoscan/shared";
import { Tip, TipFigure } from "@/components/Tip";
import { TokenLogo } from "@/components/TokenBadge";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { formatScaledAmount, formatScaledGlance, toBigIntAmt } from "@/lib/format";
import type { TxFold } from "@/lib/tx-meaning-row";
import { FeedAmount, FeedField, FeedRow, FeedTokenChip, feedLoc, type FeedLead } from "./Feed";

export function meaningLang(locale: string): "ru" | "en" {
  return locale === "ru" ? "ru" : "en";
}

/** The row model in the page's language; null for a row without `meaning`. */
export function useMeaningRow(m: CompactMeaning | null | undefined): MeaningRow | null {
  const { locale } = useI18n();
  return useMemo(() => (m ? meaningRow(m, meaningLang(locale)) : null), [m, locale]);
}

function decimalsOf(a: MeaningAssetLike): number {
  return a.token ? (a.decimals ?? 0) : 9;
}

/** An address on line 2: its registry name, or the short address in mono. */
export function MeaningPartyLink({ p }: { p: MeaningParty }) {
  return (
    <Link
      prefetch={false}
      href={`/address/${encodeURIComponent(p.addr)}`}
      data-addr={p.addr}
      title={p.addr}
      className={clsx("mx-party hover:underline", !p.name && "font-mono tabular-nums")}
    >
      {p.name ?? shortAddr(p.addr)}
    </Link>
  );
}

/** Line 1: the action word (the row's link to its tx), then where it happened, muted. */
export function MeaningTitle({ r, href, title, children }: { r: MeaningRow; href: string; title?: string; children?: ReactNode }) {
  return (
    <>
      <Link prefetch={false} href={href} title={title} className="feed-name mx-word">
        {r.word}
      </Link>
      {r.where ? <span className="mx-where mx-desk">{r.where}</span> : null}
      {children}
    </>
  );
}

/**
 * Line 2 as facts: on a phone «where · who» (the time comes first from the row), on a desktop
 * «who → to · notes». A guess adds a grey word.
 */
export function meaningFacts(r: MeaningRow, opts: { notes?: boolean } = {}): ReactNode[] {
  const out: ReactNode[] = [];
  if (r.where) {
    out.push(
      <span key="where" className="feed-phone-only mx-where-fact">
        {r.where}
      </span>
    );
  }
  if (r.who || r.to) {
    out.push(
      <span key="who" className="mx-route">
        {r.who ? <MeaningPartyLink p={r.who} /> : null}
        {r.to ? (
          <>
            <span className="mx-arrow" aria-hidden>
              →
            </span>
            <MeaningPartyLink p={r.to} />
          </>
        ) : null}
      </span>
    );
  }
  if (opts.notes !== false) {
    r.notes.forEach((n, i) => {
      out.push(
        <span key={`n${i}`} className="mx-note">
          {n}
        </span>
      );
    });
  }
  if (r.guess) {
    out.push(
      <span key="guess" className="mx-guess">
        {r.guess}
      </span>
    );
  }
  return out;
}

/** One asset as a chip: ERG with its coin, a token like the token tape. */
function MeaningAssetChip({ a, className }: { a: MeaningAssetLike; className?: string }) {
  const { locale } = useI18n();
  const raw = toBigIntAmt(a.amount);
  if (a.token) {
    return (
      <FeedTokenChip
        tid={a.token}
        amt={raw}
        meta={{ name: a.name ?? null, decimals: a.decimals ?? 0 }}
        signed={false}
        className={className}
      />
    );
  }
  const g = formatScaledGlance(raw, 9, feedLoc(locale));
  return (
    <Tip tap={false} content={g.exact === g.text ? null : () => <TipFigure>{g.exact} ERG</TipFigure>}>
      <span className={clsx("feed-chip", className)}>
        <TokenLogo tokenId="erg" size={16} />
        <span className="tabular-nums">{g.text}</span>
        <span className="feed-chip-sym">ERG</span>
      </span>
    </Tip>
  );
}

/** Left of the figure: what the actor paid, then the arrow. Desktop and tablet only. */
export function MeaningGave({ r }: { r: MeaningRow }) {
  if (!r.gave.length) return null;
  const rest = r.gave.length - 1;
  return (
    <span className="mx-gave">
      <MeaningAssetChip a={r.gave[0]!} />
      {rest > 0 ? <span className="feed-chip is-plain tabular-nums">+{rest}</span> : null}
      <span className="mx-arrow" aria-hidden>
        →
      </span>
    </span>
  );
}

/** The big figure: what the actor ended up with (or gave, when nothing came back); «—» when nothing moved. */
export function MeaningValue({ r }: { r: MeaningRow }) {
  const big = r.big;
  if (!big) return <FeedAmount raw={null} />;
  return <FeedAmount raw={toBigIntAmt(big.amount)} decimals={decimalsOf(big)} unit={assetLabel(big)} glance />;
}

/** Under the figure: the rest of the big side on a desktop; on a phone «за 6.73 ERG» and the like. */
export function meaningSub(r: MeaningRow): ReactNode {
  if (!r.sub && !r.phoneSub) return null;
  return (
    <>
      {r.sub ? <span className="mx-desk">{r.sub}</span> : null}
      {r.phoneSub ? <span className="mx-phone">{r.phoneSub}</span> : null}
    </>
  );
}

/** The whole phrase for the detail: «9fYV…reou обменял 6.73 ERG на 132.36 RSN в ErgoDex». */
export function MeaningPhraseField({ m }: { m: CompactMeaning }) {
  const { t, locale } = useI18n();
  const text = useMemo(() => sayMeaning(m, meaningLang(locale)), [m, locale]);
  return (
    <FeedField label={t("feed.meaning")} wide>
      <span className="mx-phrase">{text}</span>
    </FeedField>
  );
}

/** «· платил 9gvv…DDPB» after the fee, when the actor did not pay it. */
export function MeaningFeePayer({ m }: { m: CompactMeaning }) {
  const { t } = useI18n();
  if (m.feePayer === undefined) return null;
  return (
    <span className="text-[var(--muted-2)]">
      {" · "}
      {m.feePayer ? (
        <>
          {t("feed.feePaidBy")} <MeaningPartyLink p={{ addr: m.feePayer, name: null }} />
        </>
      ) : (
        t("feed.feePaidByExecutor")
      )}
    </span>
  );
}

/** A tx fee in the detail, every digit. */
export function feeText(fee: bigint, locale: string): string {
  return `${formatScaledAmount(fee, 9, feedLoc(locale), 9)} ERG`;
}

/**
 * «Служебные: 23 · Цена от оракула ×14 · Награда за блок ×5»: a day's machine rows as one
 * quiet row with «показать» / «скрыть».
 */
export function FeedServiceFold<T>({
  fold,
  lead,
  onToggle,
}: {
  fold: TxFold<T>;
  lead: FeedLead;
  onToggle: () => void;
}) {
  const { t, tn, locale } = useI18n();
  const lang = meaningLang(locale);
  const n = fold.rows.length;
  const words = fold.counts.map(([a, c]) => {
    const w = MEANING_VOCAB[a][lang];
    return `${w.charAt(0).toLowerCase()}${w.slice(1)} ×${c}`;
  });
  return (
    <FeedRow
      k="quiet"
      glyph="protocol"
      lead={lead}
      className={clsx("mx-fold is-quiet", fold.open && "is-unfolded")}
      tileTitle={t("feed.fold.hint")}
      title={
        <>
          <button type="button" className="feed-name mx-word mx-fold-title" aria-expanded={fold.open} onClick={onToggle}>
            {tn("feed.fold.title", n)}
          </button>
          <span className="mx-where mx-desk">{t("feed.fold.hint")}</span>
        </>
      }
      facts={words.map((w, i) => (
        <span key={w} className={i < 2 ? "mx-note" : "mx-note mx-desk"}>
          {w}
        </span>
      ))}
      value={
        <button type="button" className="feed-chip is-plain mx-fold-btn" aria-expanded={fold.open} onClick={onToggle}>
          {t(fold.open ? "feed.fold.hide" : "feed.fold.show")}
        </button>
      }
    />
  );
}
