"use client";

/**
 * Address activity as a day feed. Same data the page already loads: the tx
 * row (height, time, fee, size) and the per-tx flow (net ERG, net tokens,
 * from/to). No extra requests.
 */

import Link from "next/link";
import clsx from "clsx";
import { Tip } from "@/components/Tip";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { describeParty } from "@/lib/address-labels";
import type { AddrFlow } from "@/lib/tx-flow";
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

export type ActTx = {
  id: string;
  inclusionHeight: number | null;
  timestamp: number | null;
  numConfirmations?: number | null;
  size?: number | null;
  fee?: number | string | null;
  mempool?: boolean;
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
  const base = { tx, id, ms: toEpochMs(tx.timestamp), fee };
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

function PartyLink({ address }: { address: string }) {
  const party = describeParty(address);
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
      <PartyLink address={m.party} />
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

function PartyList({ list, self }: { list: string[]; self: string }) {
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
          <PartyLink key={a} address={a} />
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
  const models = rows.map((tx) => modelOf(tx, flows[String(tx.id)], self));
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
      render={(m, lead) => (
        <ActivityRow key={m.id} m={m} lead={lead} self={self} tokenMeta={tokenMeta} enterClass={enterClass?.(m.id)} />
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
  const { t, tn, locale } = useI18n();
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
            <PartyList list={m.from} self={self} />
          </FeedField>
          <FeedField label={t("address.colTo")}>
            <PartyList list={m.to} self={self} />
          </FeedField>
          {m.tokens.length > 0 ? (
            <FeedField label={t("tx.tab.tokens")} wide>
              <FeedTokenChips tokens={m.tokens} meta={(tid) => tokenMeta.get(tid.toLowerCase())} max={m.tokens.length} />
            </FeedField>
          ) : null}
        </FeedFields>
      )}
    />
  );
}
