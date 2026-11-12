"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import { KpiGrid } from "@/components/KpiGrid";
import { KpiMarkScrollText, KpiMarkVault } from "@/components/kpi-marks";
import { TokenAvatar } from "@/components/TokenBadge";
import { RankWindow } from "@/components/RankWindow";
import { INK } from "@/lib/palette";
import { snapshotAgeUsd } from "@ergoscan/shared";
import { formatGroupedNumber, nanoErgToNumber, shortId } from "@/lib/format";
import { SIGRSV_ID, resolveTokenMeta, tokenTickerInk } from "@/lib/token-meta";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";
import { ENTER_MS, SNAPSHOT_FETCH, enteringIds, useEnterIds } from "@/lib/keyed-enter";
import { Feed, FeedBoard, FeedCount, FeedEmpty, FeedPlate } from "@/components/feed/Feed";
import { FeedSwapTape, FeedTraderRow, swapEventId } from "@/components/feed/FeedSwapRow";
import { getGateway } from "@/lib/config";
import type { AgeUsdBank } from "@/lib/list-snapshots";

type TapeSort = "time" | "ticker" | "amount";
type TapeDir = "asc" | "desc";

const TAPE_PACK = 25;

const SIGUSD = "03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf04";

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function fmtTok(n: number | null | undefined, dec: number, _locale: string): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatGroupedNumber(n / 10 ** dec, dec, dec);
}


function fmtErgFull(n: number, _locale: string): string {
  if (!Number.isFinite(n)) return "—";
  return `${formatGroupedNumber(n, 2, 2)} ERG`;
}

export function StableView({ initial }: { initial: AgeUsdBank | null }) {
  const t = useT();
  const { locale } = useI18n();
  const { markSynced } = usePageSync();
  const miss = t("home.unavailable");
  const [bank, setBank] = useState<AgeUsdBank | null>(initial);
  const [sort, setSort] = useState<TapeSort>("time");
  const [dir, setDir] = useState<TapeDir>("desc");
  const [eventsOffset, setEventsOffset] = useState(0);
  const [tradersOffset, setTradersOffset] = useState(0);
  const [pending, setPending] = useState(false);
  // Rows the server already has go into the first HTML, with the same entry animation.
  const seedEvents = (initial?.events ?? []).map((row) => swapEventId(row));
  const seedTraders = (initial?.topTraders ?? []).map((row) => row.trader);
  const seeded = seedEvents.length > 0 || seedTraders.length > 0;
  const eventsEnter = useEnterIds(ENTER_MS, seedEvents);
  const eventsPack = useEnterIds(ENTER_MS, seedEvents.length ? ["pack"] : []);
  const tradersEnter = useEnterIds(ENTER_MS, seedTraders);
  const tradersPack = useEnterIds(ENTER_MS, seedTraders.length ? ["pack"] : []);
  const [listReady, setListReady] = useState(seeded);
  const opened = useRef(seeded);
  const eventsPrev = useRef<{ id: string }[]>(seedEvents.map((id) => ({ id })));
  const tradersPrev = useRef<{ id: string }[]>(seedTraders.map((id) => ({ id })));

  const pull = useCallback(async (silent = false) => {
    try {
      const qs = new URLSearchParams({
        limit: String(TAPE_PACK),
        eventsOffset: String(eventsOffset),
        tradersOffset: String(tradersOffset),
        eventsSort: sort,
        eventsDir: dir,
      });
      const r = await fetch(`${getGateway()}/v1/defi/ageusd?${qs}`, SNAPSHOT_FETCH);
      if (!r.ok) return;
      const next = (await r.json()) as AgeUsdBank;
      if (opened.current) {
        const events = (next.events ?? []).map((row) => ({ id: swapEventId(row) }));
        const traders = (next.topTraders ?? []).map((row) => ({ id: row.trader }));
        const freshEvents = enteringIds(eventsPrev.current, events);
        const freshTraders = enteringIds(tradersPrev.current, traders);
        eventsEnter.mark(freshEvents);
        tradersEnter.mark(freshTraders);
        if (!silent && freshEvents.length) eventsPack.mark(["pack"]);
        if (!silent && freshTraders.length) tradersPack.mark(["pack"]);
        eventsPrev.current = events;
        tradersPrev.current = traders;
      }
      setBank(next);
    } catch {
      /* keep */
    } finally {
      markSynced();
      setPending(false);
    }
  }, [
    dir,
    eventsEnter.mark,
    eventsOffset,
    eventsPack.mark,
    markSynced,
    sort,
    tradersEnter.mark,
    tradersOffset,
    tradersPack.mark,
  ]);
  useKeepFresh(pull);

  const skipFirst = useRef(true);
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    setPending(true);
    void pull();
  }, [pull]);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    const events = (bank?.events ?? []).map((row) => ({ id: swapEventId(row) }));
    const traders = (bank?.topTraders ?? []).map((row) => ({ id: row.trader }));
    eventsPrev.current = events;
    tradersPrev.current = traders;
    eventsEnter.mark(events.map((row) => row.id));
    tradersEnter.mark(traders.map((row) => row.id));
    if (events.length) eventsPack.mark(["pack"]);
    if (traders.length) tradersPack.mark(["pack"]);
    setListReady(true);
  }, [bank, eventsEnter.mark, eventsPack.mark, tradersEnter.mark, tradersPack.mark]);

  const reserve = bank?.reserveNano != null ? nanoErgToNumber(bank.reserveNano) : null;
  const snap = snapshotAgeUsd({
    reserveNano: bank?.reserveNano,
    sigUsdInBank: bank?.sigUsdInBank,
    sigRsvInBank: bank?.sigRsvInBank,
    ergUsd: bank?.ergUsd,
  });
  const ratio = bank?.reserveRatio ?? snap.reserveRatio;
  const band = bank?.band ?? snap.band;
  const rows = bank?.events ?? [];
  const topTraders = bank?.topTraders ?? [];

  const onSort = (k: TapeSort) => {
    if (sort === k) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(k);
      setDir(k === "time" || k === "amount" ? "desc" : "asc");
    }
    setEventsOffset(0);
  };

  const kpis = [
    {
      label: t("stable.reserve"),
      value: reserve != null ? fmtErgFull(reserve, locale) : miss,
      unavailable: reserve == null,
      sub: t("stable.reserveSub"),
      mark: <KpiMarkVault tone={INK.gold} />,
      ink: INK.gold,
      enter: 0,
    },
    {
      label: t("stable.sigusdBank"),
      value: bank?.sigUsdInBank != null ? fmtTok(bank.sigUsdInBank, 2, locale) : miss,
      unavailable: bank?.sigUsdInBank == null,
      sub: t("stable.sigusdBankSub"),
      mark: <TokenAvatar tokenId={SIGUSD} symbol="SigUSD" size={36} />,
      ink: INK.cyan,
      enter: 1,
    },
    {
      label: t("stable.sigrsvBank"),
      value: bank?.sigRsvInBank != null ? fmtTok(bank.sigRsvInBank, 0, locale) : miss,
      unavailable: bank?.sigRsvInBank == null,
      sub: t("stable.sigrsvBankSub"),
      mark: <TokenAvatar tokenId={SIGRSV_ID} symbol="SigRSV" size={36} />,
      ink: INK.coral,
      enter: 2,
    },
    {
      label: t("stable.events"),
      value:
        bank?.eventsCount != null ? bank.eventsCount.toLocaleString(loc(locale)) : miss,
      unavailable: bank?.eventsCount == null,
      sub: t("stable.eventsSub"),
      mark: <KpiMarkScrollText tone={INK.gold} />,
      ink: INK.gold,
      enter: 3,
    },
  ];

  return (
    <Shell>
      <KpiGrid items={kpis} dense className="mb-4 sm:grid-cols-4" />

      <div className="mb-2 grid min-w-0 items-stretch gap-2 md:grid-cols-3">
        <article
          className="home-tile-enter min-w-0 max-w-full overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3"
          style={{ "--enter": 4 } as CSSProperties}
        >
          <h2 className="text-[13px] font-medium text-[var(--muted)]">{t("stable.protocol")}</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--text)]">
            {t("stable.protocolBody")}
          </p>
          <Link
            prefetch={false}
            href={`/defi/spectrum?tokenId=${SIGUSD}`}
            className="mt-3 inline-flex text-[13px] text-accent hover:underline"
          >
            {t("stable.ammLink")}
          </Link>
        </article>
        <article
          className="home-tile-enter min-w-0 max-w-full overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3"
          style={{ "--enter": 5 } as CSSProperties}
        >
          <h2 className="text-[13px] font-medium text-[var(--muted)]">{t("stable.bank")}</h2>
          <dl className="mt-2 space-y-2 text-[13px]">
            <Fact label={t("stable.nft")} value={bank?.nft} href={bank?.nft ? `/token/${bank.nft}` : undefined} />
            <Fact label={t("stable.box")} value={bank?.boxId} href={bank?.boxId ? `/box/${bank.boxId}` : undefined} />
            <Fact
              label={t("stable.height")}
              value={
                bank?.height != null ? `#${bank.height.toLocaleString(loc(locale))}` : null
              }
            />
          </dl>
        </article>
        <RatioTile
          enter={6}
          ratio={ratio}
          band={band}
          locale={locale}
          t={t}
          mintUsd={bank?.mintUsd ?? snap.mintUsd}
          redeemUsd={bank?.redeemUsd ?? snap.redeemUsd}
          mintRsv={bank?.mintRsv ?? snap.mintRsv}
          redeemRsv={bank?.redeemRsv ?? snap.redeemRsv}
          sigUsdUsd={bank?.sigUsdUsd ?? snap.sigUsdUsd}
          sigUsdErg={bank?.sigUsdErg ?? snap.sigUsdErg}
          sigRsvUsd={bank?.sigRsvUsd ?? snap.sigRsvUsd}
          sigRsvErg={bank?.sigRsvErg ?? snap.sigRsvErg}
        />
      </div>

      <div className="grid min-w-0 items-start gap-2 xl:grid-cols-4">
        <div className="min-w-0 xl:col-span-3">
          {!listReady ? null : !rows.length ? (
            <Feed>
              <FeedEmpty k="stable" title={t("stable.emptyTape")} />
            </Feed>
          ) : (
            <div className="feed-sheet">
              <Feed busy={pending} className={sort === "time" ? undefined : "is-rank"} enterClass={eventsPack.enterClass("pack")}>
                <FeedSwapTape
                  rows={rows}
                  tag={t("stable.tape")}
                  total={bank?.eventsCount ?? null}
                  sort={sort}
                  dir={dir}
                  timeKey="time"
                  sorts={[
                    { key: "time", label: t("defi.time") },
                    { key: "amount", label: t("defi.amount") },
                    { key: "ticker", label: t("defi.token") },
                  ]}
                  onSort={onSort}
                  pending={pending}
                  offset={eventsOffset}
                  bank
                  enterClass={eventsEnter.enterClass}
                />
              </Feed>
              <RankWindow
                offset={eventsOffset}
                pageSize={TAPE_PACK}
                shown={rows.length}
                total={bank?.eventsCount ?? null}
                loc={loc(locale)}
                ofLabel={t("addresses.packOf")}
                prevLabel={t("addresses.packPrev")}
                nextLabel={t("addresses.packNext")}
                tapeLabel={t("stable.packTape")}
                hint={t("stable.packHint")}
                disabled={pending}
                onOffset={setEventsOffset}
              />
            </div>
          )}
        </div>
        <div className="min-w-0 xl:col-span-1">
          {!listReady ? null : !topTraders.length ? (
            <Feed>
              <FeedEmpty k="addr" title={t("stable.emptyTop")} />
            </Feed>
          ) : (
            <div className="feed-sheet">
              <Feed busy={pending} className="is-rank is-side" enterClass={tradersPack.enterClass("pack")}>
                <FeedBoard
                  plate={
                    <FeedPlate
                      tag={t("stable.topTraders")}
                      count={bank?.tradersCount != null ? <FeedCount k="feed.traders" n={bank.tradersCount} /> : undefined}
                    />
                  }
                >
                  {topTraders.map((row, i) => (
                    <FeedTraderRow
                      key={row.trader}
                      trader={row.trader}
                      erg={row.erg}
                      deals={row.deals}
                      rank={tradersOffset + i + 1}
                      enterClass={tradersEnter.enterClass(row.trader)}
                    />
                  ))}
                </FeedBoard>
              </Feed>
              <RankWindow
                offset={tradersOffset}
                pageSize={TAPE_PACK}
                shown={topTraders.length}
                total={bank?.tradersCount ?? null}
                loc={loc(locale)}
                ofLabel={t("addresses.packOf")}
                prevLabel={t("addresses.packPrev")}
                nextLabel={t("addresses.packNext")}
                tapeLabel={t("stable.packTraders")}
                hint={t("stable.packHint")}
                disabled={pending}
                onOffset={setTradersOffset}
              />
            </div>
          )}
        </div>
      </div>
    </Shell>
  );
}

function ratioInk(band: "below" | "in" | "above" | null | undefined): string {
  if (band === "below") return "#FF4D6D";
  if (band === "in") return "var(--up)";
  if (band === "above") return INK.gold;
  return "var(--muted)";
}

function fmtUsdPx(n: number | null | undefined, _locale: string, digits: number): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const max = n > 0 && n < 0.01 ? Math.max(digits, 6) : digits;
  return `$${formatGroupedNumber(n, Math.min(2, max), max)}`;
}

function fmtErgPx(n: number | null | undefined, _locale: string): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const max = n > 0 && n < 0.01 ? 6 : 4;
  return `${formatGroupedNumber(n, 2, max)} ERG`;
}

function RatioTile({
  enter,
  ratio,
  band,
  locale,
  t,
  mintUsd,
  redeemUsd,
  mintRsv,
  redeemRsv,
  sigUsdUsd,
  sigUsdErg,
  sigRsvUsd,
  sigRsvErg,
}: {
  enter?: number;
  ratio: number | null;
  band: "below" | "in" | "above" | null;
  locale: string;
  t: (k: string) => string;
  mintUsd: boolean;
  redeemUsd: boolean;
  mintRsv: boolean;
  redeemRsv: boolean;
  sigUsdUsd: number | null;
  sigUsdErg: number | null;
  sigRsvUsd: number | null;
  sigRsvErg: number | null;
}) {
  const ink = ratioInk(band);
  const bandKey =
    band === "below" ? "stable.ratioBelow" : band === "above" ? "stable.ratioAbove" : "stable.ratioIn";
  return (
    <article
      className={clsx(
        "rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3",
        enter != null && "home-tile-enter"
      )}
      style={enter != null ? ({ "--enter": enter } as CSSProperties) : undefined}
    >
      <h2 className="text-[13px] font-medium text-[var(--muted)]">{t("stable.ratio")}</h2>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p className="text-[22px] font-semibold tabular-nums leading-none" style={{ color: ink }}>
          {ratio != null && Number.isFinite(ratio)
            ? `${ratio.toLocaleString(loc(locale), { maximumFractionDigits: 0 })}%`
            : "—"}
        </p>
        <p className="text-right text-[11px] leading-snug text-[var(--muted)]">
          {band ? t(bandKey) : t("stable.ratioBand")}
        </p>
      </div>
      <RatioBar rr={ratio} band={band} />
      <div className="mt-3 space-y-2.5">
        <TokenGate
          tokenId={SIGUSD}
          symbol="SigUSD"
          usd={fmtUsdPx(sigUsdUsd, locale, 2)}
          erg={fmtErgPx(sigUsdErg, locale)}
          mint={mintUsd}
          redeem={redeemUsd}
          t={t}
        />
        <TokenGate
          tokenId={SIGRSV_ID}
          symbol="SigRSV"
          usd={fmtUsdPx(sigRsvUsd, locale, 4)}
          erg={fmtErgPx(sigRsvErg, locale)}
          mint={mintRsv}
          redeem={redeemRsv}
          t={t}
        />
      </div>
    </article>
  );
}

function RatioBar({
  rr,
  band,
}: {
  rr: number | null;
  band: "below" | "in" | "above" | null;
}) {
  const min = 400;
  const max = 800;
  const clamped = rr == null || !Number.isFinite(rr) ? null : Math.min(max, Math.max(min, rr));
  const pct = clamped == null ? 0 : ((clamped - min) / (max - min)) * 100;
  const ink = ratioInk(band);
  return (
    <div className="mt-2">
      <div className="relative h-1.5 rounded-full bg-[var(--border)]">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct}%`, background: ink }}
        />
        {clamped != null ? (
          <span
            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--module)]"
            style={{ left: `${pct}%`, background: ink }}
          />
        ) : null}
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-[var(--muted)]">
        <span>400%</span>
        <span>800%</span>
      </div>
    </div>
  );
}

function TokenGate({
  tokenId,
  symbol,
  usd,
  erg,
  mint,
  redeem,
  t,
}: {
  tokenId: string;
  symbol: string;
  usd: string;
  erg: string;
  mint: boolean;
  redeem: boolean;
  t: (k: string) => string;
}) {
  const meta = resolveTokenMeta(tokenId, symbol);
  return (
    <div className="flex items-center gap-2">
      <TokenAvatar tokenId={tokenId} symbol={meta.symbol ?? symbol} size={22} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13px] font-semibold" style={{ color: tokenTickerInk(tokenId) }}>
            {symbol}
          </span>
          <span className="shrink-0 tabular-nums text-[13px]">
            {usd}
            <span className="ml-1.5 text-[11px] text-[var(--muted)]">{erg}</span>
          </span>
        </div>
        <div className="mt-1 flex justify-end gap-3 text-[11px] leading-none">
          <Gate on={mint} label={t("stable.mint")} t={t} />
          <Gate on={redeem} label={t("stable.redeem")} t={t} />
        </div>
      </div>
    </div>
  );
}

function Gate({
  on,
  label,
  t,
}: {
  on: boolean;
  label: string;
  t: (k: string) => string;
}) {
  return (
    <span className={clsx("lowercase", on ? "text-[var(--up)]" : "text-[var(--muted)]")}>
      {label} {on ? t("stable.gateOn") : t("stable.gateOff")}
    </span>
  );
}

function Fact({
  label,
  value,
  href,
}: {
  label: string;
  value?: string | null;
  href?: string;
}) {
  const shown = value ? shortId(value, 10) : "—";
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="min-w-0 font-mono text-[12px]">
        {href && value ? (
          <Link prefetch={false} href={href} className="text-accent hover:underline">
            {shown}
          </Link>
        ) : (
          shown
        )}
      </dd>
    </div>
  );
}

