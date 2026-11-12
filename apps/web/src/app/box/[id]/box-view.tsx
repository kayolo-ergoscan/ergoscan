"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  classifyBoxLock,
  decodeRegisterMap,
  decodeSigmaConstantMap,
  ergUsdFromOracleRegisters,
} from "@ergoscan/shared";
import { Shell } from "@/components/Shell";
import { AddrFactCard } from "@/components/AddrFactCard";
import { SegBar, segItem } from "@/components/SegBar";
import { KpiMark } from "@/components/kpi-marks";
import { KpiNum } from "@/components/KpiGrid";
import { Feed, FeedBoard, FeedCount, FeedEmpty, FeedPlate } from "@/components/feed/Feed";
import { FeedHoldingRow } from "@/components/feed/FeedBoxRow";
import { PrettyUsd } from "@/components/PrettyNum";
import { ListWhen } from "@/components/ListWhen";
import { getGateway } from "@/lib/config";
import { fetchChainStats } from "@/lib/chain-stats";
import { fetchErgUsd } from "@/lib/list-snapshots";
import {
  formatBytes,
  formatErgPrecise,
  nanoToUsd,
  shortId,
  toBigIntAmt,
  tokenAmountToUsd,
} from "@/lib/format";
import { describeParty } from "@/lib/address-labels";
import { lockCaption } from "@/lib/tx-lock";
import { INK } from "@/lib/palette";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { countText } from "@/lib/i18n/messages";
import { readHashTab, setHashTab } from "@/lib/hash-tab";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";
import { SNAPSHOT_FETCH, useEnterIds } from "@/lib/keyed-enter";
import { meaningLang } from "@/components/feed/FeedMeaning";
import { parseMeaning } from "@/lib/tx-meaning-row";
import { meaningRow, type CompactMeaning } from "@ergoscan/shared";
import type { BoxAsset, BoxRegisterTyped, BoxSnapshot } from "@/lib/list-snapshots";

const BOX_TABS = ["summary", "tokens", "registers"] as const;
type BoxTab = (typeof BOX_TABS)[number];
const TOKEN_FETCH_CAP = 24;
const BLOCKS_PER_YEAR = 262_980;
const BLOCKS_PER_DAY = 720;
const REG_BANK = ["R4", "R5", "R6", "R7", "R8", "R9"] as const;

type TokenInfo = {
  decimals: number;
  name: string | null;
  symbol: string | null;
  priceUsd: number | null;
};

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function asNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function registerEntries(regs: Record<string, string | null> | undefined): [string, string][] {
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const k of REG_BANK) {
    const v = regs?.[k];
    if (v) {
      out.push([k, v]);
      seen.add(k);
    }
  }
  for (const [k, v] of Object.entries(regs ?? {})) {
    if (seen.has(k) || !v) continue;
    out.push([k, v]);
  }
  return out;
}

function formatHorizon(blocks: number | null, locale: string, t: (k: string) => string): string {
  if (blocks == null) return "—";
  if (blocks <= 0) return t("rent.cap.now");
  if (blocks < 2000) {
    return countText(t, locale, "rent.status.inBlocks", blocks, blocks.toLocaleString(loc(locale)));
  }
  const years = blocks / BLOCKS_PER_YEAR;
  if (years >= 1) return `~${years.toFixed(1)}y`;
  const days = Math.max(1, Math.round(blocks / BLOCKS_PER_DAY));
  return `~${days}d`;
}

function assetKey(a: BoxAsset, i: number): string {
  return a.tokenId || `tok-${i}`;
}

function periodFillPct(rent: NonNullable<BoxSnapshot["rent"]>): number {
  if (rent.storagePeriodBlocks <= 0 || rent.ageBlocks == null) return 0;
  if (rent.rentDue) return 100;
  const rem =
    ((rent.ageBlocks % rent.storagePeriodBlocks) + rent.storagePeriodBlocks) %
    rent.storagePeriodBlocks;
  return (rem / rent.storagePeriodBlocks) * 100;
}

function eip4Readable(
  d: { text: string | null; kind: string } | undefined,
  typed: BoxRegisterTyped | undefined
): boolean {
  if (!d?.text || d.kind === "hex") return false;
  const clean =
    d.kind === "url" ||
    d.kind === "json" ||
    !/[\u0000-\u001F\u007F\uFFFD]/.test(d.text);
  if (!clean) return false;
  return !typed?.sigmaType || typed.sigmaType === "Coll[SByte]" || typed.sigmaType === "Hex";
}

export function BoxView({
  id,
  initial,
}: {
  id: string;
  initial: BoxSnapshot | null;
}) {
  const t = useT();
  const { locale } = useI18n();
  const { markSynced } = usePageSync();
  const enter = useEnterIds();
  const [data, setData] = useState<BoxSnapshot | null>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initial);
  const [tip, setTip] = useState<number | null>(null);
  const [ergUsd, setErgUsd] = useState<number | null>(null);
  const [tokenInfo, setTokenInfo] = useState<Map<string, TokenInfo>>(new Map());
  const [tab, setTab] = useState<BoxTab>("summary");
  const [sheetReady, setSheetReady] = useState(false);
  const [openFlap, setOpenFlap] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const sheetReadyRef = useRef(false);

  const load = useCallback(
    (silent = false) => {
      if (!id) return;
      if (!silent) setErr(null);
      const gw = getGateway();
      void fetch(`${gw}/v1/boxes/${encodeURIComponent(id)}`, SNAPSHOT_FETCH)
        .then(async (r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json() as Promise<BoxSnapshot>;
        })
        .then((j) => {
          if (j?.boxId) setData(j);
          markSynced();
        })
        .catch((e) => {
          if (!silent) setErr(String(e));
        })
        .finally(() => setLoading(false));
      void fetchErgUsd().then((usd) => {
        if (usd != null && usd > 0) setErgUsd(usd);
      });
      void fetchChainStats().then((s) => setTip(s?.height ?? null));
    },
    [id, markSynced]
  );

  useKeepFresh(load);

  useEffect(() => {
    load(true);
  }, [load]);

  useEffect(() => {
    if (!data?.assets?.length) return;
    let cancelled = false;
    void loadTokenInfos(data.assets.map((a) => a.tokenId)).then((m) => {
      if (!cancelled) setTokenInfo(m);
    });
    return () => {
      cancelled = true;
    };
  }, [data]);

  const assets = data?.assets ?? [];
  const regs = useMemo(() => registerEntries(data?.registers), [data]);
  const decoded = useMemo(() => decodeRegisterMap(data?.registers ?? {}), [data]);
  const typedRegs = useMemo(() => {
    if (data?.registersTyped && Object.keys(data.registersTyped).length) {
      return data.registersTyped;
    }
    return decodeSigmaConstantMap(data?.registers ?? {});
  }, [data]);
  const extraRegs = useMemo(
    () => regs.filter(([k]) => !(REG_BANK as readonly string[]).includes(k)),
    [regs]
  );
  const treeConsts = data?.treeConstants ?? [];
  const spent = Boolean(data?.spentTransactionId);
  // What the txs that made and spent the box did, in the list form the gateway puts on the box.
  const createdWord = useMemo(() => parseMeaning(data?.creationMeaning), [data?.creationMeaning]);
  const spentWord = useMemo(() => parseMeaning(data?.spentMeaning), [data?.spentMeaning]);
  const mempool = data?.source === "mempool";
  const inclusion = asNum(data?.inclusionHeight) ?? asNum(data?.settlementHeight);
  const creation = asNum(data?.creationHeight);
  const settled = asNum(data?.settlementHeight) ?? inclusion;
  const spentHeight = asNum(data?.spentHeight);
  const heightSplit = creation != null && settled != null && settled !== creation;
  const aligned = creation != null && settled != null && settled === creation && !mempool;
  const offsetDelta = heightSplit ? Math.abs(settled! - creation!) : null;
  const confs =
    !spent && !mempool && tip != null && inclusion != null
      ? Math.max(0, tip - inclusion)
      : null;
  const usd = data ? nanoToUsd(toBigIntAmt(data.value), ergUsd) : null;
  const party = describeParty(data?.address);
  const lock = data
    ? classifyBoxLock({
        address: data.address,
        ergoTree: data.ergoTree,
        assets: assets.map((a) => ({ tokenId: a.tokenId, amount: String(a.amount) })),
      })
    : null;
  const lockLabel = lockCaption(lock?.id, t);
  const typeLabel = t(`address.type.${party.kind}`);
  const issuance = assets.some(
    (a) => a.tokenId && a.tokenId.toLowerCase() === id.toLowerCase()
  );
  const oracleUsd = data ? ergUsdFromOracleRegisters(data.registers) : null;

  const tabIds = useCallback(
    (idTab: BoxTab) => {
      if (idTab === "tokens") return assets.map((a, i) => assetKey(a, i));
      if (idTab === "registers") return [...REG_BANK, ...extraRegs.map(([k]) => k)];
      return ["owner", "inclusion", "tree"];
    },
    [assets, extraRegs]
  );

  useLayoutEffect(() => {
    if (!data || sheetReadyRef.current) return;
    const next = readHashTab(BOX_TABS, "summary");
    sheetReadyRef.current = true;
    setTab(next);
    setSheetReady(true);
  }, [data]);

  useEffect(() => {
    setOpenFlap(null);
  }, [tab]);

  const dash = "—";
  const rent = data?.rent ?? null;
  const lifeInk = spent ? INK.sky : rent?.rentDue ? INK.gold : INK.teal;
  const fusePct = rent ? periodFillPct(rent) : 0;
  const statusBits = [
    mempool ? t("box.mempool") : spent ? t("box.spent") : t("box.unspent"),
    party.known,
  ].filter(Boolean);

  return (
    <Shell>
      {loading && !data && <BoxPageGhost />}
      {err && !data && (
        <p className="text-amber-300">
          {t("detail.notFound")}: {err}
        </p>
      )}
      {!loading && !data && !err && (
        <p className="text-amber-300">{t("detail.notFound")}</p>
      )}

      {data && (
        <>
          <div className="box-sheet">
            <div className="box-id">
              <AddrFactCard
                className="min-h-0 h-auto flex-1"
                enter={0}
                label={t("detail.box")}
                ink={INK.violet}
                mark={<KpiMark id="box" />}
              >
                <h1 className="mt-0.5 flex min-w-0 items-center gap-1">
                  <code className="min-w-0 truncate font-mono text-[17px] font-semibold leading-none tracking-tight">
                    {shortId(id, 8)}
                  </code>
                  <CopyChip text={id} copyLabel={t("tx.copy")} copiedLabel={t("tx.copied")} />
                </h1>
                <p
                  className="mt-1 flex min-w-0 items-start gap-1.5 text-[12px] leading-snug text-[var(--muted)]"
                  title={statusBits.join(" · ")}
                >
                  <span
                    className="mt-[4px] inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      background: spent
                        ? "var(--muted)"
                        : mempool
                          ? INK.gold
                          : "var(--up)",
                    }}
                  />
                  <span className="min-w-0 truncate">{statusBits.join(" · ")}</span>
                </p>
              </AddrFactCard>
              <SegBar cols={3} className="shrink-0">
                {BOX_TABS.map((idTab) => (
                  <a
                    key={idTab}
                    href={`#${idTab}`}
                    onClick={(e) => {
                      setHashTab(idTab, e);
                      setTab((prev) => {
                        if (prev !== idTab && sheetReadyRef.current) {
                          enter.mark(tabIds(idTab));
                        }
                        return idTab;
                      });
                    }}
                    className={segItem(tab === idTab)}
                  >
                    {t(`box.tab.${idTab}`)}
                  </a>
                ))}
              </SegBar>
            </div>

            <AddrFactCard
              className="box-created"
              enter={2}
              label={t("box.creationHeight")}
              ink={heightSplit ? INK.gold : aligned ? INK.teal : INK.sky}
              mark={<KpiMark id="height" />}
            >
              <p className="mt-0.5 truncate text-[17px] font-semibold leading-none tabular-nums tracking-tight">
                {creation != null ? (
                  <KpiNum>
                    <Link
                      prefetch={false}
                      href={`/block/${creation}`}
                      className="hover:underline"
                      style={{ color: heightSplit ? INK.gold : aligned ? INK.teal : INK.sky }}
                    >
                      {creation.toLocaleString(loc(locale))}
                    </Link>
                  </KpiNum>
                ) : (
                  <KpiNum>{mempool ? t("box.mempool") : dash}</KpiNum>
                )}
              </p>
              <p className="mt-1 truncate text-[12px] leading-snug text-[var(--muted-2)]">
                {mempool
                  ? t("box.offset.unsettled")
                  : heightSplit && settled != null
                    ? t("box.offset.seated").replace("{n}", settled.toLocaleString(loc(locale)))
                    : "\u00a0"}
              </p>
            </AddrFactCard>

            <AddrFactCard
              className="box-value"
              enter={1}
              label={t("box.card.value")}
              ink={INK.cyan}
              mark={<KpiMark id="erg" />}
            >
              <div className="mt-0.5">
                <KpiNum>
                  <ErgFigure nano={toBigIntAmt(data.value)} locale={locale} />
                </KpiNum>
                {usd != null ? (
                  <p className="mt-1 text-[12px] leading-none text-[var(--muted)]">
                    <PrettyUsd n={usd} />
                  </p>
                ) : (
                  <p className="mt-1 text-[12px] leading-none text-[var(--muted-2)]">{"\u00a0"}</p>
                )}
              </div>
            </AddrFactCard>

            <AddrFactCard
              className="box-until"
              enter={3}
              label={spent ? t("box.spent") : t("box.untilRent")}
              ink={lifeInk}
              mark={<KpiMark id="due-day" />}
            >
              <p className="mt-0.5 truncate text-[17px] font-semibold leading-none tabular-nums tracking-tight">
                {spent && spentHeight != null ? (
                  <KpiNum>
                    <Link prefetch={false} href={`/block/${spentHeight}`} className="text-accent hover:underline">
                      {spentHeight.toLocaleString(loc(locale))}
                    </Link>
                  </KpiNum>
                ) : spent && data.spentTransactionId ? (
                  <KpiNum>
                    <Link
                      prefetch={false}
                      href={`/tx/${data.spentTransactionId}`}
                      className="font-mono text-[15px] text-accent hover:underline"
                    >
                      {shortId(data.spentTransactionId, 6)}
                    </Link>
                  </KpiNum>
                ) : (
                  <KpiNum>{formatHorizon(rent?.blocksUntilRent ?? null, locale, t)}</KpiNum>
                )}
              </p>
              <p className="mt-0.5 truncate text-[12px] leading-none text-[var(--muted-2)]">
                {rent?.ageYears != null && rent.ageYears >= 0.01
                  ? `${t("box.ageYears")} ${rent.ageYears.toFixed(2)}`
                  : "\u00a0"}
              </p>
              {!spent && rent ? (
                <div className="box-rent-track is-mini" style={{ color: lifeInk }}>
                  <i style={{ width: `${fusePct}%` }} />
                </div>
              ) : null}
            </AddrFactCard>

            <AddrFactCard
              className="box-rent"
              enter={4}
              label={t("box.tab.rent")}
              ink={lifeInk}
              mark={<KpiMark id="rent" />}
            >
              {rent ? (
                <>
                  <p className="text-[12px] leading-none text-[var(--muted-2)]">
                    {data.rentAsOf === "spend" ? t("box.asOfSpend") : t("box.asOfTip")}
                  </p>
                  <div className="box-fact-grid mt-2">
                    <Fact k={t("box.periods")} v={String(rent.periodsElapsed)} />
                    <Fact
                      k={t("box.ageBlocks")}
                      v={rent.ageBlocks != null ? rent.ageBlocks.toLocaleString(loc(locale)) : dash}
                    />
                    <Fact
                      k={t("blocks.size")}
                      v={rent.sizeBytes != null ? formatBytes(rent.sizeBytes) : dash}
                    />
                    <Fact
                      k={t("box.minValue")}
                      v={rent.minValueNano != null ? formatErgPrecise(rent.minValueNano, locale) : dash}
                      note={rent.belowMinValue ? t("box.belowMin") : undefined}
                    />
                  </div>
                  {rent.estimatedRentNano != null ? (
                    <p className="mt-2 text-[12px] tabular-nums text-[var(--muted)]">
                      {t("box.estRent")} {formatErgPrecise(rent.estimatedRentNano, locale)}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-2 text-[13px] text-[var(--muted)]">{t("box.noRent")}</p>
              )}
            </AddrFactCard>
            {sheetReady && tab === "summary" ? (
              <div className="contents">
                <BoxLife
                  t={t}
                  locale={locale}
                  enterClass={enter.enterClass("inclusion")}
                  createdHref={data.transactionId ? `/tx/${data.transactionId}` : null}
                  createdId={data.transactionId}
                  createdExtra={
                    data.index != null ? t("box.output").replace("{n}", String(data.index)) : null
                  }
                  createdTs={asNum(data.createdTs)}
                  createdHeight={creation}
                  address={data.address}
                  ownerLabel={party.known ?? (data.address ? shortId(data.address, 10) : null)}
                  ownerMeta={[
                    party.known ? shortId(data.address ?? "", 8) : typeLabel,
                    lockLabel,
                    issuance ? t("box.issuance") : null,
                    oracleUsd != null ? `$${oracleUsd.toFixed(4)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  spent={spent}
                  spentHref={data.spentTransactionId ? `/tx/${data.spentTransactionId}` : null}
                  spentId={data.spentTransactionId}
                  spentHeight={spentHeight}
                  spentTs={asNum(data.spentTs)}
                  confs={confs}
                  createdWord={createdWord}
                  spentWord={spent ? spentWord : undefined}
                />
              </div>
            ) : null}
          </div>

          {sheetReady && tab === "summary" && (
            <div className="box-tab">
              <article className={clsx("mod box-plate", enter.enterClass("tree"))}>
                <button
                  type="button"
                  className="box-plate-in flex w-full items-center justify-between gap-3 text-left"
                  aria-expanded={treeOpen}
                  onClick={() => setTreeOpen((v) => !v)}
                >
                  <span className="box-k">{t("box.ergoTree")}</span>
                  <span className={clsx("text-[12px] text-[var(--muted)]", treeOpen && "rotate-90")} aria-hidden>
                    ›
                  </span>
                </button>
                {treeOpen ? (
                  !data.ergoTree && !data.ergoTreeTemplateHash && !treeConsts.length ? (
                  <p className="px-3.5 pb-3 text-[13px] text-[var(--muted)]">{t("box.noTree")}</p>
                ) : (
                  <div className="px-3.5 pb-3">
                    {data.ergoTreeTemplateHash ? (
                      <div className="mb-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] text-[var(--muted)]">{t("box.treeHash")}</span>
                          <CopyChip
                            text={data.ergoTreeTemplateHash}
                            copyLabel={t("tx.copy")}
                            copiedLabel={t("tx.copied")}
                          />
                        </div>
                        <code className="mt-1 block break-all font-mono text-[11px] text-[var(--muted)]">
                          {data.ergoTreeTemplateHash}
                        </code>
                      </div>
                    ) : null}
                    {treeConsts.length > 0 ? (
                      <div className="mb-2">
                        <p className="text-[12px] text-[var(--muted)]">{t("box.treeConstants")}</p>
                        <div className="mt-1 max-h-48 overflow-auto">
                          {treeConsts.map((c) => (
                            <div key={c.index} className="box-const">
                              <span className="box-const-i">{c.index}</span>
                              <span className="box-type">{c.sigmaType}</span>
                              <code className="min-w-0 break-all text-[var(--text)]">
                                {c.renderedValue}
                              </code>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : data.ergoTreeConstants ? (
                      <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-[var(--muted)]">
                        {data.ergoTreeConstants}
                      </pre>
                    ) : null}
                    {data.ergoTreeScript ? (
                      <HexFlap
                        id="script"
                        openId={openFlap}
                        onOpen={setOpenFlap}
                        label={t("box.treeScript")}
                        text={data.ergoTreeScript}
                        copyLabel={t("tx.copy")}
                        copiedLabel={t("tx.copied")}
                      />
                    ) : null}
                    {data.ergoTree ? (
                      <>
                        <p className="mb-1 flex flex-wrap items-baseline gap-x-2 text-[12px]">
                          <code className="font-mono text-[var(--muted)]">
                            {shortId(data.ergoTree, 10)}
                          </code>
                          <span className="text-[var(--muted-2)]">
                            {formatBytes(Math.floor(data.ergoTree.length / 2))}
                          </span>
                        </p>
                        <HexFlap
                          id="tree"
                          openId={openFlap}
                          onOpen={setOpenFlap}
                          label={t("box.raw")}
                          text={data.ergoTree}
                          copyLabel={t("tx.copy")}
                          copiedLabel={t("tx.copied")}
                        />
                      </>
                    ) : null}
                  </div>
                )
                ) : null}
              </article>
            </div>
          )}

          {sheetReady && tab === "tokens" && (
            <div className="box-tab feed-sheet">
              <Feed className="is-rank">
                {assets.length ? (
                  <FeedBoard
                    plate={<FeedPlate tag={t("box.tab.tokens")} count={<FeedCount k="feed.tokens" n={assets.length} />} />}
                  >
                    {assets.map((a, i) => {
                      const info = tokenInfo.get(a.tokenId.toLowerCase());
                      const dec = info?.decimals ?? a.decimals ?? 0;
                      const raw = toBigIntAmt(a.amount);
                      return (
                        <FeedHoldingRow
                          key={assetKey(a, i)}
                          tokenId={a.tokenId}
                          name={a.name ?? info?.name ?? info?.symbol ?? null}
                          decimals={dec}
                          amount={raw}
                          priceUsd={info?.priceUsd ?? null}
                          valueUsd={tokenAmountToUsd(raw, dec, info?.priceUsd)}
                          lead={{ rank: String(i + 1) }}
                          facts={
                            a.tokenId.toLowerCase() === id.toLowerCase() ? (
                              <span className="feed-kind">{t("box.payload.minted")}</span>
                            ) : null
                          }
                          enterClass={enter.enterClass(assetKey(a, i))}
                        />
                      );
                    })}
                  </FeedBoard>
                ) : (
                  <FeedEmpty k="token" title={t("box.noTokens")} plate={<FeedPlate tag={t("box.tab.tokens")} />} />
                )}
              </Feed>
            </div>
          )}

          {sheetReady && tab === "registers" && (
            <div className="box-tab">
              <p className="box-k px-1">{t("box.reg.bank")}</p>
              <div className="reg-bank">
                {REG_BANK.map((k) => {
                  const raw = data.registers?.[k] ?? "";
                  return (
                    <RegCell
                      key={k}
                      id={k}
                      raw={raw}
                      decoded={decoded[k]}
                      typed={typedRegs[k]}
                      emptyLabel={t("box.reg.empty")}
                      enterClass={enter.enterClass(k)}
                      openId={openFlap}
                      onOpen={setOpenFlap}
                      hexLabel={t("box.raw")}
                      copyLabel={t("tx.copy")}
                      copiedLabel={t("tx.copied")}
                    />
                  );
                })}
                {extraRegs.map(([k, v]) => (
                  <RegCell
                    key={k}
                    id={k}
                    raw={v}
                    decoded={decoded[k]}
                    typed={typedRegs[k]}
                    emptyLabel={t("box.reg.empty")}
                    enterClass={enter.enterClass(k)}
                    openId={openFlap}
                    onOpen={setOpenFlap}
                    hexLabel={t("box.raw")}
                    copyLabel={t("tx.copy")}
                    copiedLabel={t("tx.copied")}
                  />
                ))}
              </div>
            </div>
          )}

        </>
      )}
    </Shell>
  );
}

function BoxPageGhost() {
  return (
    <div aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading</p>
      <div className="addr-lane">
        <div className="col-span-2 h-[96px] animate-pulse rounded-[20px] border border-[var(--border)] bg-[var(--module)] lg:row-span-2" />
        <div className="col-span-2 h-[96px] animate-pulse rounded-[20px] border border-[var(--border)] bg-[var(--module)] lg:row-span-2" />
        <div className="h-[64px] animate-pulse rounded-[20px] border border-[var(--border)] bg-[var(--module)]" />
        <div className="h-[64px] animate-pulse rounded-[20px] border border-[var(--border)] bg-[var(--module)]" />
      </div>
      <div className="box-tab">
        <div className="h-[108px] animate-pulse rounded-[20px] border border-[var(--border)] bg-[var(--module)]" />
        <div className="box-tab-split">
          <div className="h-24 animate-pulse rounded-[20px] border border-[var(--border)] bg-[var(--module)]" />
          <div className="h-24 animate-pulse rounded-[20px] border border-[var(--border)] bg-[var(--module)]" />
        </div>
      </div>
    </div>
  );
}

function Plate({
  k,
  children,
  className,
}: {
  k: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={clsx("mod box-plate", className)}>
      <div className="box-plate-in">
        <p className="box-k">{k}</p>
        {children}
      </div>
    </article>
  );
}

function Fact({
  k,
  v,
  note,
  enterClass,
}: {
  k: string;
  v: string;
  note?: string;
  enterClass?: string;
}) {
  return (
    <div className={enterClass}>
      <p className="box-fact-k">{k}</p>
      <p className="box-fact-v">{v}</p>
      {note ? (
        <p className="mt-1 text-[12px] leading-none" style={{ color: INK.gold }}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

function LifeWire({ className }: { className?: string }) {
  return (
    <svg className={clsx("box-life-wire", className)} viewBox="0 0 80 44" fill="none" preserveAspectRatio="none" aria-hidden>
      <path d="M0 22 C 26 22, 54 10, 80 22" stroke="currentColor" strokeWidth="1.35" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** «Обмен · ErgoDex» over a tx id in the box's life line. */
function TxWord({ m, href, locale }: { m: CompactMeaning | undefined; href: string | null; locale: string }) {
  if (!m) return null;
  const r = meaningRow(m, meaningLang(locale));
  return (
    <p className="box-life-word">
      {href ? (
        <Link prefetch={false} href={href} className="box-life-act">
          {r.word}
        </Link>
      ) : (
        <span className="box-life-act">{r.word}</span>
      )}
      {r.where ? <span className="box-life-where">{r.where}</span> : null}
    </p>
  );
}

function BoxLife({
  t,
  locale,
  enterClass,
  createdHref,
  createdId,
  createdExtra,
  createdTs,
  createdHeight,
  address,
  ownerLabel,
  ownerMeta,
  spent,
  spentHref,
  spentId,
  spentHeight,
  spentTs,
  confs,
  createdWord,
  spentWord,
}: {
  createdWord?: CompactMeaning;
  spentWord?: CompactMeaning;
  t: (k: string) => string;
  locale: string;
  enterClass?: string;
  createdHref: string | null;
  createdId?: string | null;
  createdExtra: string | null;
  createdTs: number | null;
  createdHeight: number | null;
  address?: string | null;
  ownerLabel: string | null;
  ownerMeta: string;
  spent: boolean;
  spentHref: string | null;
  spentId?: string | null;
  spentHeight: number | null;
  spentTs: number | null;
  confs: number | null;
}) {
  return (
    <div className="contents" aria-label={t("box.life")}>
      <article className={clsx("box-life-node box-life-in", enterClass)}>
        <p className="box-k">{t("box.in")}</p>
        <TxWord m={createdWord} href={createdHref} locale={locale} />
        <p className={clsx("flex min-w-0 items-center gap-1", createdWord ? "mt-0.5" : "mt-2")}>
          {createdHref && createdId ? (
            <Link prefetch={false} href={createdHref} className="min-w-0 truncate font-mono text-[13px] text-accent hover:underline">
              {shortId(createdId, 8)}
            </Link>
          ) : (
            <span className="text-[13px] text-[var(--muted)]">—</span>
          )}
          {createdExtra ? <span className="shrink-0 text-[12px] text-[var(--muted-2)]">{createdExtra}</span> : null}
        </p>
        {createdTs != null ? (
          <div className="mt-1 text-[12px] text-[var(--muted)]">
            <ListWhen ts={createdTs} locale={locale} />
          </div>
        ) : null}
        {createdHeight != null ? (
          <p className="mt-1 text-[12px]">
            <Link prefetch={false} href={`/block/${createdHeight}`} className="tabular-nums text-accent hover:underline">
              {createdHeight.toLocaleString(loc(locale))}
            </Link>
          </p>
        ) : null}
        <LifeWire />
      </article>
      <article className={clsx("box-life-node is-box box-life-owner", enterClass)}>
        <p className="box-k">{t("box.owner")}</p>
        {address && ownerLabel ? (
          <p className="mt-2 min-w-0 truncate font-mono text-[13px]">
            <Link prefetch={false} href={`/address/${encodeURIComponent(address)}`} className="text-accent hover:underline">
              {ownerLabel}
            </Link>
          </p>
        ) : (
          <p className="mt-2 text-[13px] text-[var(--muted)]">—</p>
        )}
        {ownerMeta ? <p className="mt-1 truncate text-[12px] text-[var(--muted-2)]">{ownerMeta}</p> : null}
        <LifeWire />
      </article>
      <article className={clsx("box-life-node box-life-out", enterClass)}>
        <p className="box-k">{spent ? t("box.out") : t("box.unspent")}</p>
        {spent ? <TxWord m={spentWord} href={spentHref} locale={locale} /> : null}
        <p className={clsx("flex min-w-0 items-center gap-1", spent && spentWord ? "mt-0.5" : "mt-2")}>
          {spent && spentHref && spentId ? (
            <Link prefetch={false} href={spentHref} className="min-w-0 truncate font-mono text-[13px] text-accent hover:underline">
              {shortId(spentId, 8)}
            </Link>
          ) : (
            <span className="text-[13px] text-[var(--muted)]">{spent ? "—" : "\u00a0"}</span>
          )}
        </p>
        {spent && spentTs != null ? (
          <div className="mt-1 text-[12px] text-[var(--muted)]">
            <ListWhen ts={spentTs} locale={locale} />
          </div>
        ) : null}
        {spentHeight != null ? (
          <p className="mt-1 text-[12px]">
            <Link prefetch={false} href={`/block/${spentHeight}`} className="tabular-nums text-accent hover:underline">
              {spentHeight.toLocaleString(loc(locale))}
            </Link>
          </p>
        ) : null}
        {confs != null ? (
          <p className="mt-1 text-[12px] text-[var(--muted-2)]">{t("tx.confs").replace("{n}", String(confs))}</p>
        ) : null}
      </article>
    </div>
  );
}

function PayloadSlab({
  label,
  badge,
  amount,
  usd,
  minted,
  enterClass,
}: {
  label: string;
  badge: ReactNode;
  amount: ReactNode;
  usd: number | null | undefined;
  minted?: boolean;
  enterClass?: string;
}) {
  return (
    <article className={clsx("mod box-plate box-slab", enterClass)}>
      <div className="box-plate-in">
        {minted ? <i className="box-slab-mint" aria-hidden /> : null}
        {label ? <p className="box-k">{label}</p> : null}
        <div className="box-slab-row mt-2">
          <div className="min-w-0">{badge}</div>
          <div className="shrink-0 text-right tabular-nums">
            <div className="text-[13px] font-medium">{amount}</div>
            <p className="mt-0.5 text-[12px] text-[var(--muted)]">
              {usd != null && Number.isFinite(usd) ? <PrettyUsd n={usd} /> : "\u00a0"}
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}

function RegCell({
  id,
  raw,
  decoded,
  typed,
  emptyLabel,
  enterClass,
  openId,
  onOpen,
  hexLabel,
  copyLabel,
  copiedLabel,
}: {
  id: string;
  raw: string;
  decoded?: { text: string | null; kind: string };
  typed?: BoxRegisterTyped;
  emptyLabel: string;
  enterClass?: string;
  openId: string | null;
  onOpen: (id: string | null) => void;
  hexLabel: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const live = Boolean(raw);
  const hex = typed?.serializedValue ?? raw;
  const readable = eip4Readable(decoded, typed);
  return (
    <article className={clsx("mod box-plate reg-cell", !live && "is-empty", enterClass)}>
      <div className="box-plate-in">
        <div className="reg-cell-top">
          <span className="reg-cell-id">{id}</span>
          {live && typed?.sigmaType ? <span className="box-type">{typed.sigmaType}</span> : null}
        </div>
        {!live ? (
          <p className="reg-cell-empty">{emptyLabel}</p>
        ) : (
          <>
            {readable && decoded?.kind === "url" && decoded.text ? (
              <a
                href={decoded.text}
                target="_blank"
                rel="noreferrer"
                className="reg-cell-val text-accent hover:underline"
              >
                {decoded.text}
              </a>
            ) : readable && decoded?.text ? (
              <p className="reg-cell-val">{decoded.text}</p>
            ) : typed?.renderedValue ? (
              <p className="reg-cell-val">{typed.renderedValue}</p>
            ) : (
              <p className="reg-cell-empty">{emptyLabel}</p>
            )}
            <HexFlap
              id={`reg-${id}`}
              openId={openId}
              onOpen={onOpen}
              label={hexLabel}
              text={hex}
              copyLabel={copyLabel}
              copiedLabel={copiedLabel}
            />
          </>
        )}
      </div>
    </article>
  );
}

function HexFlap({
  id,
  openId,
  onOpen,
  label,
  text,
  copyLabel,
  copiedLabel,
}: {
  id: string;
  openId: string | null;
  onOpen: (next: string | null) => void;
  label: string;
  text: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const open = openId === id;
  return (
    <div className={clsx("hex-flap", open && "is-open")}>
      <button
        type="button"
        className={clsx("hex-flap-sum chip-press overflow-hidden", open && "is-pressed")}
        aria-expanded={open}
        onClick={() => onOpen(open ? null : id)}
      >
        <span className="inline-flex items-center gap-1.5">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
            <path
              d="M3.2 1.8 6.8 5 3.2 8.2"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {label}
        </span>
        <CopyChip text={text} copyLabel={copyLabel} copiedLabel={copiedLabel} />
      </button>
      {open ? (
        <div className="hex-flap-body">
          <pre>{text}</pre>
        </div>
      ) : null}
    </div>
  );
}

function ErgFigure({
  nano,
  locale,
  size = "md",
}: {
  nano: bigint;
  locale?: string;
  size?: "md" | "lg";
}) {
  const core = formatErgPrecise(nano < 0n ? -nano : nano, locale, false);
  const dot = core.lastIndexOf(".");
  const intPart = dot === -1 ? core : core.slice(0, dot);
  const frac = dot === -1 ? null : core.slice(dot);
  return (
    <span className="inline-block whitespace-nowrap tabular-nums tracking-tight text-[var(--text)]">
      <span className={size === "lg" ? "text-[28px] font-semibold leading-none" : "text-[22px] font-semibold leading-none"}>
        {intPart}
        {frac}
      </span>
      <span
        className={clsx(
          "ml-1 font-medium text-[var(--muted)]",
          size === "lg" ? "text-[13px]" : "text-[12px]"
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
}: {
  text: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard?.writeText(text).then(() => {
          setOk(true);
          window.setTimeout(() => setOk(false), 1200);
        });
      }}
      className="chip-press inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-[6px] text-[var(--muted)] transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[var(--wash)] hover:text-[var(--text)]"
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
          <rect x="2" y="2" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      )}
    </button>
  );
}

async function loadTokenInfos(ids: string[]): Promise<Map<string, TokenInfo>> {
  const gw = getGateway();
  const unique = [...new Set(ids.map((id) => id.toLowerCase()))]
    .filter((id) => id && !/^0+$/.test(id))
    .slice(0, TOKEN_FETCH_CAP);
  const pairs = await Promise.all(
    unique.map(async (id) => {
      const empty: TokenInfo = { decimals: 0, name: null, symbol: null, priceUsd: null };
      try {
        const r = await fetch(`${gw}/v1/tokens/${encodeURIComponent(id)}`, SNAPSHOT_FETCH);
        if (!r.ok) return [id, empty] as const;
        const j = (await r.json()) as {
          decimals?: number;
          name?: string | null;
          price?: { symbol?: string | null; priceUsd?: number | null };
        };
        const priceUsd = j.price?.priceUsd;
        return [
          id,
          {
            decimals: Number(j.decimals) || 0,
            name: typeof j.name === "string" ? j.name : null,
            symbol: typeof j.price?.symbol === "string" ? j.price.symbol : null,
            priceUsd:
              priceUsd != null && Number.isFinite(Number(priceUsd)) ? Number(priceUsd) : null,
          },
        ] as const;
      } catch {
        return [id, empty] as const;
      }
    })
  );
  return new Map(pairs);
}
