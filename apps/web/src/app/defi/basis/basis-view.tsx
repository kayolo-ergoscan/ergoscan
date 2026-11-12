"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Shell } from "@/components/Shell";
import { KpiGrid } from "@/components/KpiGrid";
import { RankWindow } from "@/components/RankWindow";
import {
  KpiMarkBox,
  KpiMarkCoins,
  KpiMarkFingerprint,
  KpiMarkVault,
  KpiMarkWalletMinimal,
} from "@/components/kpi-marks";
import { TokenAvatar } from "@/components/TokenBadge";
import { INK } from "@/lib/palette";
import { describeRentErg, formatFactWhen, formatRelTime, relAgeTone, relAgeToneClass, shortId } from "@/lib/format";
import { ERG_ZERO, resolveTokenMeta, tokenTickerInk } from "@/lib/token-meta";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { countText } from "@/lib/i18n/messages";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";
import { SNAPSHOT_FETCH } from "@/lib/keyed-enter";
import { basisPackReady, completeBasisPack, ergPerToken } from "@/lib/basis-pack";
import { getGateway } from "@/lib/config";
import type { BasisReserve, BasisSnap } from "@/lib/list-snapshots";

const TRACKER_REPO = "https://github.com/BetterMoneyLabs/basis-tracker";
const PAGE = 25;
type SortKey = "created" | "amount";

function fmtUnits(amount: string, decimals: number, locale: string): string {
  const neg = amount.startsWith("-");
  const digits = amount.replace(/^-/, "").replace(/\..*$/, "") || "0";
  const places = Math.min(18, Math.max(0, Math.trunc(decimals) || 0));
  const padded = digits.padStart(places + 1, "0");
  const whole = padded.slice(0, padded.length - places) || "0";
  const frac = places ? padded.slice(padded.length - places).replace(/0+$/, "") : "";
  const grouped =
    whole.length < 16
      ? Number(whole).toLocaleString(locale)
      : whole;
  return `${neg ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

function statusCopy(
  row: BasisReserve,
  t: (k: string) => string,
  locale: string
): { label: string; hint: string } {
  if (row.status === "refundReady") {
    return { label: t("basis.statusRefundReady"), hint: t("basis.statusRefundReadyHint") };
  }
  if (row.status === "refund") {
    const blocks = Number(row.blocksLeft);
    const days = Number.isFinite(blocks) ? String(Math.max(1, Math.ceil(blocks / 720))) : "—";
    return {
      label: countText(t, locale, "basis.statusRefund", Number(days), days),
      hint: t("basis.statusRefundHint").replace("{n}", days),
    };
  }
  if (row.status === "quiet") {
    return { label: t("basis.statusQuiet"), hint: t("basis.statusQuietHint") };
  }
  if (row.status === "noTracker") {
    return { label: t("basis.statusNoTracker"), hint: t("basis.statusNoTrackerHint") };
  }
  return { label: t("basis.statusOpen"), hint: t("basis.statusOpenHint") };
}

function lockedTicker(row: BasisReserve): string {
  if (row.kind === "erg") return "ERG";
  const id = row.collateral?.tokenId;
  if (!id) return "—";
  return resolveTokenMeta(id).symbol;
}

/** ERG box value, or token collateral × pool price. Null when the token has no ERG price. */
function rowErgNano(row: BasisReserve, prices: Record<string, number>): bigint | null {
  if (row.ergValueNano != null) {
    try {
      return BigInt(row.ergValueNano.split(".")[0] || "0");
    } catch {
      return null;
    }
  }
  if (row.kind === "erg") {
    try {
      return BigInt(row.nano.split(".")[0] || "0");
    } catch {
      return null;
    }
  }
  const held = row.collateral;
  const price = held ? prices[held.tokenId] : undefined;
  if (!held || price == null || !(price > 0)) return null;
  try {
    const raw = BigInt(held.amount.split(".")[0] || "0");
    const priceNano = BigInt(Math.round(price * 1e9));
    const scale = 10n ** BigInt(Math.min(18, Math.max(0, Math.trunc(held.decimals) || 0)));
    return (raw * priceNano) / scale;
  } catch {
    return null;
  }
}

function SortHead({
  label,
  on,
  dir,
  align,
  onClick,
}: {
  label: string;
  on: boolean;
  dir: "asc" | "desc";
  align?: "end";
  onClick: () => void;
}) {
  return (
    <div className={clsx("min-w-0", align === "end" && "is-end")}>
      <button
        type="button"
        onClick={onClick}
        aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"}
        className={clsx(
          "chip-press inline-flex max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[10px] px-2 py-1.5 text-[12px] font-medium leading-none transition-colors duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:text-[var(--text)]",
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

export function BasisView({ initial }: { initial: BasisSnap | null }) {
  const t = useT();
  const { locale } = useI18n();
  const loc = locale === "ru" ? "ru-RU" : "en-US";
  const { markSynced } = usePageSync();
  const [snap, setSnap] = useState<BasisSnap | null>(initial);
  const [blockTs, setBlockTs] = useState<Record<number, number>>({});
  const [sort, setSort] = useState<SortKey>("created");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);
  const [pricePack, setPricePack] = useState<{ key: string; map: Record<string, number> }>({
    key: "",
    map: {},
  });
  const packTries = useRef(0);
  const miss = t("home.unavailable");

  const pull = useCallback(async () => {
    try {
      const r = await fetch(`${getGateway()}/v1/defi/basis`, SNAPSHOT_FETCH);
      if (!r.ok) return;
      const next = (await r.json()) as BasisSnap;
      setSnap((prev) => {
        if (!prev?.reserves || !next.reserves) return next;
        const known = new Map(prev.reserves.map((row) => [row.boxId, row]));
        return {
          ...next,
          reserves: next.reserves.map((row) => {
            const had = known.get(row.boxId);
            return {
              ...row,
              creator: row.creator !== undefined ? row.creator : had?.creator,
              createdAt: row.createdAt != null ? row.createdAt : had?.createdAt,
            };
          }),
        };
      });
    } catch {
      /* keep the pack we have */
    } finally {
      markSynced();
    }
  }, [markSynced]);
  useKeepFresh(pull);
  useEffect(() => {
    if (snap?.ok) return;
    void pull();
  }, [pull, snap?.ok]);

  const ready = snap?.ok === true;
  const packed = basisPackReady(snap?.reserves);
  useEffect(() => {
    if (!ready || packed || !snap?.reserves) return;
    if (packTries.current >= 3) {
      setSnap({
        ...snap,
        reserves: snap.reserves.map((row) =>
          row.creator === undefined ? { ...row, creator: null } : row
        ),
      });
      return;
    }
    packTries.current += 1;
    let stop = false;
    void completeBasisPack(snap).then((next) => {
      if (!stop && next) setSnap(next);
    });
    return () => {
      stop = true;
    };
  }, [ready, packed, snap]);
  const heightKey = (snap?.reserves ?? [])
    .filter((row) => row.height != null && row.createdAt == null)
    .map((row) => row.height)
    .join(",");
  useEffect(() => {
    if (!heightKey) return;
    const heights = heightKey
      .split(",")
      .map((h) => Number(h))
      .filter((h) => Number.isFinite(h) && h > 0);
    if (!heights.length) return;
    let stop = false;
    void Promise.all(
      heights.map(async (h) => {
        try {
          const r = await fetch(`${getGateway()}/v1/blocks/${h}`, SNAPSHOT_FETCH);
          if (!r.ok) return null;
          const j = (await r.json()) as { timestamp?: number };
          const ts = j.timestamp;
          return ts != null && Number.isFinite(ts) ? ([h, ts] as const) : null;
        } catch {
          return null;
        }
      })
    ).then((pairs) => {
      if (stop) return;
      setBlockTs((prev) => {
        const next = { ...prev };
        for (const pair of pairs) if (pair) next[pair[0]] = pair[1];
        return next;
      });
    });
    return () => {
      stop = true;
    };
  }, [heightKey]);
  const priceKey = [
    ...new Set(
      (snap?.reserves ?? [])
        .filter((row) => row.kind === "token" && row.ergValueNano == null && row.collateral?.tokenId)
        .map((row) => row.collateral!.tokenId)
    ),
  ]
    .sort()
    .join(",");
  useEffect(() => {
    if (!priceKey) return;
    let stop = false;
    const ids = priceKey.split(",");
    void Promise.all(
      ids.map(async (id) => {
        try {
          const price = await ergPerToken(id);
          return price != null && price > 0 ? ([id, price] as const) : null;
        } catch {
          return null;
        }
      })
    ).then((pairs) => {
      if (stop) return;
      const map: Record<string, number> = {};
      for (const pair of pairs) if (pair) map[pair[0]] = pair[1];
      setPricePack({ key: priceKey, map });
    });
    return () => {
      stop = true;
    };
  }, [priceKey]);
  const prices = pricePack.key === priceKey ? pricePack.map : {};
  const rows = [...(snap?.reserves ?? [])].sort((a, b) => {
    const sign = dir === "asc" ? 1 : -1;
    if (sort === "amount") {
      const av = rowErgNano(a, prices);
      const bv = rowErgNano(b, prices);
      if (av == null && bv == null) return (b.height ?? 0) - (a.height ?? 0);
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av === bv) return 0;
      return av > bv ? sign : -sign;
    }
    const at = a.createdAt ?? a.height ?? 0;
    const bt = b.createdAt ?? b.height ?? 0;
    return at === bt ? 0 : at > bt ? sign : -sign;
  });
  const erg =
    ready && snap?.ergLockedNano != null ? fmtUnits(snap.ergLockedNano, 9, loc) : null;
  const summed = rows.reduce((sum, row) => sum + (rowErgNano(row, prices) ?? 0n), 0n);
  const totalNano = ready ? summed.toString() : null;
  const unpriced = rows.filter((row) => row.kind === "token" && rowErgNano(row, prices) == null).length;
  const pageStart = Math.min(
    offset,
    Math.floor(Math.max(0, rows.length - 1) / PAGE) * PAGE
  );
  const pageRows = rows.slice(pageStart, pageStart + PAGE);
  const toggleSort = (key: SortKey) => {
    setOffset(0);
    if (sort === key) setDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSort(key);
      setDir("desc");
    }
  };

  const kpis = [
    {
      label: t("basis.safes"),
      value: ready && snap?.reserveCount != null ? snap.reserveCount.toLocaleString(loc) : miss,
      unavailable: !ready,
      sub: t("basis.safesSub"),
      mark: <KpiMarkVault tone={INK.gold} />,
      ink: INK.gold,
      enter: 0,
    },
    {
      label: t("basis.erg"),
      value: erg != null ? `${erg} ERG` : miss,
      unavailable: erg == null,
      sub: t("basis.ergSub"),
      mark: <KpiMarkWalletMinimal tone={INK.cyan} />,
      ink: INK.cyan,
      enter: 1,
    },
    {
      label: t("basis.total"),
      value: totalNano != null ? describeRentErg(totalNano).text ?? miss : miss,
      unavailable: totalNano == null,
      sub: unpriced > 0 ? t("basis.totalGap") : t("basis.totalSub"),
      mark: <KpiMarkCoins tone={INK.teal} />,
      ink: INK.teal,
      enter: 2,
    },
    {
      label: t("basis.tokenSafes"),
      value:
        ready && snap?.tokenReserveCount != null
          ? snap.tokenReserveCount.toLocaleString(loc)
          : miss,
      unavailable: !ready,
      sub: t("basis.tokenSafesSub"),
      mark: <KpiMarkBox tone={INK.violet} />,
      ink: INK.violet,
      enter: 3,
    },
    {
      label: t("basis.trackers"),
      value: ready && snap?.trackerCount != null ? snap.trackerCount.toLocaleString(loc) : miss,
      unavailable: !ready,
      sub: t("basis.trackersSub"),
      mark: <KpiMarkFingerprint tone={INK.green} />,
      ink: INK.green,
      enter: 4,
    },
  ];

  return (
    <Shell>
      <KpiGrid items={kpis} dense className="mb-4" />
      <article
        className="home-tile-enter mb-2 flex min-w-0 flex-col gap-3 rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3 sm:flex-row sm:items-stretch"
        style={{ "--enter": 4 } as CSSProperties}
      >
        <div className="min-w-0 max-w-3xl">
          <h2 className="text-[13px] font-medium text-[var(--muted)]">{t("basis.protocol")}</h2>
          <p className="mt-2 text-[14px] font-semibold leading-none">Basis</p>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--text)]">
            {t("basis.protocolBody")}
          </p>
          <a
            href={TRACKER_REPO}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-[13px] text-accent hover:underline"
          >
            {t("basis.link")}
          </a>
        </div>
        <div className="basis-mark-lane relative min-h-28 flex-1 overflow-hidden">
          <div className="basis-mark-swim">
            <img
              src="/basis-mark.png"
              alt=""
              width={64}
              height={96}
              className="basis-mark-bob h-24 w-auto object-contain"
            />
          </div>
        </div>
      </article>
      {!ready ? (
        <p className="text-[13px] text-[var(--muted)]">{t("basis.unavailable")}</p>
      ) : !rows.length ? (
        <p className="text-[13px] text-[var(--muted)]">{t("basis.empty")}</p>
      ) : (
        <div className="addr-sheet">
          <div className="addr-pan">
            <div className="addr-head addr-lane addr-lane-x basis-tape text-[12px] font-medium">
              <SortHead
                label={t("basis.colLocked")}
                on={sort === "amount"}
                dir={dir}
                onClick={() => toggleSort("amount")}
              />
              <span>{t("basis.colOwner")}</span>
              <span>{t("basis.colCreator")}</span>
              <span>{t("basis.colTracker")}</span>
              <span className="is-end">{t("basis.colBlock")}</span>
              <SortHead
                label={t("basis.colCreated")}
                on={sort === "created"}
                dir={dir}
                align="end"
                onClick={() => toggleSort("created")}
              />
              <span className="is-end">{t("basis.colStatus")}</span>
            </div>
            {pageRows.map((row) => {
              const ticker = lockedTicker(row);
              const amount =
                row.kind === "erg"
                  ? fmtUnits(row.nano, 9, loc)
                  : row.collateral
                    ? fmtUnits(row.collateral.amount, row.collateral.decimals, loc)
                    : "—";
              const urgent = row.status === "refund" || row.status === "refundReady";
              const tone =
                row.status === "quiet"
                  ? { color: "var(--up)", wash: "var(--up)" }
                  : row.status === "open"
                    ? { color: "var(--accent)", wash: "var(--accent)" }
                    : urgent
                      ? { color: INK.gold, wash: "#e0b15a" }
                      : { color: INK.violet, wash: "#c4b5fd" };
              const whenTs = row.createdAt ?? (row.height != null ? blockTs[row.height] : null);
              const state = statusCopy(row, t, locale);
              const trackerId = row.trackerNft;
              return (
                <div
                  key={row.boxId}
                  className="addr-lane addr-lane-x basis-tape border-t border-[var(--border-soft)] text-[13px]"
                >
                  <Link
                    prefetch={false}
                    href={`/box/${row.boxId}`}
                    className="flex min-w-0 items-center gap-2.5 font-medium text-[var(--text)] hover:underline"
                  >
                    <TokenAvatar tokenId={row.collateral?.tokenId ?? ERG_ZERO} size={22} />
                    <span className="min-w-0">
                      <span className="block truncate tabular-nums">
                        {amount}{" "}
                        <span style={{ color: row.kind === "erg" ? INK.gold : tokenTickerInk(row.collateral?.tokenId) }}>
                          {ticker}
                        </span>
                      </span>
                    </span>
                  </Link>
                  <span
                    className="truncate font-mono text-[12px]"
                    style={{ color: INK.violet }}
                    title={row.owner ?? undefined}
                  >
                    {row.owner ? shortId(row.owner, 4) : "—"}
                  </span>
                  {row.creator ? (
                    <Link
                      prefetch={false}
                      href={`/address/${row.creator}`}
                      className="truncate font-mono text-[12px] text-soft hover:underline"
                      title={row.creator}
                    >
                      {shortId(row.creator, 4)}
                    </Link>
                  ) : (
                    <span className="text-[12px] text-[var(--muted)]">—</span>
                  )}
                  {trackerId ? (
                    <Link
                      prefetch={false}
                      href={row.trackerBoxId ? `/box/${row.trackerBoxId}` : `/token/${trackerId}`}
                      className="truncate font-mono text-[12px] text-soft hover:underline"
                      title={trackerId}
                    >
                      {shortId(trackerId, 4)}
                    </Link>
                  ) : (
                    <span className="text-[12px] text-[var(--muted)]">—</span>
                  )}
                  {row.height != null ? (
                    <Link
                      prefetch={false}
                      href={`/block/${row.height}`}
                      className="is-end font-mono text-[12px] tabular-nums text-soft hover:underline"
                    >
                      #{row.height.toLocaleString(loc)}
                    </Link>
                  ) : (
                    <span className="is-end text-[var(--muted)]">—</span>
                  )}
                  <div className="basis-when">
                    <p className={clsx("whitespace-nowrap tabular-nums", relAgeToneClass(relAgeTone(whenTs)))}>
                      {formatRelTime(whenTs, locale)}
                    </p>
                    <p className="mt-0.5 whitespace-nowrap text-[12px] tabular-nums text-[var(--muted-2)]">
                      {formatFactWhen(whenTs, loc)}
                    </p>
                  </div>
                  <span className="is-end">
                    <span
                      className="whitespace-nowrap rounded-full px-2.5 py-1 text-[12px]"
                      style={{
                        color: tone.color,
                        background: `color-mix(in srgb, ${tone.wash} 16%, transparent)`,
                      }}
                      title={state.hint}
                    >
                      {state.label}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
          <RankWindow
            offset={pageStart}
            pageSize={PAGE}
            shown={pageRows.length}
            total={rows.length}
            loc={loc}
            ofLabel={t("addresses.packOf")}
            prevLabel={t("addresses.packPrev")}
            nextLabel={t("addresses.packNext")}
            tapeLabel={t("basis.packTape")}
            hint={t("basis.packHint")}
            onOffset={setOffset}
          />
        </div>
      )}
    </Shell>
  );
}
