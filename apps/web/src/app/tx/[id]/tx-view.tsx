"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { CATEGORY_COLORS } from "@ergoscan/shared";
import { Shell } from "@/components/Shell";
import { FavoriteHeart } from "@/components/FavoriteHeart";
import { AddrFactCard } from "@/components/AddrFactCard";
import { KpiMark } from "@/components/kpi-marks";
import { KpiNum } from "@/components/KpiGrid";
import { SegBar, segItem } from "@/components/SegBar";
import { TxBallPit, type TxBallSeed } from "@/components/TxBallPit";
import { TxIoMark } from "@/components/TxIoMark";
import {
  Feed,
  FeedAmount,
  FeedBoard,
  FeedCount,
  FeedEmpty,
  FeedField,
  FeedPlate,
  FeedSection,
  type FeedTokenMeta,
} from "@/components/feed/Feed";
import { FeedBoxRow, FeedHoldingRow, FeedPartyRow } from "@/components/feed/FeedBoxRow";
import { getGateway } from "@/lib/config";
import type { TxPageSnapshot, TxTokenMeta } from "@/lib/list-snapshots";
import {
  formatBytes,
  formatClockTime,
  formatErgPrecise,
  formatFeeRate,
  formatNumericDate,
  shortId,
  toBigIntAmt,
} from "@/lib/format";
import { lockCaption, lockIdFromIo, txChipCaption } from "@/lib/tx-lock";
import { tokenDecimals, tokenSymbol } from "@/lib/token-meta";
import {
  groupParties,
  markFeeOutputIndexes,
  type Party,
  type TxIo,
} from "@/lib/tx-flow";
import { INK, DONUT_SLICES } from "@/lib/palette";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { countText } from "@/lib/i18n/messages";
import { useFavoriteOf } from "@/lib/favorites";
import { readHashTab, setHashTab } from "@/lib/hash-tab";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";
import { ENTER_MS, SNAPSHOT_FETCH, enteringIds, useEnterIds } from "@/lib/keyed-enter";
import { paintTxSnapshot } from "@/lib/tx-shape-paint";
import { TxExplanationPanel } from "./TxExplanationPanel";

const TX_TABS = ["summary", "boxes", "tokens"] as const;
type TxTab = (typeof TX_TABS)[number];
const TOKEN_INK = DONUT_SLICES.filter((c) => c.startsWith("#"));

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function readTxTab(): TxTab {
  const h = readHashTab(
    ["summary", "boxes", "inputs", "outputs", "tokens"] as const,
    "summary"
  );
  if (h === "inputs" || h === "outputs") return "boxes";
  if (h === "tokens") return "tokens";
  return h === "boxes" ? "boxes" : "summary";
}

function snapIds(snap: TxPageSnapshot): string[] {
  const inn = (snap.inputs ?? []) as TxIo[];
  const out = (snap.outputs ?? []) as TxIo[];
  const feeIdx = markFeeOutputIndexes(out, toBigIntAmt(snap.fee));
  const sources = groupParties(inn, feeIdx, "in");
  const dests = groupParties(out, feeIdx, "out");
  return [
    ...inn.map((io, i) => ioKey(io, i, "in")),
    ...out.map((io, i) => ioKey(io, i, "out")),
    ...rankTokens(inn, out).map((r) => `tok-${r.tokenId}`),
    ...sources.map((p) => p.key),
    ...dests.map((p) => p.key),
  ];
}

function tabEnterIds(
  tab: TxTab,
  fromParties: Party[],
  toParties: Party[],
  feeParties: Party[],
  inputs: TxIo[],
  outputs: TxIo[],
  ranked: TokenRank[]
): string[] {
  if (tab === "summary") {
    return [...fromParties, ...toParties, ...feeParties].map((p) => p.key);
  }
  if (tab === "boxes") {
    return [
      ...inputs.map((io, i) => ioKey(io, i, "in")),
      ...outputs.map((io, i) => ioKey(io, i, "out")),
    ];
  }
  return ranked.map((r) => `tok-${r.tokenId}`);
}

function asTxData(snap: TxPageSnapshot | null): TxPageSnapshot | null {
  if (!snap) return null;
  return paintTxSnapshot({
    ...snap,
    inputs: (snap.inputs ?? []) as TxIo[],
    outputs: (snap.outputs ?? []) as TxIo[],
  });
}

function sumIo(ios: TxIo[]): bigint {
  return ios.reduce((s, io) => s + toBigIntAmt(io.value), 0n);
}

function ioKey(io: TxIo, i: number, side: string): string {
  return io.boxId || `${side}-${i}`;
}

function metaMap(list: TxTokenMeta[] | undefined): Map<string, TxTokenMeta> {
  const m = new Map<string, TxTokenMeta>();
  for (const row of list ?? []) {
    if (row.tokenId) m.set(row.tokenId.toLowerCase(), row);
  }
  return m;
}

type TokenRank = { tokenId: string; inAmt: bigint; outAmt: bigint };

function rankTokens(inputs: TxIo[], outputs: TxIo[]): TokenRank[] {
  const inn = new Map<string, bigint>();
  const out = new Map<string, bigint>();
  const bump = (m: Map<string, bigint>, id: string, amt: bigint) => {
    m.set(id, (m.get(id) ?? 0n) + amt);
  };
  for (const io of inputs) {
    for (const a of io.assets ?? []) {
      const id = a.tokenId?.toLowerCase();
      if (!id || /^0+$/.test(id)) continue;
      bump(inn, id, toBigIntAmt(a.amount));
    }
  }
  for (const io of outputs) {
    for (const a of io.assets ?? []) {
      const id = a.tokenId?.toLowerCase();
      if (!id || /^0+$/.test(id)) continue;
      bump(out, id, toBigIntAmt(a.amount));
    }
  }
  return [...new Set([...inn.keys(), ...out.keys()])]
    .map((tokenId) => ({
      tokenId,
      inAmt: inn.get(tokenId) ?? 0n,
      outAmt: out.get(tokenId) ?? 0n,
    }))
    .sort((a, b) => {
      const A = a.inAmt > a.outAmt ? a.inAmt : a.outAmt;
      const B = b.inAmt > b.outAmt ? b.inAmt : b.outAmt;
      if (A === B) return 0;
      return A > B ? -1 : 1;
    });
}

function mixWeight(n: bigint, floor: number, ceil: number): number {
  const v = n < 0n ? -n : n;
  if (v === 0n) return floor;
  return Math.min(ceil, floor + v.toString().length * 36);
}

export function TxView({
  id,
  initial,
}: {
  id: string;
  initial: TxPageSnapshot | null;
}) {
  const t = useT();
  const txFav = useFavoriteOf("transactions", id);
  const { locale } = useI18n();
  const { markSynced } = usePageSync();
  const ioIdsRef = useRef<string[]>([]);
  const [data, setData] = useState<TxPageSnapshot | null>(() => {
    const snap = asTxData(initial);
    if (snap) ioIdsRef.current = snapIds(snap);
    return snap;
  });
  // A tx the server already has is drawn in the first HTML (Summary tab; a #boxes / #tokens
  // link switches before paint), with the same entry animation.
  const enter = useEnterIds(ENTER_MS, [], data != null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<TxTab>("summary");
  const [sheetReady, setSheetReady] = useState(() => data != null);
  const sheetReadyRef = useRef(false);
  const idsForTabRef = useRef<(t: TxTab) => string[]>(() => []);

  const load = useCallback(
    (silent = false) => {
      if (!id) return;
      if (!silent) setErr(null);
      void fetch(
        `${getGateway()}/v1/transactions/${encodeURIComponent(id)}`,
        SNAPSHOT_FETCH
      )
        .then(async (r) => {
          if (r.status === 404) throw new Error("not_found");
          if (!r.ok) throw new Error(String(r.status));
          return r.json() as Promise<TxPageSnapshot>;
        })
        .then((j) => {
          const next = asTxData(j);
          if (next) {
            const nextIds = snapIds(next);
            const prevIds = ioIdsRef.current;
            if (prevIds.length) {
              enter.mark(
                enteringIds(
                  prevIds.map((rowId) => ({ id: rowId })),
                  nextIds.map((rowId) => ({ id: rowId }))
                )
              );
            }
            ioIdsRef.current = nextIds;
          }
          setData(next);
          setErr(null);
          markSynced();
        })
        .catch((e) => {
          if (!silent) setErr(String(e));
        });
    },
    [id, markSynced, enter.mark]
  );

  const loadRef = useRef(load);
  loadRef.current = load;

  useKeepFresh((silent) => {
    void loadRef.current(silent);
  });

  useEffect(() => {
    if (initial) {
      markSynced();
      return;
    }
    loadRef.current();
  }, [id, initial, markSynced]);

  useEffect(() => {
    const onHash = () => {
      const next = readTxTab();
      setTab((prev) => {
        if (prev !== next && sheetReadyRef.current) {
          enter.mark(idsForTabRef.current(next));
        }
        return next;
      });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [id, enter.mark]);

  const inputs = (data?.inputs ?? []) as TxIo[];
  const outputs = (data?.outputs ?? []) as TxIo[];
  const feeNano = toBigIntAmt(data?.fee);
  const feeIdx = useMemo(() => markFeeOutputIndexes(outputs, feeNano), [outputs, feeNano]);
  const sources = useMemo(() => groupParties(inputs, feeIdx, "in"), [inputs, feeIdx]);
  const dests = useMemo(() => groupParties(outputs, feeIdx, "out"), [outputs, feeIdx]);
  const fromParties = sources.filter((p) => !p.isFee);
  const toParties = dests.filter((p) => !p.isFee);
  const feeParties = dests.filter((p) => p.isFee);
  const tokens = useMemo(() => metaMap(data?.tokenMeta), [data?.tokenMeta]);
  const chipMeta = useCallback(
    (tid: string): FeedTokenMeta | undefined => {
      const m = tokens.get(tid.toLowerCase());
      return m ? { name: m.name, decimals: tokenDecimals(tid, m.decimals) } : undefined;
    },
    [tokens]
  );
  const feeFromBoxes = feeParties.reduce((s, p) => s + p.erg, 0n);
  const feeShown = feeNano > 0n ? feeNano : feeFromBoxes;

  const inSum = sumIo(inputs);
  const outSum = sumIo(outputs);
  const amountFromBoxes = outputs.reduce(
    (s, o, i) => (feeIdx.has(i) ? s : s + toBigIntAmt(o.value)),
    0n
  );
  const storedOut = toBigIntAmt(data?.valueNano);
  const amountNano =
    amountFromBoxes > 0n
      ? amountFromBoxes
      : storedOut > feeNano
        ? storedOut - feeNano
        : storedOut;
  const ranked = useMemo(() => rankTokens(inputs, outputs), [inputs, outputs]);
  const idsForTab = useCallback(
    (idTab: TxTab) =>
      tabEnterIds(idTab, fromParties, toParties, feeParties, inputs, outputs, ranked),
    [fromParties, toParties, feeParties, inputs, outputs, ranked]
  );
  idsForTabRef.current = idsForTab;

  useLayoutEffect(() => {
    if (!data || sheetReadyRef.current) return;
    const next = readTxTab();
    sheetReadyRef.current = true;
    enter.mark(idsForTab(next));
    setTab(next);
    setSheetReady(true);
  }, [data, idsForTab, enter.mark]);
  const mix = useMemo((): TxBallSeed[] => {
    const seeds: TxBallSeed[] = [
      {
        id: "erg",
        size: mixWeight(amountNano, 420, 2200),
        color: INK.cyan,
        href: null,
        title: "ERG",
        kind: "circle",
      },
    ];
    if (feeShown > 0n) {
      seeds.push({
        id: "fee",
        size: mixWeight(feeShown, 140, 480),
        color: INK.gold,
        href: null,
        title: t("tx.fee"),
        kind: "circle",
      });
    }
    for (const [i, tok] of ranked.slice(0, 8).entries()) {
      const w = tok.inAmt > tok.outAmt ? tok.inAmt : tok.outAmt;
      seeds.push({
        id: tok.tokenId,
        size: mixWeight(w, 200, 900),
        color: TOKEN_INK[i % TOKEN_INK.length] ?? INK.violet,
        href: `/token/${tok.tokenId}`,
        title: tokenSymbol(tok.tokenId, tokens.get(tok.tokenId)?.name) || shortId(tok.tokenId, 4),
        kind: "hex",
      });
    }
    return seeds;
  }, [amountNano, feeShown, ranked, tokens, t]);

  const rentChip = data?.category === "rent" || data?.category === "rent-renew";
  const lockId =
    data && !rentChip
      ? lockIdFromIo(inputs, outputs, (data.dataInputs ?? []) as TxIo[]) ??
        data.ball?.platform ??
        null
      : null;
  const lockLabel = lockCaption(lockId, t);
  const chip =
    data != null
      ? txChipCaption(data.category, lockId, rentChip ? null : data.action, t)
      : "";
  const catColor =
    data?.ball?.color ||
    CATEGORY_COLORS[(data?.category as keyof typeof CATEGORY_COLORS) ?? "unknown"] ||
    "#64748B";
  const isCoinbase = data?.indexInBlock === 0 || data?.category === "coinbase";
  const height = data?.inclusionHeight ?? null;
  const index = data?.indexInBlock ?? null;
  const feeRate =
    feeShown > 0n && data && data.size > 0 ? Number(feeShown) / data.size : 0;
  const declaredIn = data?.inputCount ?? null;
  const declaredOut = data?.outputCount ?? null;
  const partialIn = declaredIn != null && declaredIn > inputs.length;
  const partialOut = declaredOut != null && declaredOut > outputs.length;
  const blockHref = data?.blockId
    ? `/block/${data.blockId}`
    : height != null
      ? `/block/${height}`
      : null;
  const dash = "—";

  return (
    <Shell>
      {err && !data && (
        <p className="text-amber-300">
          {err.includes("not_found") ? t("tx.notInIndex") : `${t("detail.notFound")}: ${err}`}
        </p>
      )}

      {data && (
        <>
          <div className="addr-lane">
            <div className="col-span-2 flex min-h-0 flex-col gap-2 lg:col-span-1 lg:row-span-2">
              <AddrFactCard
                className="min-h-0 h-auto flex-1"
                enter={0}
                label={t("detail.tx")}
                ink={INK.violet}
                aside={
                  <TxBallPit key={id} txs={mix} ariaLabel={t("tx.pit.aria")} />
                }
              >
                <h1 className="mt-0.5 flex min-w-0 items-center gap-1">
                  <code className="min-w-0 shrink truncate font-mono text-[15px] font-semibold leading-none tracking-tight">
                    {shortId(id, 7)}
                  </code>
                  <CopyChip text={id} copyLabel={t("tx.copy")} copiedLabel={t("tx.copied")} />
                  <FavoriteHeart
                    on={txFav.on}
                    ready={txFav.ready}
                    title={txFav.on ? t("favorites.remove") : t("favorites.add")}
                    onToggle={txFav.toggle}
                  />
                </h1>
                <p
                  className="mt-1 flex min-w-0 items-start gap-1.5 text-[12px] leading-snug text-[var(--muted)]"
                  title={chip}
                >
                  <span
                    className="mt-[4px] inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: catColor }}
                  />
                  <span>{chip}</span>
                </p>
              </AddrFactCard>
              <SegBar cols={3} className="shrink-0">
                {TX_TABS.map((idTab) => (
                  <a
                    key={idTab}
                    href={`#${idTab}`}
                    onClick={(e) => {
                      setHashTab(idTab, e);
                      setTab((prev) => {
                        if (prev !== idTab && sheetReadyRef.current) {
                          enter.mark(idsForTabRef.current(idTab));
                        }
                        return idTab;
                      });
                    }}
                    className={segItem(tab === idTab)}
                  >
                    {t(`tx.tab.${idTab}`)}
                  </a>
                ))}
              </SegBar>
            </div>

            <AddrFactCard
              className="col-span-2 overflow-hidden lg:col-span-1 lg:row-span-2"
              enter={1}
              label={t("tx.card.amount")}
              ink={INK.cyan}
              mark={<KpiMark id="erg" />}
            >
              <div className="mt-2">
                <KpiNum>
                  <ErgFigure nano={amountNano} locale={locale} size="lg" />
                </KpiNum>
              </div>
              <div className="mt-2">
                <TxIoMark
                  inputs={inputs.length}
                  outputs={outputs.length}
                  inLabel={t("block.tx.in")}
                  outLabel={t("block.tx.out")}
                />
              </div>
              <p className="mt-1.5 truncate text-[12px] tabular-nums text-[var(--muted)]">
                {formatErgPrecise(inSum, locale, false)}
                <span className="mx-1 text-[var(--muted-2)]">→</span>
                {formatErgPrecise(outSum, locale, false)}
                <span className="ml-1 text-[11px] text-[var(--muted-2)]">ERG</span>
              </p>
            </AddrFactCard>

            <AddrFactCard
              enter={2}
              label={t("tx.fee")}
              ink={INK.gold}
              mark={<KpiMark id="fee" />}
            >
              <p className="mt-0.5 truncate text-[17px] font-semibold leading-none tabular-nums tracking-tight">
                <KpiNum>
                  {formatErgPrecise(feeShown, locale, false)}
                  <span className="ml-1 text-[12px] font-medium text-[var(--muted)]">ERG</span>
                </KpiNum>
              </p>
              <p className="mt-0.5 truncate text-[12px] leading-none text-[var(--muted-2)]">
                {feeShown > 0n && data.size > 0 ? formatFeeRate(feeRate) : "\u00a0"}
              </p>
            </AddrFactCard>

            <AddrFactCard
              enter={3}
              label={t("block.card.size")}
              ink={INK.green}
              mark={<KpiMark id="size" />}
            >
              <p className="mt-0.5 truncate text-[17px] font-semibold leading-none tabular-nums tracking-tight">
                <KpiNum>{data.size ? formatBytes(data.size) : dash}</KpiNum>
              </p>
              <p className="mt-0.5 truncate text-[12px] leading-none text-[var(--muted-2)]">
                {(data.dataInputs?.length ?? 0) > 0
                  ? countText(t, locale, "tx.dataInputs", data.dataInputs?.length ?? 0)
                  : "\u00a0"}
              </p>
            </AddrFactCard>

            <AddrFactCard
              enter={4}
              label={t("detail.block")}
              ink={INK.sky}
              mark={<KpiMark id="block" />}
            >
              <p className="mt-0.5 truncate text-[17px] font-semibold leading-none tabular-nums tracking-tight">
                {data.confirmed && height != null ? (
                  blockHref ? (
                    <KpiNum>
                      <Link prefetch={false} href={blockHref} className="text-accent hover:underline">
                        {height.toLocaleString(loc(locale))}
                      </Link>
                    </KpiNum>
                  ) : (
                    <KpiNum>{height.toLocaleString(loc(locale))}</KpiNum>
                  )
                ) : (
                  <KpiNum>{t("tx.mempool")}</KpiNum>
                )}
              </p>
              {(index != null || !data.confirmed) && (
                <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] leading-none">
                  {index != null ? (
                    <span className="shrink-0 text-[var(--muted-2)]">#{index}</span>
                  ) : (
                    <span className="shrink-0 text-[var(--muted-2)]">{t("tx.unconfirmed")}</span>
                  )}
                </p>
              )}
            </AddrFactCard>

            <AddrFactCard
              enter={5}
              label={t("block.card.time")}
              ink={INK.teal}
              mark={<KpiMark id="time" />}
            >
              <p className="mt-0.5 truncate text-[17px] font-semibold leading-none tabular-nums tracking-tight">
                <KpiNum>
                  {data.timestamp ? formatClockTime(data.timestamp, locale) : dash}
                </KpiNum>
              </p>
              <p className="mt-0.5 truncate text-[12px] leading-none text-[var(--muted-2)]">
                {[
                  data.timestamp ? formatNumericDate(data.timestamp, locale) : null,
                  data.confirmed
                    ? t("tx.confs").replace(
                        "{n}",
                        String(data.numConfirmations ?? 0)
                      )
                    : t("tx.unconfirmed"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </AddrFactCard>
          </div>

          <div className="mt-3">
            <TxExplanationPanel
              tx={data}
              inputs={inputs}
              outputs={outputs}
              protocolLabel={lockLabel}
              tokens={tokens}
            />
          </div>

          {sheetReady && tab === "summary" && (
            <div className="feed-sheet mt-3">
              <Feed className="is-rank">
                {fromParties.length ? (
                  <FeedSection
                    plate={
                      <FeedPlate
                        tag={t("tx.from")}
                        count={<FeedCount k="feed.addresses" n={fromParties.length} />}
                        end={<FeedAmount raw={inSum} />}
                      />
                    }
                  >
                    {fromParties.map((p, i) => (
                      <FeedPartyRow
                        key={p.key}
                        party={p}
                        side="from"
                        meta={chipMeta}
                        rank={i + 1}
                        enterClass={enter.enterClass(p.key)}
                      />
                    ))}
                  </FeedSection>
                ) : (
                  <FeedEmpty
                    k={isCoinbase ? "reward" : "quiet"}
                    title={isCoinbase ? t("tx.cat.coinbase") : t("tx.noIo")}
                    plate={<FeedPlate tag={t("tx.from")} />}
                  />
                )}
                {toParties.length || feeParties.length ? (
                  <FeedSection
                    plate={
                      <FeedPlate
                        tag={t("tx.to")}
                        count={<FeedCount k="feed.addresses" n={toParties.length + feeParties.length} />}
                        end={<FeedAmount raw={outSum} />}
                      />
                    }
                  >
                    {toParties.map((p, i) => (
                      <FeedPartyRow
                        key={p.key}
                        party={p}
                        side="to"
                        meta={chipMeta}
                        rank={i + 1}
                        enterClass={enter.enterClass(p.key)}
                      />
                    ))}
                    {feeParties.map((p, i) => (
                      <FeedPartyRow
                        key={p.key}
                        party={p}
                        side="fee"
                        meta={chipMeta}
                        rank={toParties.length + i + 1}
                        enterClass={enter.enterClass(p.key)}
                      />
                    ))}
                  </FeedSection>
                ) : (
                  <FeedEmpty title={t("tx.noIo")} plate={<FeedPlate tag={t("tx.to")} />} />
                )}
              </Feed>
            </div>
          )}

          {sheetReady && tab === "boxes" && (
            <div className="feed-sheet mt-3">
              <Feed className="is-rank">
                <TxBoxSection
                  title={t("tx.sheet.spent")}
                  items={inputs}
                  side="in"
                  meta={chipMeta}
                  enterClass={enter.enterClass}
                  partial={
                    partialIn
                      ? t("tx.ioPartial")
                          .replace("{have}", String(inputs.length))
                          .replace("{want}", String(declaredIn))
                      : null
                  }
                />
                <TxBoxSection
                  title={t("tx.sheet.created")}
                  items={outputs}
                  side="out"
                  meta={chipMeta}
                  enterClass={enter.enterClass}
                  feeIdx={feeIdx}
                  partial={
                    partialOut
                      ? t("tx.ioPartial")
                          .replace("{have}", String(outputs.length))
                          .replace("{want}", String(declaredOut))
                      : null
                  }
                />
              </Feed>
            </div>
          )}

          {sheetReady && tab === "tokens" && (
            <div className="feed-sheet mt-3">
              <Feed className="is-rank">
                {!ranked.length ? (
                  <FeedEmpty k="token" title={t("tx.noTokens")} plate={<FeedPlate tag={t("tx.tab.tokens")} />} />
                ) : (
                  <FeedBoard
                    plate={
                      <FeedPlate tag={t("tx.tab.tokens")} count={<FeedCount k="feed.tokens" n={ranked.length} />} />
                    }
                  >
                    {ranked.map((row, i) => (
                      <TxTokenRow
                        key={row.tokenId}
                        row={row}
                        rank={i + 1}
                        meta={tokens}
                        enterClass={enter.enterClass(`tok-${row.tokenId}`)}
                      />
                    ))}
                  </FeedBoard>
                )}
              </Feed>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

/** Spent or created boxes: index as the lead, owner as the title. */
function TxBoxSection({
  title,
  items,
  side,
  meta,
  enterClass,
  feeIdx,
  partial,
}: {
  title: string;
  items: TxIo[];
  side: "in" | "out";
  meta: (tid: string) => FeedTokenMeta | undefined;
  enterClass: (id: string) => string | undefined;
  feeIdx?: Set<number>;
  partial: string | null;
}) {
  const t = useT();
  const plate = (
    <FeedPlate
      tag={title}
      count={
        <>
          <FeedCount k="feed.boxes" n={items.length} />
          {partial ? <span className="feed-plate-live"> · {partial}</span> : null}
        </>
      }
      end={items.length ? <FeedAmount raw={sumIo(items)} /> : undefined}
    />
  );
  if (!items.length) return <FeedEmpty k="box" title={t("tx.noIo")} plate={plate} />;
  return (
    <FeedSection plate={plate}>
      {items.map((io, i) => (
        <FeedBoxRow
          key={ioKey(io, i, side)}
          boxId={io.boxId}
          nano={toBigIntAmt(io.value)}
          tokens={(io.assets ?? [])
            .filter((a) => a.tokenId && !/^0+$/.test(a.tokenId))
            .map((a) => [a.tokenId.toLowerCase(), toBigIntAmt(a.amount)] as [string, bigint])}
          meta={meta}
          lead={{ rank: String(io.index ?? i) }}
          side={side}
          owner={io.address ?? null}
          fee={!!feeIdx?.has(i)}
          height={io.creationHeight}
          enterClass={enterClass(ioKey(io, i, side))}
        />
      ))}
    </FeedSection>
  );
}

/** A token the transaction moved: what came out on top, what went in under it. */
function TxTokenRow({
  row,
  rank,
  meta,
  enterClass,
}: {
  row: TokenRank;
  rank: number;
  meta: Map<string, TxTokenMeta>;
  enterClass?: string;
}) {
  const t = useT();
  const m = meta.get(row.tokenId);
  const dec = tokenDecimals(row.tokenId, m?.decimals);
  const minted = row.inAmt === 0n && row.outAmt > 0n;
  const burned = row.outAmt === 0n && row.inAmt > 0n;
  const partBurn = !burned && row.outAmt < row.inAmt;
  return (
    <FeedHoldingRow
      tokenId={row.tokenId}
      name={m?.name ?? null}
      decimals={dec}
      amount={row.outAmt > 0n ? row.outAmt : -row.inAmt}
      signed
      lead={{ rank: String(rank) }}
      enterClass={enterClass}
      facts={
        minted ? (
          <span className="feed-kind">{t("tx.minted")}</span>
        ) : burned || partBurn ? (
          <span className="feed-kind">{t("tx.burned")}</span>
        ) : null
      }
      sub={
        row.outAmt > 0n && row.inAmt > 0n ? (
          <FeedAmount raw={-row.inAmt} decimals={dec} unit={null} signed glance />
        ) : null
      }
      more={() =>
        row.inAmt > 0n && row.outAmt > 0n ? (
          <FeedField label={t("tx.sheet.spent")}>
            <FeedAmount raw={-row.inAmt} decimals={dec} unit={null} signed />
          </FeedField>
        ) : null
      }
    />
  );
}

function ErgFigure({
  nano,
  locale,
  signed = false,
  size = "md",
  tone,
}: {
  nano: bigint;
  locale?: string;
  signed?: boolean;
  size?: "md" | "lg";
  tone?: "up" | "down" | "gold";
}) {
  const sign = signed ? (nano > 0n ? "+" : nano < 0n ? "−" : "") : "";
  const core = formatErgPrecise(nano < 0n ? -nano : nano, locale, false);
  const dot = core.lastIndexOf(".");
  const intPart = dot === -1 ? core : core.slice(0, dot);
  const frac = dot === -1 ? null : core.slice(dot);
  return (
    <span
      className={clsx(
        "inline-block whitespace-nowrap tabular-nums tracking-tight",
        tone === "up"
          ? "text-[var(--up)]"
          : tone === "down"
            ? "text-[var(--down)]"
            : tone === "gold"
              ? null
              : "text-[var(--text)]"
      )}
      style={tone === "gold" ? { color: INK.gold } : undefined}
    >
      {sign}
      <span className={size === "lg" ? "text-[28px] font-semibold leading-none" : "text-[15px] font-medium"}>
        {intPart}
        {frac}
      </span>
      <span
        className={clsx(
          "ml-1 font-medium",
          size === "lg" ? "text-[13px]" : "text-[12px]",
          tone === "gold" ? "opacity-90" : tone ? "opacity-70" : "text-[var(--muted)]"
        )}
      >
        ERG
      </span>
    </span>
  );
}

function CopyChip({
  text,
  copyLabel,
  copiedLabel,
  inherit,
}: {
  text: string;
  copyLabel: string;
  copiedLabel: string;
  inherit?: boolean;
}) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setOk(true);
          window.setTimeout(() => setOk(false), 1200);
        });
      }}
      className={clsx(
        "chip-press inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-[6px] transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--wash)]",
        inherit ? "text-inherit hover:text-inherit" : "text-[var(--muted)] hover:text-[var(--text)]"
      )}
      aria-label={ok ? copiedLabel : copyLabel}
    >
      {ok ? (
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
  );
}
