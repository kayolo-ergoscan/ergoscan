"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { encode } from "uqr";
import clsx from "clsx";
import { copyText } from "@/lib/copy-text";

function encodeOrThrow(text: string) {
  return encode(text, { ecc: "M", border: 2, maxVersion: 40 });
}

/** Raw address when it fits a QR; otherwise the open page URL. */
export function qrPayload(address: string, pageUrl?: string): string {
  try {
    encodeOrThrow(address);
    return address;
  } catch {
    if (pageUrl) return pageUrl;
    return address;
  }
}

/** Content height of a stat tile — ignore stretch when the identity card is tall. */
function naturalStatHeight(stat: HTMLElement): number {
  const cs = getComputedStyle(stat);
  const chrome =
    parseFloat(cs.paddingTop) +
    parseFloat(cs.paddingBottom) +
    parseFloat(cs.borderTopWidth) +
    parseFloat(cs.borderBottomWidth);
  const col =
    stat.querySelector<HTMLElement>(":scope > .kpi-tile-body") ??
    ([...stat.children].find((el) => {
      const node = el as HTMLElement;
      return !node.classList.contains("kpi-tile-rail") && !node.classList.contains("kpi-tile-mark");
    }) as HTMLElement | undefined);
  let content = 0;
  if (col) {
    for (const child of col.children) {
      const node = child as HTMLElement;
      // The label row is `display: contents` on desk and has no box of its own:
      // count the label it holds.
      if (getComputedStyle(node).display === "contents") {
        for (const inner of node.children) content += (inner as HTMLElement).offsetHeight;
      } else {
        content += node.offsetHeight;
      }
    }
  }
  const mark = stat.querySelector<HTMLElement>(":scope > .kpi-tile-mark");
  return Math.max(content, mark?.offsetHeight ?? 0) + chrome;
}

const QR_SIDE_MAX = 256;

function tilePairSide(facts: HTMLElement): number {
  const stat = facts.querySelector<HTMLElement>(".addr-facts-stat");
  const lane = facts.querySelector<HTMLElement>(":scope > .addr-lane");
  if (!stat) return 0;
  const h = naturalStatHeight(stat);
  if (h < 8) return 0;
  const gapRaw = lane ? getComputedStyle(lane).rowGap : "0.5rem";
  const gap = Number.parseFloat(gapRaw) || 8;
  return Math.min(QR_SIDE_MAX, h * 2 + gap);
}

export function AddressQr({
  address,
  label,
  copyLabel,
  copiedLabel,
  className,
  enter,
  embed,
}: {
  address: string;
  label: string;
  copyLabel: string;
  copiedLabel: string;
  className?: string;
  /** Home-style sheet enter. Index is the step in the cascade. */
  enter?: number;
  /** Sit inside the balance tile; do not size the facts QR column. */
  embed?: boolean;
}) {
  const hostRef = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState("");
  const [copied, setCopied] = useState(false);
  const payload = useMemo(
    () =>
      qrPayload(
        address,
        typeof window !== "undefined" ? window.location.href : undefined
      ),
    [address]
  );

  useLayoutEffect(() => {
    if (embed) return;
    const host = hostRef.current;
    const facts = host?.closest<HTMLElement>(".addr-facts");
    const page = host?.closest<HTMLElement>(".addr-page");
    const stat = facts?.querySelector<HTMLElement>(".addr-facts-stat");
    const lane = facts?.querySelector<HTMLElement>(":scope > .addr-lane");
    if (!host || !facts || !stat) return;

    const sync = () => {
      const side = tilePairSide(facts);
      if (side > 0) {
        const next = `${side}px`;
        if (facts.style.getPropertyValue("--addr-qr-side") !== next) {
          facts.style.setProperty("--addr-qr-side", next);
        }
        if (page && page.style.getPropertyValue("--addr-qr-side") !== next) {
          page.style.setProperty("--addr-qr-side", next);
        }
      }
      const laneH = lane?.getBoundingClientRect().height ?? 0;
      host.classList.toggle("is-mid", laneH > side + 24);
    };

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(stat);
    if (lane) ro.observe(lane);
    return () => ro.disconnect();
  }, [address, embed]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const paint = () => {
      let qr;
      try {
        qr = encodeOrThrow(payload);
      } catch {
        setSrc("");
        return;
      }
      const ink =
        getComputedStyle(host).getPropertyValue("--text").trim() || "#111";
      const box = Math.min(host.clientWidth, host.clientHeight);
      if (box < 8) return;
      const dpr = window.devicePixelRatio || 1;
      const cell = Math.max(1, Math.floor((box * dpr) / qr.size));
      const dim = qr.size * cell;
      const canvas = document.createElement("canvas");
      canvas.width = dim;
      canvas.height = dim;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, dim, dim);
      ctx.fillStyle = ink;
      for (let y = 0; y < qr.size; y++) {
        const row = qr.data[y];
        for (let x = 0; x < qr.size; x++) {
          if (row[x]) ctx.fillRect(x * cell, y * cell, cell, cell);
        }
      }
      setSrc(canvas.toDataURL("image/png"));
    };

    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(host);
    const mo = new MutationObserver(paint);
    mo.observe(document.documentElement, { attributes: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [payload]);

  return (
    <button
      ref={hostRef}
      type="button"
      className={clsx(
        "addr-qr-tile chip-press",
        embed ? "addr-qr-embed" : "addr-facts-qr",
        enter != null && "home-tile-enter",
        className
      )}
      style={enter != null ? { ["--enter" as string]: enter } : undefined}
      onClick={() => {
        void copyText(address)?.then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
      aria-label={copied ? copiedLabel : `${label}. ${copyLabel}`}
    >
      {src ? <img src={src} alt="" /> : <span className="addr-qr-tile-ph" />}
    </button>
  );
}
