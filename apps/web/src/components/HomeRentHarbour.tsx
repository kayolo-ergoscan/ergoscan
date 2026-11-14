"use client";

/**
 * Home «Рента этой эпохи» + «Токены под угрозой» as one harbour (concept A «Маяк», approved by the
 * operator 14.11.2026). Rent: boats (the tape's addresses) sail for the lighthouse (four years),
 * the collector's tug works the berth, the horizon lights are the rest of this epoch's boxes.
 * Danger: the same water at the reef, one boat per token whose boxes hold less ERG than their rent.
 * The painters live in lib/home-rent; the engine draws on demand only (no frames at rest).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { useReducedMotion } from "framer-motion";
import { ERGO_HEADER_EPOCH_LEN, headerEpochBlocksLeft, rentTapeClock, type RentCollectedEvent, type RentEpochCollected, type RentTapeRow } from "@ergoscan/shared";
import { ReelText } from "@/components/ReelText";
import { Tip, TipHead, TipNote, TipRow, TipRows, useFloatTip, type TipRect } from "@/components/Tip";
import { TokenLogo } from "@/components/TokenBadge";
import { listPip } from "@/lib/address-pips";
import { formatErgFixed, formatScaledGlance, formatUsd, shortId } from "@/lib/format";
import { HOME, INK } from "@/lib/palette";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";
import { countText } from "@/lib/i18n/messages";
import { groupRentDanger, type RentDangerGroup, type RentDangerRow } from "@/lib/rent-danger";
import { resolveTokenMeta } from "@/lib/token-meta";
import { HarbourEngine, type HarbourText } from "@/lib/home-rent/engine";
import { onRentCollected } from "@/lib/home-rent/feed";
import { REEF_SEA_FR, reefBoatX, reefGeo, reefMastTop, toneOf, type HarbourBoat, type HarbourHit, type ReefLane } from "@/lib/home-rent/scene";

/** The clock counts two minutes a block. */
const CLOCK_BLOCK_MS = 120_000;
/** Reef lane height: desktop / phone. The canvas lanes and the DOM rows share it. */
const PITCH_DESK = 26;
const PITCH_PHONE = 30;
/** Below the desktop grid every token shows, up to this many; more get an honest «+N». */
const STACK_LANES = 12;
const LOGO_DESK = 14;
const LOGO_PHONE = 15;

type T = (k: string) => string;

function clockText(blocks: number, t: T): string {
  const clock = rentTapeClock(blocks);
  if (clock.due) return t("home.rentDue");
  return t(`rent.clock.${clock.unit}`).replace("{n}", String(clock.n));
}

function whenText(blocks: number, t: T): string {
  const clock = rentTapeClock(blocks);
  return clock.due ? t("home.rentDue") : t("home.rentIn").replace("{t}", clockText(blocks, t));
}

/** Figures printed in coral or gold take the theme's text ink when it has one (light card). */
const TEXT_CORAL = `var(--ink-coral-text, ${INK.coral})`;
const TEXT_GOLD = `var(--ink-gold-text, ${INK.gold})`;

/** The «when» tone of a head boat or a token: words (`text`) or a mark (a tip's chip). */
function toneInk(blocks: number, text = true): string | undefined {
  const tone = toneOf(blocks);
  if (tone === "due") return text ? TEXT_CORAL : INK.coral;
  if (tone === "soon") return text ? TEXT_GOLD : INK.gold;
  return undefined;
}

function usdText(usd: number): string {
  if (usd >= 0.01) return formatUsd(usd);
  if (usd > 0) return "<$0.01";
  return "—";
}

function useCount(): (key: string, n: number) => string {
  const t = useT();
  const { locale } = useI18n();
  return (key, n) => countText(t, locale, key, n, n.toLocaleString(locale === "ru" ? "ru-RU" : "en-US"));
}

function useMedia(query: string): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return on;
}

export function HomeRentHarbour({
  rows,
  epochRentNano,
  epochBoxes = null,
  epochCollected = null,
  height = null,
  avgBlockMs = null,
  danger = [],
  dangerReady = false,
  previewShare = false,
  enter = 0,
}: {
  rows: RentTapeRow[];
  epochRentNano?: string | null;
  /** Boxes that turn four years old before this header epoch ends. */
  epochBoxes?: number | null;
  /** Rent miners collected since this epoch began (the snapshot's exact sum). */
  epochCollected?: RentEpochCollected | null;
  height?: number | null;
  avgBlockMs?: number | null;
  danger?: RentDangerRow[];
  dangerReady?: boolean;
  previewShare?: boolean;
  enter?: number;
}) {
  const t = useT();
  const { locale } = useI18n();
  const loc = locale === "ru" ? "ru-RU" : "en-US";
  const count = useCount();
  const router = useRouter();
  const reduce = !!useReducedMotion();
  const phone = useMedia("(max-width: 639px)");
  /** The desktop grid: the reef fills the card's height; below it the card grows with its lanes. */
  const wide = useMedia("(min-width: 1024px)");
  const hostRef = useRef<HTMLElement>(null);
  const rentRef = useRef<HTMLCanvasElement>(null);
  const reefRef = useRef<HTMLCanvasElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<HarbourEngine | null>(null);
  const [lastClaim, setLastClaim] = useState<RentCollectedEvent | null>(null);
  const [live, setLive] = useState("");
  const [listBox, setListBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  /* ---------- data ---------- */
  const boats: HarbourBoat[] = useMemo(
    () => rows.map((r) => ({ address: r.address, boxCount: r.boxCount, blocksUntilRent: r.blocksUntilRent, rentNano: r.rentNano, valueNano: r.valueNano })),
    [rows]
  );
  const byAddr = useMemo(() => new Map(rows.map((r) => [r.address, r])), [rows]);
  const head = rows[0] ?? null;
  const groups = useMemo(() => groupRentDanger(danger), [danger]);
  const leads = useMemo(() => {
    const m = new Map<string, RentDangerRow>();
    for (const r of danger) {
      const have = m.get(r.tokenId);
      if (!have || r.blocksUntilRent < have.blocksUntilRent) m.set(r.tokenId, r);
    }
    return m;
  }, [danger]);
  const pitch = phone ? PITCH_PHONE : PITCH_DESK;
  const fit = wide ? Math.max(1, Math.floor(listBox.h / pitch)) : STACK_LANES;
  const overflow = groups.length > fit;
  const shownGroups = overflow ? groups.slice(0, Math.max(1, fit - 1)) : groups;
  const moreTokens = groups.length - shownGroups.length;
  const lanes: ReefLane[] = useMemo(
    () =>
      shownGroups.map((g) => {
        const lead = leads.get(g.tokenId);
        const v = Number(lead?.valueNano ?? 0);
        const r = Number(lead?.rentNano ?? 0);
        return { tokenId: g.tokenId, soonest: g.soonest, ratio: r > 0 ? Math.min(1, v / r) : 0 };
      }),
    [shownGroups, leads]
  );
  const total = useMemo(() => groups.reduce((sum, g) => sum + g.usd, 0), [groups]);
  const dangerBoxes = danger.length;

  /* ---------- the words the canvas draws ---------- */
  const text: HarbourText = useMemo(
    () => ({
      head: (b) => [clockText(b.blocksUntilRent, t), ` · ${formatErgFixed(b.rentNano, loc)}`],
      lights: (rest) => t("home.harbourLights").replace("{boxes}", count("home.rentBoxes", rest)),
      claim: (c) => [
        c.rentNano ? `+${formatErgFixed(c.rentNano, loc)} · ${count("home.rentBoxes", c.boxes)}` : `${count("home.rentBoxes", c.boxes)} · ${t("home.harbourCollected")}`,
        t("home.harbourBlock").replace("{n}", c.height.toLocaleString(loc)),
      ],
      epoch: (ep, boxes) => [
        t("home.harbourEpoch").replace("{n}", ep.toLocaleString(loc)),
        boxes != null ? t("home.harbourEpochBoxes").replace("{boxes}", count("home.harbourSubBoxes", boxes)) : "",
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, loc]
  );

  /* ---------- the engine ---------- */
  useEffect(() => {
    const host = hostRef.current;
    const rent = rentRef.current;
    if (!host || !rent) return;
    const e = new HarbourEngine({ rent, reef: reefRef.current, host, reduce, text });
    engineRef.current = e;
    return () => {
      e.destroy();
      engineRef.current = null;
    };
    // The engine lives as long as the cards; its inputs arrive through the setters below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => engineRef.current?.setReduce(reduce), [reduce]);
  useEffect(() => engineRef.current?.setText(text), [text]);
  useEffect(() => {
    engineRef.current?.setData({ boats, epochBoxes, height, lanes, pitch });
  }, [boats, epochBoxes, height, lanes, pitch]);

  // Rent collected in a new block: the moment, once per block, and a line for screen readers.
  useEffect(
    () =>
      onRentCollected((ev) => {
        setLastClaim(ev);
        engineRef.current?.claim(ev);
        const erg = ev.rentNano ? ` (+${formatErgFixed(ev.rentNano, loc)})` : "";
        setLive(t("home.harbourLive").replace("{n}", ev.height.toLocaleString(loc)).replace("{boxes}", count("home.harbourSubBoxes", ev.boxes)).replace("{erg}", erg));
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loc, t]
  );

  // Dev share preview (?preview=share): one demo moment from the head boat's own numbers.
  useEffect(() => {
    if (!previewShare || !head) return;
    const id = window.setTimeout(() => engineRef.current?.claim({ height: (height ?? 1) + 1, boxes: head.boxCount, rentNano: head.rentNano }), 1200);
    return () => window.clearTimeout(id);
  }, [previewShare, head, height]);

  // The reef list's size: how many lanes fit (desktop), and where the logos sit.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1]?.contentRect;
      if (r) setListBox((b) => (b.w === Math.round(r.width) && b.h === Math.round(r.height) ? b : { w: Math.round(r.width), h: Math.round(r.height) }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [groups.length > 0]);

  /* ---------- tips on the harbour ---------- */
  const rentTip = useFloatTip({ within: () => rentRef.current });
  const tipOn = useRef<string | null>(null);
  const touch = useRef({ down: false, open: false });
  // Only this epoch's sum: a snapshot from the last epoch says nothing about this one.
  const collected =
    epochCollected && height != null && epochCollected.fromHeight === height - (height % ERGO_HEADER_EPOCH_LEN) ? epochCollected : null;
  const rentLabel = epochRentNano != null && /^\d+$/.test(epochRentNano) ? formatErgFixed(epochRentNano, loc) : null;

  const tipFor = (hit: HarbourHit): ReactNode => {
    if (hit.kind === "boat") {
      const r = byAddr.get(hit.id);
      if (!r) return null;
      const pip = listPip(r.address, r.valueNano);
      const ink = toneInk(r.blocksUntilRent);
      return (
        <>
          <TipHead chip={t("home.harbourTipAddress")} ink={toneInk(r.blocksUntilRent, false) ?? "var(--c-address, #6db0f4)"} mono={!pip.name}>
            {pip.name || shortId(r.address, 6)}
          </TipHead>
          <TipRows>
            <TipRow label={t("home.harbourTipWhen")} ink={ink}>{whenText(r.blocksUntilRent, t)}</TipRow>
            <TipRow label={t("home.harbourTipBoxes")}>{r.boxCount.toLocaleString(loc)}</TipRow>
            <TipRow label={t("home.harbourTipRent")} ink={TEXT_CORAL}>{formatErgFixed(r.rentNano, loc)}</TipRow>
            <TipRow label={t("home.harbourTipValue")}>{formatErgFixed(r.valueNano, loc)}</TipRow>
          </TipRows>
          <TipNote>{t("home.harbourTipBoat")}</TipNote>
        </>
      );
    }
    if (hit.kind === "lighthouse") {
      return (
        <>
          <TipHead chip={t("home.harbourTipRule")} ink={INK.gold} />
          <TipRows>
            <TipRow label={t("home.harbourTipPeriod")}>{t("home.harbourTipPeriodV")}</TipRow>
            <TipRow label={t("home.harbourTipFee")}>{t("home.harbourTipFeeV")}</TipRow>
            {epochBoxes != null && rentLabel ? (
              <TipRow label={t("home.harbourTipEpoch")}>{`${t("home.rentUpTo")} ${rentLabel} · ${count("home.rentBoxes", epochBoxes)}`}</TipRow>
            ) : null}
            {collected ? (
              <TipRow label={t("home.harbourTipCollected")}>{`${formatErgFixed(collected.rentNano, loc)} · ${count("home.rentBoxes", collected.boxes)}`}</TipRow>
            ) : null}
          </TipRows>
          <TipNote>{t("home.harbourTipRuleNote")}</TipNote>
        </>
      );
    }
    if (hit.kind === "tug") {
      return (
        <>
          <TipHead chip={t("home.harbourTipTug")} ink={INK.coral} mono={!!lastClaim?.collector}>
            {lastClaim?.collector ? shortId(lastClaim.collector, 6) : null}
          </TipHead>
          {lastClaim ? (
            <TipRows>
              <TipRow label={t("home.harbourTipLast")}>{t("home.harbourBlock").replace("{n}", lastClaim.height.toLocaleString(loc))}</TipRow>
              <TipRow label={t("home.harbourTipBoxes")}>{lastClaim.boxes.toLocaleString(loc)}</TipRow>
              {lastClaim.rentNano ? <TipRow label={t("home.harbourTipRent")} ink={TEXT_GOLD}>{`+${formatErgFixed(lastClaim.rentNano, loc)}`}</TipRow> : null}
            </TipRows>
          ) : null}
          <TipNote>{t("home.harbourTipTugNote")}</TipNote>
        </>
      );
    }
    const carried = rows.reduce((s, r) => s + r.boxCount, 0);
    const rest = Math.max(0, (epochBoxes ?? 0) - carried);
    return (
      <>
        <TipHead chip={t("home.harbourTipLights")} ink={INK.gold} />
        <TipNote>{t("home.harbourTipLightsNote").replace("{boxes}", count("home.harbourSubBoxes", rest))}</TipNote>
      </>
    );
  };

  const pick = (ev: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }): { hit: HarbourHit; rect: TipRect } | null => {
    const r = ev.currentTarget.getBoundingClientRect();
    const hit = engineRef.current?.hit(ev.clientX - r.left, ev.clientY - r.top) ?? null;
    if (!hit) return null;
    return { hit, rect: { left: r.left + hit.x0, top: r.top + hit.y0, width: hit.x1 - hit.x0, height: hit.y1 - hit.y0 } };
  };
  const showTip = (p: { hit: HarbourHit; rect: TipRect } | null, tapped = false) => {
    const key = p ? `${p.hit.kind}:${p.hit.id}` : null;
    engineRef.current?.setHover("rent", p?.hit.kind === "boat" ? p.hit.id : null);
    if (!p || !key) {
      tipOn.current = null;
      rentTip.hide();
      return;
    }
    if (tipOn.current === key && rentTip.isOpen()) {
      rentTip.move(p.rect);
      return;
    }
    const body = tipFor(p.hit);
    if (!body) return;
    tipOn.current = key;
    rentTip.show(p.rect, body, { tapped });
  };
  const hrefFor = (hit: HarbourHit) => (hit.kind === "boat" ? `/address/${encodeURIComponent(hit.id)}` : "/rent");

  /* ---------- copy ---------- */
  let leftLabel: string | null = null;
  if (height != null && height >= 0) {
    const blockMs = avgBlockMs && avgBlockMs > 0 ? avgBlockMs : CLOCK_BLOCK_MS;
    const left = Math.max(1, Math.round((headerEpochBlocksLeft(height) * blockMs) / CLOCK_BLOCK_MS));
    leftLabel = t("home.rentEpochLeftShort").replace("{t}", clockText(left, t));
  }
  const geo = reefGeo(listBox.w || 300, phone);
  const logo = phone ? LOGO_PHONE : LOGO_DESK;
  // The first column is the water the boats sail in: REEF_SEA_FR of the width, as the painter has it.
  const cols = "grid-cols-[36%_minmax(0,1fr)_3.5rem_2.75rem] lg:max-xl:grid-cols-[36%_minmax(0,1fr)_2.75rem]";

  return (
    <section
      ref={hostRef}
      data-home-rent=""
      className="home-tile-enter grid h-full min-h-0 min-w-0 grid-cols-1 gap-2 max-lg:order-4 sm:grid-cols-2 lg:h-full"
      style={{ "--enter": enter } as CSSProperties}
    >
      {/* ---------- «Рента этой эпохи»: the harbour ---------- */}
      <article className="mod flex h-full min-h-0 min-w-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)]">
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[20px] px-4 py-3">
          <div className="flex min-h-[22px] shrink-0 items-center justify-between gap-3">
            <h2 className="m-0 shrink-0 whitespace-nowrap text-[13px] leading-none" style={{ color: HOME.forming }}>
              {t("home.rentEpochTitle")}
            </h2>
            {leftLabel ? <span className="min-w-0 truncate text-[12px] tabular-nums text-[var(--muted-2)]">{leftLabel}</span> : null}
          </div>
          <div className="mt-2.5 shrink-0">
            <p className="m-0 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 leading-none">
              {rentLabel ? <span className="text-[15px] font-medium text-[var(--muted-2)]">{t("home.rentUpTo")}</span> : null}
              <span
                className={clsx("whitespace-nowrap text-[26px] font-semibold tabular-nums tracking-tight lg:max-xl:text-[20px]", !rentLabel && "text-[var(--muted)]")}
                style={rentLabel ? { color: TEXT_CORAL } : undefined}
              >
                <ReelText text={rentLabel ?? "—"} />
              </span>
            </p>
            {epochBoxes != null && epochBoxes > 0 ? (
              <p className="m-0 mt-1.5 text-[12px] leading-[1.3] text-[var(--muted-2)]">
                {t("home.harbourSub").replace("{boxes}", count("home.harbourSubBoxes", epochBoxes))}
              </p>
            ) : null}
          </div>
          <div className="relative mt-2 h-[250px] min-w-0 shrink-0 sm:h-auto sm:min-h-[150px] sm:flex-1">
            {rows.length === 0 ? (
              <p className="absolute inset-0 m-0 flex items-center justify-center text-[13px] text-[var(--muted-2)]">{t("home.rentEmpty")}</p>
            ) : null}
            <canvas
              ref={rentRef}
              className={clsx("absolute inset-0 block h-full w-full select-none", rows.length === 0 && "opacity-0")}
              role="img"
              aria-label={t("home.harbourScene")}
              onPointerMove={(ev) => {
                if (ev.pointerType === "touch") return;
                const p = pick(ev);
                ev.currentTarget.style.cursor = p ? "pointer" : "default";
                showTip(p);
              }}
              onPointerLeave={(ev) => {
                if (ev.pointerType === "touch") return;
                ev.currentTarget.style.cursor = "default";
                showTip(null);
              }}
              onPointerDown={(ev) => {
                const down = ev.pointerType === "touch";
                const p = down ? pick(ev) : null;
                const key = p ? `${p.hit.kind}:${p.hit.id}` : null;
                touch.current = { down, open: Boolean(down && key && tipOn.current === key && rentTip.isOpen()) };
                if (!down || touch.current.open) return;
                showTip(p, true);
              }}
              onClick={(ev) => {
                const p = pick(ev);
                if (!p) return;
                // A tap first opens the tip; the second tap on the same thing follows it.
                if (touch.current.down && !touch.current.open) return;
                router.push(hrefFor(p.hit));
              }}
            />
          </div>
          <div className="sr-only">
            {rows.slice(0, 15).map((r) => (
              <Link prefetch={false} key={r.address} href={`/address/${encodeURIComponent(r.address)}`}>
                {`${shortId(r.address, 6)} · ${whenText(r.blocksUntilRent, t)} · ${formatErgFixed(r.rentNano, loc)}`}
              </Link>
            ))}
            <p aria-live="polite">{live}</p>
          </div>
          <div className="mt-2 flex shrink-0 items-baseline justify-between gap-3">
            <Link prefetch={false} href="/rent" className="shrink-0 text-[13px] text-[var(--muted)] hover:text-[var(--text)]">
              {t("home.rentAll")}
            </Link>
            {head ? (
              <Link prefetch={false} href={`/address/${encodeURIComponent(head.address)}`} className="flex min-w-0 items-baseline gap-1.5 text-[12px] text-[var(--muted-2)] hover:text-[var(--text)]">
                <span className="shrink-0 text-[var(--muted-2)]">{t("home.rentQueue").toLowerCase()}</span>
                <span className={clsx("min-w-0 truncate text-[var(--muted)]", !listPip(head.address).name && "font-mono")}>
                  {listPip(head.address).name || shortId(head.address, 6)}
                </span>
                <span className="shrink-0 tabular-nums" style={{ color: toneInk(head.blocksUntilRent) }}>
                  · {clockText(head.blocksUntilRent, t)}
                </span>
              </Link>
            ) : null}
          </div>
        </div>
      </article>

      {/* ---------- «Токены под угрозой»: the reef ---------- */}
      <article
        className="mod flex h-full min-h-0 min-w-0 flex-col rounded-[20px] border border-[var(--border)] bg-[var(--module)]"
        style={{ "--tag": "var(--c-token)" } as CSSProperties}
      >
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[20px] px-4 py-3">
          <div className="flex min-h-[22px] shrink-0 items-center justify-between gap-3">
            <h2 className="m-0 shrink-0 whitespace-nowrap text-[13px] leading-none" style={{ color: HOME.forming }}>
              {t("home.dangerTitle")}
            </h2>
            <span className="min-w-0 truncate text-[12px] tabular-nums text-[var(--muted-2)]">{t("home.dangerWindow")}</span>
          </div>
          {groups.length === 0 ? (
            dangerReady ? (
              <p className="m-0 mt-3 text-[13px] leading-snug text-[var(--muted)]">{t("home.rentDangerEmpty")}</p>
            ) : (
              <div className="min-h-[220px] flex-1" />
            )
          ) : (
            <>
              <div className="mt-2.5 shrink-0">
                <p className="m-0 text-[26px] font-semibold leading-none tabular-nums tracking-tight text-[var(--text)] lg:max-xl:text-[20px]">
                  {total > 0 ? `≈ ${usdText(total)}` : count("home.rentBoxes", dangerBoxes)}
                </p>
                <p className="m-0 mt-1.5 text-[12px] leading-[1.3] text-[var(--muted-2)]">
                  {t("home.dangerWhy").replace("{boxes}", count("home.dangerInBoxes", dangerBoxes))}
                </p>
              </div>
              <div className={clsx("mt-2 grid h-[18px] shrink-0 items-center gap-2 pr-1 text-[11px] text-[var(--muted-2)]", cols)}>
                <span className="col-span-2 flex min-w-0 items-baseline gap-1.5 overflow-hidden whitespace-nowrap">
                  <span className="font-semibold" style={{ color: TEXT_CORAL }}>{t("home.dangerReef")}</span>
                  <span className="truncate">{t("home.dangerReefScale")}</span>
                </span>
                <span className="text-right lg:max-xl:hidden">≈ $</span>
                <span className="text-right">{t("home.dangerColWhen")}</span>
              </div>
              <div
                ref={listRef}
                className={clsx("relative min-h-0 shrink-0 overflow-hidden", wide && "flex-1")}
                style={wide ? { minHeight: pitch * Math.min(4, groups.length) } : { height: (shownGroups.length + (moreTokens > 0 ? 1 : 0)) * pitch }}
                aria-label={t("home.dangerTitle")}
              >
                <canvas ref={reefRef} className="pointer-events-none absolute inset-0 block h-full w-full" aria-hidden />
                {shownGroups.map((g, i) => (
                  <ReefRow
                    key={g.tokenId}
                    group={g}
                    lead={leads.get(g.tokenId) ?? null}
                    top={i * pitch}
                    pitch={pitch}
                    cols={cols}
                    logoLeft={reefBoatX(geo, g.soonest) + geo.mast - logo / 2}
                    logoTop={Math.max(1, reefMastTop(pitch, lanes[i]?.ratio ?? 0, geo.s) - logo + 4)}
                    logo={logo}
                    height={height}
                    onHover={(id) => engineRef.current?.setHover("reef", id)}
                  />
                ))}
                {moreTokens > 0 ? (
                  <Link
                    prefetch={false}
                    href="/rent#danger"
                    className="absolute right-0 flex items-center text-[12px] text-[var(--muted)] hover:text-[var(--text)]"
                    style={{ top: shownGroups.length * pitch, height: pitch, left: `${REEF_SEA_FR * 100}%` }}
                  >
                    {t("home.dangerMore").replace("{tokens}", count("home.dangerTokens", moreTokens))}
                  </Link>
                ) : null}
              </div>
            </>
          )}
          <div className="mt-auto flex shrink-0 items-baseline pt-2">
            <Link prefetch={false} href="/rent#danger" className="text-[13px] text-[var(--muted)] hover:text-[var(--text)]">
              {dangerBoxes > 0 ? t("home.dangerAll").replace("{boxes}", count("home.rentBoxes", dangerBoxes)) : t("home.rentAll")}
            </Link>
          </div>
        </div>
      </article>
    </section>
  );
}

function ReefRow({
  group,
  lead,
  top,
  pitch,
  cols,
  logoLeft,
  logoTop,
  logo,
  height,
  onHover,
}: {
  group: RentDangerGroup;
  lead: RentDangerRow | null;
  top: number;
  pitch: number;
  cols: string;
  logoLeft: number;
  logoTop: number;
  logo: number;
  height: number | null;
  onHover: (id: string | null) => void;
}) {
  const t = useT();
  const { locale } = useI18n();
  const loc = locale === "ru" ? "ru-RU" : "en-US";
  const meta = resolveTokenMeta(group.tokenId, group.name, group.name);
  const glance = formatScaledGlance(group.amount, group.decimals ?? 0, loc);
  const ink = toneInk(group.soonest);
  const fz = pitch >= 30 ? "text-[13px]" : "text-[12.5px]";
  return (
    <Tip
      tap={false}
      content={() => (
        <>
          <TipHead chip={meta.symbol} ink="var(--c-token, #5b8dff)">
            {meta.name && meta.name !== meta.symbol ? meta.name : null}
          </TipHead>
          <TipRows>
            <TipRow label={t("home.dangerTipFirst")} ink={ink}>
              {`${whenText(group.soonest, t)}${height != null && group.soonest > 0 ? ` · ${t("home.harbourBlock").replace("{n}", (height + group.soonest).toLocaleString(loc))}` : ""}`}
            </TipRow>
            {lead ? <TipRow label={t("home.dangerTipErg")}>{formatErgFixed(lead.valueNano, loc)}</TipRow> : null}
            {lead ? <TipRow label={t("home.dangerTipRent")} ink={TEXT_CORAL}>{formatErgFixed(lead.rentNano, loc)}</TipRow> : null}
            <TipRow label={t("home.dangerTipAll")}>{`${glance.exact} · ${countText(t, locale, "home.rentBoxes", group.boxes)}`}</TipRow>
          </TipRows>
          <TipNote>{t("home.dangerTipNote")}</TipNote>
        </>
      )}
    >
      <Link
        prefetch={false}
        href={`/token/${group.tokenId}`}
        className={clsx("absolute inset-x-0 grid items-center gap-2 rounded-[6px] pr-1 hover:bg-[var(--wash)]", cols, fz)}
        style={{ top, height: pitch }}
        onPointerEnter={() => onHover(group.tokenId)}
        onPointerLeave={() => onHover(null)}
      >
        <span className="relative h-full">
          <span className="absolute" style={{ left: logoLeft, top: logoTop, width: logo, height: logo }}>
            <TokenLogo tokenId={group.tokenId} size={logo} />
          </span>
        </span>
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="min-w-0 truncate font-medium tracking-[-0.02em]">{meta.symbol}</span>
          {group.boxes > 1 ? <span className="shrink-0 text-[11px] tabular-nums text-[var(--muted-2)]">×{group.boxes}</span> : null}
        </span>
        <span className="text-right tabular-nums text-[var(--text)] lg:max-xl:hidden">{usdText(group.usd)}</span>
        <span className={clsx("whitespace-nowrap text-right tabular-nums", !ink && "text-[var(--muted)]")} style={ink ? { color: ink } : undefined}>
          {group.soonest <= 0 ? t("home.dangerNow") : clockText(group.soonest, t)}
        </span>
      </Link>
    </Tip>
  );
}
