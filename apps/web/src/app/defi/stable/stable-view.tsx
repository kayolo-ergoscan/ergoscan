"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import { KpiGrid } from "@/components/KpiGrid";
import { KpiMarkScrollText, KpiMarkVault } from "@/components/kpi-marks";
import { TokenAvatar } from "@/components/TokenBadge";
import { PrettyPrice } from "@/components/PrettyNum";
import { ListWhen } from "@/components/ListWhen";
import { RankWindow } from "@/components/RankWindow";
import { INK } from "@/lib/palette";
import { snapshotAgeUsd } from "@ergoscan/shared";
import { formatGroupedNumber, formatRelAge, nanoErgToNumber, shortId } from "@/lib/format";
import { SIGRSV_ID, resolveTokenMeta, tokenTickerInk } from "@/lib/token-meta";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";
import { SNAPSHOT_FETCH, enteringIds, useEnterIds } from "@/lib/keyed-enter";
import { getGateway } from "@/lib/config";
import type { AgeUsdBank, AgeUsdEvent, AgeUsdTrader } from "@/lib/list-snapshots";

type TapeSort = "time" | "ticker" | "amount";
type TapeDir = "asc" | "desc";

const TAPE_PACK = 25;

function tapeEventId(row: AgeUsdEvent): string {
  return `${row.txId}:${row.side}:${row.tokenId}`;
}

function shortHash(id: string): string {
  if (!id || id.length <= 10) return id;
  return `${id.slice(0, 5)}..${id.slice(-5)}`;
}

const SIGUSD = "03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf04";

function loc(locale: string): string {
  return locale === "ru" ? "ru-RU" : "en-US";
}

function fmtTok(n: number | null | undefined, dec: number, _locale: string): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatGroupedNumber(n / 10 ** dec, dec, dec);
}

function fmtAmt(n: number, _locale: string): string {
  if (!Number.isFinite(n)) return "—";
  return formatGroupedNumber(n, 2, 2);
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
  const eventsEnter = useEnterIds();
  const eventsPack = useEnterIds();
  const tradersEnter = useEnterIds();
  const tradersPack = useEnterIds();
  const [listReady, setListReady] = useState(false);
  const opened = useRef(false);
  const eventsPrev = useRef<{ id: string }[]>([]);
  const tradersPrev = useRef<{ id: string }[]>([]);

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
        const events = (next.events ?? []).map((row) => ({ id: tapeEventId(row) }));
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
    const events = (bank?.events ?? []).map((row) => ({ id: tapeEventId(row) }));
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

      <div className="grid min-w-0 items-start gap-2 lg:grid-cols-4">
        <div className="min-w-0 lg:col-span-3">
          {!listReady ? null : !rows.length ? (
            <p className="text-[var(--muted)]">{t("stable.emptyTape")}</p>
          ) : (
            <div className="addr-sheet">
              <div className={eventsPack.enterClass("pack")}>
              <div
                className={clsx(
                  "addr-pan transition-opacity duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                  pending && "opacity-60"
                )}
              >
                <div className="addr-head addr-lane addr-lane-x block-lane text-[12px] font-medium">
                  <div className="block-lane-pair">
                    <SortCol label={t("defi.token")} k="ticker" sort={sort} dir={dir} align="left" onSort={onSort} />
                    <div className="min-w-0 justify-end">{t("defi.side")}</div>
                  </div>
                  <div className="block-lane-pair">
                    <div className="min-w-0">{t("defi.price")}</div>
                    <SortCol label={t("defi.amount")} k="amount" sort={sort} dir={dir} align="right" onSort={onSort} />
                  </div>
                  <div className="block-lane-pair">
                    <div className="min-w-0">{t("defi.paid")}</div>
                    <SortCol label={t("defi.time")} k="time" sort={sort} dir={dir} align="right" onSort={onSort} />
                  </div>
                  <div className="block-lane-pair">
                    <div className="min-w-0">{t("defi.trader")}</div>
                    <div className="min-w-0 justify-end">{t("detail.tx")}</div>
                  </div>
                </div>
                {rows.map((row) => (
                  <BankRow
                    key={tapeEventId(row)}
                    row={row}
                    locale={locale}
                    t={t}
                    enterClass={eventsEnter.enterClass(tapeEventId(row))}
                  />
                ))}
              </div>
              </div>
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
        <div className="min-w-0 lg:col-span-1">
          {!listReady ? null : !topTraders.length ? (
            <p className="text-[var(--muted)]">{t("stable.emptyTop")}</p>
          ) : (
            <div className="addr-sheet">
              <div className={tradersPack.enterClass("pack")}>
              <div
                className={clsx(
                  "addr-pan side-list transition-opacity duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
                  pending && "opacity-60"
                )}
              >
                <div className="addr-head flex h-[var(--addr-bar)] items-center text-[12px] font-medium">
                  <div className="min-w-0 flex-1 px-3 text-[var(--muted)]">{t("defi.trader")}</div>
                  <div className="shrink-0 px-3 text-right text-[var(--muted)]">{t("stable.topSum")}</div>
                </div>
                {topTraders.map((row) => (
                  <TopTraderRow
                    key={row.trader}
                    row={row}
                    locale={locale}
                    enterClass={tradersEnter.enterClass(row.trader)}
                  />
                ))}
              </div>
              </div>
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

function SortCol({
  label,
  k,
  sort,
  dir,
  align,
  onSort,
}: {
  label: string;
  k: TapeSort;
  sort: TapeSort;
  dir: TapeDir;
  align: "left" | "right";
  onSort: (k: TapeSort) => void;
}) {
  const t = useT();
  const on = sort === k;
  const hint = on
    ? `${label}, ${dir === "asc" ? t("addresses.sortAsc") : t("addresses.sortDesc")}`
    : label;
  return (
    <div
      className={clsx("flex h-full min-w-0 items-center", align === "right" && "justify-end")}
      aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        aria-label={hint}
        className={clsx(
          "chip-press inline-flex shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[10px] px-2 py-1.5 text-[12px] font-medium leading-none transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-[var(--text)]",
          on ? "is-pressed bg-[var(--wash-strong)] text-[var(--text)]" : "text-[var(--muted)]"
        )}
      >
        {label}
        <span className="sort-mark" aria-hidden>
          <span className={clsx("sort-caret sort-caret-up", on && dir === "asc" && "is-on")} />
          <span className={clsx("sort-caret sort-caret-dn", on && dir === "desc" && "is-on")} />
        </span>
      </button>
    </div>
  );
}

function BankRow({
  row,
  locale,
  t,
  enterClass,
}: {
  row: AgeUsdEvent;
  locale: string;
  t: (k: string) => string;
  enterClass?: string;
}) {
  const meta = row.tokenId ? resolveTokenMeta(row.tokenId, row.tokenName) : null;
  const label = meta?.symbol || (row.tokenId ? shortId(row.tokenId, 4) : "—");
  const sid = row.side.toLowerCase();
  const kind = sid.startsWith("mint")
    ? "mint"
    : sid.startsWith("redeem")
      ? "redeem"
      : sid;
  const sideKey = `defi.side.${kind}`;
  const side = t(sideKey) !== sideKey ? t(sideKey) : row.side;
  const mint = kind === "mint";
  const redeem = kind === "redeem";
  const price =
    row.tokenAmount > 0 && row.baseAmount > 0 ? row.baseAmount / row.tokenAmount : null;
  return (
    <div
      className={clsx(
        "addr-lane addr-lane-x block-lane border-t border-[var(--border-soft)] py-2.5 text-[13px]",
        enterClass
      )}
    >
      <div className="block-lane-pair">
        <div className="flex min-w-0 items-center px-3">
          {row.tokenId ? (
            <Link prefetch={false} href={`/token/${row.tokenId}`} className="flex min-w-0 items-center gap-2">
              <TokenAvatar tokenId={row.tokenId} symbol={meta?.symbol} size={22} />
              <span className="truncate font-semibold" style={{ color: tokenTickerInk(row.tokenId) }}>
                {label}
              </span>
            </Link>
          ) : (
            <span className="text-[var(--muted)]">—</span>
          )}
        </div>
        <div className="flex min-w-0 items-center justify-end px-3">
          <div className="min-w-0 text-right">
            <p
              className={clsx(
                "font-medium lowercase leading-none",
                mint && "text-[var(--up)]",
                redeem && "text-[#FF4D6D]",
                !mint && !redeem && "text-[var(--muted)]"
              )}
            >
              {side}
            </p>
            <p className="mt-0.5 text-[11px] leading-none text-[var(--muted)]">
              {formatRelAge(row.time, locale)}
            </p>
          </div>
        </div>
      </div>
      <div className="block-lane-pair">
        <div className="min-w-0 px-3 tabular-nums">
          <PrettyPrice n={price} />
        </div>
        <div className="min-w-0 px-3 text-right tabular-nums">{fmtAmt(row.tokenAmount, locale)}</div>
      </div>
      <div className="block-lane-pair">
        <div className="min-w-0 px-3 tabular-nums text-[var(--up)]">
          {row.baseAmount ? fmtErgFull(row.baseAmount, locale) : "—"}
        </div>
        <div className="min-w-0 px-3 text-right">
          <ListWhen ts={row.time} locale={locale} />
        </div>
      </div>
      <div className="block-lane-pair">
        <div className="min-w-0 px-3">
          {row.trader ? (
            <Link
              prefetch={false}
              href={`/address/${encodeURIComponent(row.trader)}`}
              className="block truncate whitespace-nowrap font-mono text-[12px] text-accent hover:underline"
            >
              {shortHash(row.trader)}
            </Link>
          ) : (
            <span className="text-[var(--muted)]">—</span>
          )}
        </div>
        <div className="min-w-0 px-3 text-right">
          {row.txId ? (
            <Link
              prefetch={false}
              href={`/tx/${row.txId}`}
              className="inline-block whitespace-nowrap font-mono text-accent hover:underline"
            >
              {shortHash(row.txId)}
            </Link>
          ) : (
            "—"
          )}
        </div>
      </div>
    </div>
  );
}

function TopTraderRow({
  row,
  locale,
  enterClass,
}: {
  row: AgeUsdTrader;
  locale: string;
  enterClass?: string;
}) {
  return (
    <div
      className={clsx(
        "box-border flex h-[var(--addr-row)] min-h-[var(--addr-row)] max-h-[var(--addr-row)] items-center border-t border-[var(--border-soft)] text-[13px]",
        enterClass
      )}
    >
      <div className="min-w-0 flex-1 px-3">
        <Link
          prefetch={false}
          href={`/address/${encodeURIComponent(row.trader)}`}
          className="block truncate whitespace-nowrap font-mono text-[12px] text-accent hover:underline"
        >
          {shortHash(row.trader)}
        </Link>
      </div>
      <div className="shrink-0 px-3 text-right tabular-nums text-[var(--up)]">
        {fmtErgFull(row.erg, locale)}
      </div>
    </div>
  );
}

