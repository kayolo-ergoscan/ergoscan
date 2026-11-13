"use client";

/**
 * Address activity as a day feed. Same data the page already loads: the tx
 * row (height, time, fee, size), its `meaning` and the per-tx flow (net ERG,
 * net tokens, from/to). No extra requests.
 *
 * With a meaning the row says what happened from the owner's seat (shared
 * meaningOwnerRow): «Отправлено → KuCoin», «Получено ← Gate.io», «Обмен ·
 * ErgoDex»; the figures are the owner's own (the activity flow), the fee only
 * when he paid it; an order and its fill point at each other. Without a
 * meaning the row is the old one.
 */

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import { meaningOwnerRow, type CompactMeaning, type MeaningParty } from "@ergoscan/shared";
import { Tip } from "@/components/Tip";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { describeParty } from "@/lib/address-labels";
import { linkOrders, type OrderLink } from "@/lib/address-orders";
import type { AddrFlow } from "@/lib/tx-flow";
import { meaningTile, parseMeaning } from "@/lib/tx-meaning-row";
import { formatScaledAmount, formatStamp, shortId, toBigIntAmt, toEpochMs } from "@/lib/format";
import {
  FeedAmount,
  FeedCount,
  FeedDays,
  FeedField,
  FeedFields,
  FeedIdLine,
  FeedRow,
  FeedTokenChips,
  feedLoc,
  type FeedKind,
  type FeedTokenMeta,
} from "./Feed";
import type { FeedGlyphId } from "./FeedGlyph";
import { MeaningPartyLink, MeaningPhraseField, MeaningTitle, meaningLang } from "./FeedMeaning";

export type ActTx = {
  id: string;
  inclusionHeight: number | null;
  timestamp: number | null;
  numConfirmations?: number | null;
  size?: number | null;
  fee?: number | string | null;
  mempool?: boolean;
  /** The gateway's list-form meaning; anything else is dropped. */
  meaning?: unknown;
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
  /** Contract-registry names of parties the book does not name (orders, positions). */
  names: ReadonlyMap<string, string> | undefined;
  meaning: CompactMeaning | undefined;
};

/** ERG leg big enough to call a mixed-sign tx a swap (box minimum + fee stay below). */
const SWAP_ERG = 10_000_000n;

const MOVE_TILE: Record<Move, [FeedKind, FeedGlyphId]> = {
  in: ["in", "in"],
  out: ["out", "out"],
  self: ["self", "self"],
  swap: ["swap", "swap"],
  none: ["quiet", "none"],
};

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
  const base = { tx, id, ms: toEpochMs(tx.timestamp), fee, meaning: parseMeaning(tx.meaning), names: flow?.names };
  if (!flow) {
    return { ...base, move: "none", erg: null, tokens: [], party: null, others: [], paidFee: false, from: [], to: [] };
  }
  const tokens = [...flow.tokens.entries()].filter(([, n]) => n !== 0n);
  const tokUp = tokens.some(([, n]) => n > 0n);
  const tokDown = tokens.some(([, n]) => n < 0n);
  const ergAbs = flow.erg < 0n ? -flow.erg : flow.erg;
  const ergLeg = ergAbs >= SWAP_ERG ? (flow.erg > 0n ? 1 : -1) : 0;
  const mixed = (tokUp && tokDown) || (ergLeg > 0 && tokDown) || (ergLeg < 0 && tokUp);
  const move: Move = mixed ? "swap" : flow.kind === "received" ? "in" : flow.kind === "sent" ? "out" : "self";
  const pool =
    move === "in" ? flow.from : move === "out" ? flow.to : move === "swap" ? [...flow.to, ...flow.from] : [];
  const others = uniqOthers(pool, self);
  const named = others.find((a) => describeParty(a, false, { name: flow.names?.get(a) }).known);
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

function PartyLink({ address, names }: { address: string; names?: ReadonlyMap<string, string> }) {
  const party = describeParty(address, false, { name: names?.get(address) });
  const name = party.known;
  return (
    <Link
      prefetch={false}
      href={`/address/${encodeURIComponent(address)}`}
      title={address}
      className={clsx("feed-party feed-name hover:underline", !name && "font-mono tabular-nums")}
    >
      {name ?? shortId(address, 6)}
    </Link>
  );
}

function PartyTitle({ m }: { m: Model }) {
  const { t, tn } = useI18n();
  if (m.move === "self") return <span className="text-[var(--muted)]">{t("address.act.self")}</span>;
  if (m.move === "none" || !m.party) {
    return <span className="text-[var(--muted)]">{m.move === "none" ? t("detail.tx") : "—"}</span>;
  }
  const lead = m.move === "in" ? t("address.act.from") : m.move === "out" ? t("address.act.to") : t("address.act.with");
  return (
    <>
      <span className="feed-lead-word">{lead}</span>
      <PartyLink address={m.party} names={m.names} />
      {m.others.length > 0 ? (
        <Tip content={tn("address.act.moreParties", m.others.length)}>
          <span className="feed-plus tabular-nums">+{m.others.length}</span>
        </Tip>
      ) : null}
    </>
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

function PartyList({ list, self, names }: { list: string[]; self: string; names?: ReadonlyMap<string, string> }) {
  const { t } = useI18n();
  if (!list.length) return <span className="text-[var(--muted)]">—</span>;
  return (
    <span className="feed-list">
      {list.map((a) =>
        a === self ? (
          <span key={a} className="text-[var(--muted)]">
            {t("address.thisAddress")}
          </span>
        ) : (
          <PartyLink key={a} address={a} names={names} />
        )
      )}
    </span>
  );
}

export function ActivityFeed({
  rows,
  flows,
  tokenMeta,
  self,
  enterClass,
}: {
  rows: ActTx[];
  flows: Record<string, AddrFlow | null | undefined>;
  tokenMeta: ReadonlyMap<string, FeedTokenMeta>;
  self: string;
  enterClass?: (id: string) => string | undefined;
}) {
  const models = useMemo(() => rows.map((tx) => modelOf(tx, flows[String(tx.id)], self)), [rows, flows, self]);
  const links = useMemo(
    () =>
      linkOrders(
        models.map((m) => ({ id: m.id, height: m.tx.inclusionHeight, meaning: m.meaning, from: m.from, to: m.to })),
        self
      ),
    [models, self]
  );
  return (
    <FeedDays
      items={models}
      seconds
      msOf={(m) => m.ms}
      pendingOf={(m) => !!m.tx.mempool}
      countOf={(n) => <FeedCount k="feed.txCount" n={n} />}
      totalOf={(day) => {
        if (day.length < 2) return undefined;
        let net = 0n;
        let known = false;
        for (const m of day) {
          if (m.erg == null) continue;
          known = true;
          net += m.erg;
        }
        return known ? <FeedAmount raw={net} signed /> : undefined;
      }}
      render={(m, lead) =>
        m.meaning ? (
          <OwnerMeaningRow
            key={m.id}
            m={m}
            meaning={m.meaning}
            link={links.get(m.id)}
            lead={lead}
            self={self}
            tokenMeta={tokenMeta}
            enterClass={enterClass?.(m.id)}
          />
        ) : (
          <ActivityRow key={m.id} m={m} lead={lead} self={self} tokenMeta={tokenMeta} enterClass={enterClass?.(m.id)} />
        )
      }
    />
  );
}

/** The fields both row looks share in the detail: tx, block, time, fee, size, from, to, tokens. */
function ActivityFields({
  m,
  self,
  tokenMeta,
  feePaid,
  height,
}: {
  m: Model;
  self: string;
  tokenMeta: ReadonlyMap<string, FeedTokenMeta>;
  feePaid: bigint | null;
  height: ReactNode;
}) {
  const { t, tn, locale } = useI18n();
  const tag = feedLoc(locale);
  return (
    <>
      <FeedField label={t("detail.tx")} wide>
        <FeedIdLine href={`/tx/${m.id}`} id={m.id} />
      </FeedField>
      <FeedField label={t("address.colHeight")}>
        {m.tx.mempool ? (
          <span>{t("address.inMempool")}</span>
        ) : (
          <span className="tabular-nums">
            {height ?? "—"}
            {m.tx.numConfirmations != null ? (
              <span className="text-[var(--muted-2)]">
                {" · "}
                {tn("address.act.confirmations", m.tx.numConfirmations, m.tx.numConfirmations.toLocaleString(tag))}
              </span>
            ) : null}
          </span>
        )}
      </FeedField>
      <FeedField label={t("address.colTime")}>
        <span className="tabular-nums" suppressHydrationWarning>
          {m.ms != null ? formatStamp(m.ms) : "—"}
        </span>
      </FeedField>
      {feePaid != null ? (
        <FeedField label={t("tx.fee")}>
          <span className="tabular-nums">{formatScaledAmount(feePaid, 9, tag, 9)} ERG</span>
        </FeedField>
      ) : null}
      {m.tx.size != null ? (
        <FeedField label={t("address.act.size")}>
          <span className="tabular-nums">{tn("feed.bytes", m.tx.size, m.tx.size.toLocaleString(tag))}</span>
        </FeedField>
      ) : null}
      <FeedField label={t("address.colFrom")}>
        <PartyList list={m.from} self={self} names={m.names} />
      </FeedField>
      <FeedField label={t("address.colTo")}>
        <PartyList list={m.to} self={self} names={m.names} />
      </FeedField>
      {m.tokens.length > 0 ? (
        <FeedField label={t("tx.tab.tokens")} wide>
          <FeedTokenChips tokens={m.tokens} meta={(tid) => tokenMeta.get(tid.toLowerCase())} max={m.tokens.length} />
        </FeedField>
      ) : null}
    </>
  );
}

/** «→ KuCoin» / «← Gate.io» / «9fYV…reou» (a pool sees the trader): the other side, from the owner's seat. */
function OwnerParty({ dir, p }: { dir: "to" | "from" | null; p: MeaningParty }) {
  return (
    <span className="mx-route">
      {dir ? (
        <span className="mx-arrow mx-dir" aria-hidden>
          {dir === "to" ? "→" : "←"}
        </span>
      ) : null}
      <MeaningPartyLink p={p} />
    </span>
  );
}

/** «исполнена в том же блоке» on an order, «по заявке 037f…3d1c» on its fill: links to the other tx. */
function OrderNote({ link }: { link: OrderLink }) {
  const { t, locale } = useI18n();
  const text =
    link.side === "fill"
      ? t("address.act.byOrder").replace("{id}", shortId(link.other, 4))
      : link.kind === "cancelled"
        ? t("address.act.cancelled")
        : link.sameBlock
          ? t("address.act.filledSameBlock")
          : t("address.act.filledAt").replace(
              "{h}",
              link.otherHeight != null ? link.otherHeight.toLocaleString(feedLoc(locale)) : "—"
            );
  return (
    <Link prefetch={false} href={`/tx/${link.other}`} title={link.other} className="mx-note mx-order">
      {text}
    </Link>
  );
}

/** «по заявке» is said by the link when the order is on the page. */
const BY_ORDER = new Set(["по заявке", "by order"]);

function OwnerMeaningRow({
  m,
  meaning,
  link,
  lead,
  self,
  tokenMeta,
  enterClass,
}: {
  m: Model;
  meaning: CompactMeaning;
  link: OrderLink | undefined;
  lead: Parameters<typeof FeedRow>[0]["lead"];
  self: string;
  tokenMeta: ReadonlyMap<string, FeedTokenMeta>;
  enterClass?: string;
}) {
  const { t, locale } = useI18n();
  const tag = feedLoc(locale);
  const lang = meaningLang(locale);
  const r = useMemo(() => meaningOwnerRow(meaning, self, lang, m.erg), [meaning, self, lang, m.erg]);
  const [k, g0] = meaningTile(meaning);
  // A plain transfer shows its direction for the owner, in the transfer colour.
  const g: FeedGlyphId =
    meaning.action === "send" || meaning.action === "multisend" ? (r.view.role === "actor" ? "out" : "in") : g0;
  // The fee is the owner's only when he paid it (the meaning says who did; an executor may have).
  const payer = meaning.feePayer !== undefined ? meaning.feePayer : (meaning.actor ?? null);
  const feePaid = payer === self && m.fee != null && m.fee > 0n ? m.fee : null;
  // His figure without the fee, which sits under it: «−0.001 ERG / комиссия 0.011». The day total keeps the net.
  const net = m.erg == null ? null : feePaid != null ? m.erg + feePaid : m.erg;
  const value = net === 0n ? null : net;
  const height =
    m.tx.inclusionHeight != null ? (
      <Link prefetch={false} href={`/block/${m.tx.inclusionHeight}`} className="tabular-nums">
        {m.tx.inclusionHeight.toLocaleString(tag)}
      </Link>
    ) : null;
  const notes = link?.side === "fill" ? r.notes.filter((n) => !BY_ORDER.has(n)) : r.notes;
  // The meaning names wallets it knows; an order or a position gets the contract registry's name.
  const withName = (p: MeaningParty): MeaningParty => (p.name ? p : { ...p, name: m.names?.get(p.addr) ?? null });
  const party = r.to ? (
    <OwnerParty dir="to" p={withName(r.to)} />
  ) : r.from ? (
    <OwnerParty dir="from" p={withName(r.from)} />
  ) : r.who ? (
    <OwnerParty dir={null} p={withName(r.who)} />
  ) : null;
  return (
    <FeedRow
      k={k}
      glyph={g}
      hollow={!!m.tx.mempool}
      tileTitle={r.where ? `${r.word} · ${r.where}` : r.word}
      lead={lead}
      enterClass={enterClass}
      className={r.quiet ? "mx-row is-quiet" : "mx-row"}
      title={<MeaningTitle r={r} href={`/tx/${m.id}`} title={m.id} />}
      facts={
        <>
          {r.where ? <span className="feed-phone-only mx-where-fact">{r.where}</span> : null}
          {party}
          {notes.map((n, i) => (
            <span key={`n${i}`} className="mx-note">
              {n}
            </span>
          ))}
          {link ? <OrderNote link={link} /> : null}
          {r.guess ? <span className="mx-guess">{r.guess}</span> : null}
          <Link prefetch={false} href={`/tx/${m.id}`} title={m.id} className="feed-narrow-off font-mono tabular-nums">
            {shortId(m.id, 4)}
          </Link>
        </>
      }
      chips={
        m.tokens.length ? (
          <FeedTokenChips tokens={m.tokens} meta={(tid) => tokenMeta.get(tid.toLowerCase())} />
        ) : null
      }
      value={<FeedAmount raw={value} signed />}
      sub={
        feePaid != null ? (
          <span className="tabular-nums">
            {t("address.act.fee")} {formatScaledAmount(feePaid, 9, tag)}
          </span>
        ) : undefined
      }
      detail={() => (
        <FeedFields>
          <MeaningPhraseField m={meaning} />
          <ActivityFields m={m} self={self} tokenMeta={tokenMeta} feePaid={feePaid} height={height} />
        </FeedFields>
      )}
    />
  );
}

function ActivityRow({
  m,
  lead,
  self,
  tokenMeta,
  enterClass,
}: {
  m: Model;
  lead: Parameters<typeof FeedRow>[0]["lead"];
  self: string;
  tokenMeta: ReadonlyMap<string, FeedTokenMeta>;
  enterClass?: string;
}) {
  const { t, locale } = useI18n();
  const tag = feedLoc(locale);
  const [k, g] = MOVE_TILE[m.move];
  const feePaid = m.paidFee && m.fee != null && m.fee > 0n ? m.fee : null;
  const height =
    m.tx.inclusionHeight != null ? (
      <Link prefetch={false} href={`/block/${m.tx.inclusionHeight}`} className="tabular-nums">
        {m.tx.inclusionHeight.toLocaleString(tag)}
      </Link>
    ) : null;
  return (
    <FeedRow
      k={k}
      glyph={g}
      hollow={!!m.tx.mempool}
      tileTitle={kindWord(m, t)}
      lead={lead}
      enterClass={enterClass}
      title={<PartyTitle m={m} />}
      facts={
        <>
          <span className="feed-kind">{kindWord(m, t)}</span>
          {height ? <span className="feed-narrow-off">{height}</span> : null}
          <Link prefetch={false} href={`/tx/${m.id}`} title={m.id} className="feed-narrow-off font-mono tabular-nums">
            {shortId(m.id, 4)}
          </Link>
          {feePaid != null ? (
            <span className="feed-mid">
              {t("feed.fee")} <span className="tabular-nums">{formatScaledAmount(feePaid, 9, tag)}</span>
            </span>
          ) : null}
        </>
      }
      chips={
        m.tokens.length ? (
          <FeedTokenChips tokens={m.tokens} meta={(tid) => tokenMeta.get(tid.toLowerCase())} />
        ) : null
      }
      value={<FeedAmount raw={m.erg} signed />}
      detail={() => (
        <FeedFields>
          <ActivityFields m={m} self={self} tokenMeta={tokenMeta} feePaid={feePaid} height={height} />
        </FeedFields>
      )}
    />
  );
}
