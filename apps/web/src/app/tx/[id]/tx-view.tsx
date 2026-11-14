"use client";

import { pageInk } from "@/lib/look";
import { isLightInk } from "@/lib/skin-ink";
import { useInk } from "@/lib/use-ink";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { CATEGORY_COLORS, type TxMeaning } from "@ergoscan/shared";
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
import { INK, DONUT_SLICES, INK_HEX, INK_TEXT } from "@/lib/palette";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { countText } from "@/lib/i18n/messages";
import { useFavoriteOf } from "@/lib/favorites";
import { readHashTab, setHashTab } from "@/lib/hash-tab";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";
import { say } from "@/lib/kayolo/events";
import { chainAwait, chainListen } from "@/lib/kayolo/chain-sense";
import {
  confirmationsAwait,
  confirmationsEvent,
  confirmationsLive,
  rereads,
  sealCarries,
  sealDoubts,
} from "@/lib/kayolo/page-data";
import { GONE_REREAD_MS, REREAD_PAUSES_MS } from "@/lib/kayolo/thresholds";
import { ENTER_MS, SNAPSHOT_FETCH, enteringIds, useEnterIds } from "@/lib/keyed-enter";
import { paintTxSnapshot } from "@/lib/tx-shape-paint";
import { parseFullMeaning } from "@/lib/tx-meaning-row";
import { CopyChip } from "./CopyChip";
import { TxExplanationPanel } from "./TxExplanationPanel";
import { TxMeaningHeader } from "./TxMeaningHeader";

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
  const light = isLightInk(useInk());
  const txFav = useFavoriteOf("transactions", id);
  const { locale } = useI18n();
  const { markSynced, tip } = usePageSync();
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

  /** Resolves with what it read (null: not found or failed), for the one re-read after a `gone`. */
  const load = useCallback(
    (silent = false): Promise<TxPageSnapshot | null> | undefined => {
      if (!id) return;
      if (!silent) setErr(null);
      return fetch(
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
          return next;
        })
        .catch((e) => {
          if (!silent) setErr(String(e));
          return null;
        });
    },
    [id, markSynced, enter.mark]
  );

  const loadRef = useRef(load);
  loadRef.current = load;

  // A mempool tx: the mempool's own record names the parties better and says when the node saw it.
  const [pool, setPool] = useState<{ meaning?: TxMeaning; firstSeen?: number } | null>(null);
  const unconfirmed = data != null && !data.confirmed;
  useEffect(() => {
    if (!unconfirmed || !id) return;
    const ctl = new AbortController();
    void fetch(`${getGateway()}/v1/mempool/${encodeURIComponent(id)}`, { ...SNAPSHOT_FETCH, signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ meaning?: unknown; firstSeen?: unknown }>) : null))
      .then((j) => {
        if (!j) return;
        setPool({
          meaning: parseFullMeaning(j.meaning),
          firstSeen: typeof j.firstSeen === "number" ? j.firstSeen : undefined,
        });
      })
      .catch(() => {});
    return () => ctl.abort();
  }, [id, unconfirmed]);

  useKeepFresh((silent) => {
    void loadRef.current(silent);
  });

  // «Твоя tx в блоке» (Kayolo Э4, §6.4): the seal that carries this tx comes before the index knows
  // the block, so the page re-reads with pauses 1–2–3–4–5 s (≤ 15 s, each + 0–400 ms) until it says
  // «in a block». A block not read (a partial seal, a tip without its seal) may carry it: the same
  // re-reads, but that block's E1 does not wait. No request on any other block, none on a hidden tab
  // (showing it re-reads once). The test for E1 is pure; the re-reads start from the listener.
  // The tx left the pool without a seal that carried it (evicted, double-spent): one re-read, and
  // the «думает» face goes — nothing is coming for it. It comes back when that re-read still finds
  // the tx unconfirmed, or when the tx enters the pool again.
  const [goneId, setGoneId] = useState<string | null>(null);
  const dropped = goneId === id;
  useEffect(() => {
    if (!unconfirmed || !id) return;
    const r = rereads(() => loadRef.current(true));
    const back = () => setGoneId((x) => (x === id ? null : x));
    const g = rereads(() => {
      void loadRef.current(true)?.then((next) => {
        if (next && !next.confirmed) back();
      });
    });
    let carried = false;
    const offHold = chainAwait((s) => sealCarries(s, id) === "yes");
    const off = chainListen((n) => {
      if (n.k === "added") {
        if (n.id === id) back();
        return;
      }
      if (n.k === "gone") {
        if (n.id !== id || carried) return;
        setGoneId(id);
        if (!r.busy() && !g.busy()) g.start([GONE_REREAD_MS]);
        return;
      }
      const c = sealCarries(n, id);
      if (c === "no") return;
      if (c === "yes") {
        // The seal that names it: the whole chain, even over a shorter one already running.
        if (!carried) r.start(REREAD_PAUSES_MS);
        carried = true;
        return;
      }
      if (!r.busy()) r.start(REREAD_PAUSES_MS);
    });
    return () => {
      offHold();
      off();
      r.stop();
      g.stop();
    };
  }, [id, unconfirmed]);

  // A fork replaced the block this page shows (§12.23): no «в блоке» and no milestone nods for that
  // block. The page re-reads as after a seal until the index names the block the chain kept, and
  // once more on each later seal while it still names the replaced one.
  const [goneBlocks, setGoneBlocks] = useState<readonly string[]>([]);
  const shownBlock = data?.confirmed ? (data.blockId ?? null) : null;
  const shownHeight = data?.confirmed ? (data.inclusionHeight ?? null) : null;
  const doubt = shownBlock != null && goneBlocks.includes(shownBlock);
  const doubtRef = useRef(doubt);
  doubtRef.current = doubt;
  useEffect(() => {
    if (!id || shownBlock == null || shownHeight == null) return;
    const r = rereads(() => loadRef.current(true));
    const off = chainListen((n) => {
      if (n.k !== "seal") return;
      if (sealDoubts(n, shownHeight, shownBlock)) {
        setGoneBlocks((xs) => (xs.includes(shownBlock) ? xs : [...xs.slice(-7), shownBlock]));
        r.start(REREAD_PAUSES_MS);
      } else if (doubtRef.current && !n.replaced && !r.busy()) r.start([GONE_REREAD_MS]);
    });
    return () => {
      off();
      r.stop();
    };
  }, [id, shownBlock, shownHeight]);

  // The page showed «confirmed» while it was open: his act is by the data, not by the event. A
  // block a fork replaced counts as not confirmed.
  const wasPending = useRef<boolean | null>(null);
  const favOn = txFav.on;
  useEffect(() => {
    if (!data) return;
    const was = wasPending.current;
    const pendingNow = !data.confirmed || doubt;
    wasPending.current = pendingNow;
    if (was === true && !pendingNow && data.inclusionHeight != null) {
      say({ k: "page:tx-confirmed", txId: id, height: data.inclusionHeight, ...(favOn ? { fav: true } : {}) });
    }
  }, [data, doubt, id, favOn]);

  // In the mempool: a still think, the eyes on the «mempool» field (§6.4).
  useEffect(() => {
    if (!unconfirmed || dropped) return;
    const el = document.querySelector('[data-kayolo="tx-pending"]');
    say({ k: "page:think", on: true, el });
    return () => say({ k: "page:think", on: false });
  }, [unconfirmed, dropped]);

  useEffect(() => {
    if (err?.includes("not_found") && !data) say({ k: "page:miss" });
  }, [err, data]);

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
        color: INK_HEX.cyan,
        href: null,
        title: "ERG",
        kind: "circle",
      },
    ];
    if (feeShown > 0n) {
      seeds.push({
        id: "fee",
        size: mixWeight(feeShown, 140, 480),
        color: INK_HEX.gold,
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
        color: TOKEN_INK[i % TOKEN_INK.length] ?? INK_HEX.violet,
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
  // Confirmations follow the live tip (no request): tip − inclusion + 1, never below the snapshot.
  const liveConf = data?.confirmed ? confirmationsLive(data.numConfirmations ?? null, height, tip?.height ?? null) : null;
  // Kayolo nods for confirmations 2…10, by the number on the page (/tx counts the inclusion block:
  // tip − h + 1); that block's E1 waits for it. None for a block a fork replaced.
  const nodConf = doubt ? null : liveConf;
  const confSeen = useRef<number | null>(null);
  const tipHeight = tip?.height ?? null;
  useEffect(() => {
    const prev = confSeen.current;
    confSeen.current = nodConf;
    const ev = confirmationsEvent("tx", prev, nodConf, tipHeight);
    if (ev) say(ev);
  }, [nodConf, tipHeight]);
  const confAwait = confirmationsAwait("tx", nodConf);
  useEffect(() => (confAwait ? chainAwait(() => true) : undefined), [confAwait]);
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
  const meaning = useMemo(
    () => (data && !data.confirmed && pool?.meaning) || parseFullMeaning(data?.meaning),
    [data, pool]
  );

  const tabBar = (
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
  );

  return (
    <Shell>
      {err && !data && (
        <p className="text-amber-300">
          {err.includes("not_found") ? t("tx.notInIndex") : `${t("detail.notFound")}: ${err}`}
        </p>
      )}

      {data && meaning && (
        <>
          <TxMeaningHeader
            id={id}
            meaning={meaning}
            feeNano={data.fee != null ? String(data.fee) : null}
            fav={txFav}
            facts={{
              confirmed: data.confirmed,
              height,
              index,
              blockHref,
              timestamp: data.timestamp ?? (data.confirmed ? null : pool?.firstSeen ?? null),
              confirmations: liveConf,
              size: data.size,
              inputs: declaredIn ?? inputs.length,
              outputs: declaredOut ?? outputs.length,
              dataInputs: data.dataInputs?.length ?? 0,
            }}
          />
          <div className="txm-tabs mt-3">{tabBar}</div>
        </>
      )}

      {data && !meaning && (
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
                <p className="mt-1 flex min-w-0 items-start gap-1.5 text-[12px] leading-snug text-[var(--muted)]">
                  <span
                    className="mt-[4px] inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: pageInk(catColor, light) }}
                  />
                  <span>{chip}</span>
                </p>
              </AddrFactCard>
              {tabBar}
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
                      <Link prefetch={false} href={blockHref} className="text-accent hover:underline" data-kayolo="block-link">
                        {height.toLocaleString(loc(locale))}
                      </Link>
                    </KpiNum>
                  ) : (
                    <KpiNum>{height.toLocaleString(loc(locale))}</KpiNum>
                  )
                ) : (
                  <span data-kayolo="tx-pending">
                    <KpiNum>{t("tx.mempool")}</KpiNum>
                  </span>
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
              <p
                className="mt-0.5 truncate text-[12px] leading-none text-[var(--muted-2)]"
                data-kayolo={data.confirmed ? "confirmations" : undefined}
              >
                {[
                  data.timestamp ? formatNumericDate(data.timestamp, locale) : null,
                  data.confirmed
                    ? t("tx.confs").replace(
                        "{n}",
                        String(liveConf ?? 0)
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
        </>
      )}

      {data && (
        <>
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
          templateHash={io.templateHash}
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
      style={tone === "gold" ? { color: INK_TEXT.gold } : undefined}
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
          tone === "gold" ? "word-dim opacity-90" : tone ? "word-dim opacity-70" : "text-[var(--muted)]"
        )}
      >
        ERG
      </span>
    </span>
  );
}
