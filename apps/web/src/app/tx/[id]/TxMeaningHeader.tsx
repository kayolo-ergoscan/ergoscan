"use client";

/**
 * The top of a tx page read from its meaning (REPORT §5.4): the 40 px tile, the action and its
 * protocol, the phrase, the cards «Отдал» / «Получил» / «Куда ушли деньги» / «Комиссия сети ·
 * платил X», the block, time, size and boxes, and the «Как определили» line. Words come from
 * the shared module (meaningPage); this file only lays them out and links them.
 */

import { Fragment, useMemo, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  assetLabel,
  formatAmount,
  meaningPage,
  shortAddr,
  type MeaningAssetLike,
  type MeaningCard,
  type MeaningParty,
  type TxMeaning,
} from "@ergoscan/shared";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { KpiMark, type KpiMarkId } from "@/components/kpi-marks";
import { FeedTile } from "@/components/feed/Feed";
import { meaningLang } from "@/components/feed/FeedMeaning";
import { formatBytes, formatClockTime, formatNumericDate, shortId } from "@/lib/format";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { countText } from "@/lib/i18n/messages";
import { meaningTile, phraseParts } from "@/lib/tx-meaning-row";
import { CopyChip } from "./CopyChip";

/** Shorter strings are cut by the gateway («5yE8z7TPirM2B236wY4X»): no page to link to. */
const LINKABLE_ADDR = 40;

export type TxMeaningFacts = {
  confirmed: boolean;
  height: number | null;
  index: number | null;
  blockHref: string | null;
  /** Block time; for a mempool tx, when the node first saw it. */
  timestamp: number | null;
  confirmations: number | null;
  size: number;
  inputs: number;
  outputs: number;
  dataInputs: number;
};

function decimalsOf(a: MeaningAssetLike): number {
  return a.token ? (a.decimals ?? 0) : 9;
}

function Party({ p, label }: { p: MeaningParty; label?: string }) {
  const text = label ?? p.name ?? shortAddr(p.addr);
  const mono = !p.name;
  if (p.addr.length < LINKABLE_ADDR) {
    return <span className={clsx("txm-party is-plain", mono && "is-mono")}>{text}</span>;
  }
  return (
    <Link
      prefetch={false}
      href={`/address/${encodeURIComponent(p.addr)}`}
      title={p.addr}
      className={clsx("txm-party", mono && "is-mono")}
    >
      {text}
    </Link>
  );
}

/** «−6.73 ERG» / «+132.36 RSN»: the figure in mono, a token's name links to its page. */
function Amount({ a, sign }: { a: MeaningAssetLike; sign?: -1 | 1 }) {
  const n = formatAmount(a.amount, decimalsOf(a));
  const label = assetLabel(a);
  return (
    <span className="txm-amt">
      <span className="txm-fig">
        {sign === -1 ? "−" : sign === 1 ? "+" : ""}
        {n}
      </span>{" "}
      {a.token ? (
        <Link prefetch={false} href={`/token/${a.token}`} className="txm-unit is-token" title={a.name ?? a.token}>
          {label}
        </Link>
      ) : (
        <span className="txm-unit">{label}</span>
      )}
    </span>
  );
}

function Card({ c }: { c: MeaningCard }) {
  const tone = c.key === "gave" ? "is-gave" : c.key === "got" ? "is-got" : undefined;
  let body: ReactNode;
  let note: ReactNode = null;
  if (c.key === "gave" || c.key === "got") {
    body = c.assets.map((a, i) => (
      <p key={`${a.token ?? "erg"}-${i}`} className="txm-line">
        <Amount a={a} sign={c.sign} />
      </p>
    ));
    note = c.note;
  } else if (c.key === "flows") {
    body = c.flows.map((f, i) => (
      <p key={i} className="txm-line">
        <Amount a={f.asset} />
        <span className="txm-to">
          {f.to ? (
            <>
              <span className="txm-arrow" aria-hidden>
                →
              </span>
              <Party p={f.to} />
              {f.word ? <span className="txm-word-note">{f.word}</span> : null}
            </>
          ) : (
            <span className="txm-word-note">{f.word}</span>
          )}
        </span>
      </p>
    ));
  } else if (c.key === "fee") {
    body = (
      <p className="txm-line">
        <Amount a={{ token: null, amount: c.nano }} />
      </p>
    );
    note = c.payer ? (
      <>
        {c.note} <Party p={c.payer} />
      </>
    ) : (
      c.note
    );
  }
  return (
    <div className={clsx("txm-card", `is-${c.key}`, tone)}>
      <p className="txm-card-title">{c.title}</p>
      <div className="txm-card-body">{body}</div>
      {note ? <p className="txm-card-note">{note}</p> : null}
    </div>
  );
}

function Fact({ mark, label, children }: { mark: KpiMarkId; label: string; children: ReactNode }) {
  return (
    <span className="txm-fact">
      <KpiMark id={mark} className="txm-ico" />
      <span className="txm-k">{label}</span>
      <span className="txm-v">{children}</span>
    </span>
  );
}

export function TxMeaningHeader({
  id,
  meaning,
  feeNano,
  facts,
  fav,
}: {
  id: string;
  meaning: TxMeaning;
  feeNano: string | null;
  facts: TxMeaningFacts;
  fav: { on: boolean; ready: boolean; toggle: () => void };
}) {
  const t = useT();
  const { locale } = useI18n();
  const lang = meaningLang(locale);
  const page = useMemo(() => meaningPage(meaning, lang, { feeNano }), [meaning, lang, feeNano]);
  const [kind, glyph] = meaningTile({ action: meaning.action, protocol: meaning.protocol ?? undefined, conf: meaning.conf === "exact" ? undefined : meaning.conf });
  const parts = useMemo(
    () => phraseParts(page.phrase, page.parties.map((p) => ({ label: p.label, addr: p.addr }))),
    [page]
  );
  const partyBy = useMemo(() => new Map(page.parties.map((p) => [p.addr, p])), [page]);
  const nf = locale === "ru" ? "ru-RU" : "en-US";
  const dash = "—";

  return (
    <section className="mod txm rounded-[20px] border border-[var(--border)] bg-[var(--module)]">
      <div className="txm-head">
        <span className="txm-tile">
          <FeedTile k={kind} g={glyph} />
        </span>
        <div className="txm-title">
          <h1 className="txm-action">{page.row.word}</h1>
          {page.row.where ? <span className="txm-where">{page.row.where}</span> : null}
          {page.row.guess ? <span className="txm-guess">{page.row.guess}</span> : null}
        </div>
        <div className="txm-id">
          <code className="txm-hash" title={id}>
            {shortId(id, 8)}
          </code>
          <CopyChip text={id} copyLabel={t("tx.copy")} copiedLabel={t("tx.copied")} />
          <FavoriteHeart
            on={fav.on}
            ready={fav.ready}
            title={fav.on ? t("favorites.remove") : t("favorites.add")}
            onToggle={fav.toggle}
          />
        </div>
      </div>

      <p className="txm-phrase">
        {parts.map((p, i) =>
          p.addr ? (
            <Party key={i} p={partyBy.get(p.addr) ?? { addr: p.addr, name: null }} label={p.text} />
          ) : p.num ? (
            <b key={i} className="txm-num">
              {p.text}
            </b>
          ) : (
            <Fragment key={i}>{p.text}</Fragment>
          )
        )}
        {/[.!?]$/.test(page.phrase) ? "" : "."}
      </p>

      {page.cards.length ? (
        <div className="txm-cards">
          {page.cards.map((c) => (
            <Card key={c.key} c={c} />
          ))}
        </div>
      ) : null}

      <div className="txm-facts">
        <Fact mark="block" label={t("detail.block")}>
          {facts.confirmed && facts.height != null ? (
            <>
              {facts.blockHref ? (
                <Link prefetch={false} href={facts.blockHref} className="txm-link">
                  {facts.height.toLocaleString(nf)}
                </Link>
              ) : (
                facts.height.toLocaleString(nf)
              )}
              {facts.index != null ? <span className="txm-dim">#{facts.index}</span> : null}
            </>
          ) : (
            <span className="txm-pending">{t("tx.meaning.inMempool")}</span>
          )}
        </Fact>
        <Fact mark="time" label={facts.confirmed ? t("block.card.time") : t("tx.meaning.seen")}>
          {facts.timestamp ? (
            <>
              {formatClockTime(facts.timestamp, locale)}
              <span className="txm-dim">{formatNumericDate(facts.timestamp, locale)}</span>
            </>
          ) : (
            dash
          )}
          <span className="txm-dim">
            {facts.confirmed
              ? t("tx.confs").replace("{n}", String(facts.confirmations ?? 0))
              : t("tx.unconfirmed")}
          </span>
        </Fact>
        <Fact mark="size" label={t("block.card.size")}>
          {facts.size ? formatBytes(facts.size) : dash}
        </Fact>
        <Fact mark="box" label={t("tx.meaning.boxes")}>
          {facts.inputs}
          <span className="txm-arrow" aria-hidden>
            →
          </span>
          {facts.outputs}
          {facts.dataInputs > 0 ? (
            <span className="txm-dim">{countText(t, locale, "tx.dataInputs", facts.dataInputs)}</span>
          ) : null}
        </Fact>
      </div>

      {page.how || page.rule ? (
        <p className="txm-how">
          <span className="txm-how-k">{t("tx.meaning.how")}</span>
          {page.how ? <span className="txm-how-v">{page.how}</span> : null}
          {page.rule ? (
            <span className="txm-rule">
              {t("tx.meaning.rule")}: {page.rule}
            </span>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
