"use client";

import { useState } from "react";
import { FeedPlate } from "@/components/feed/Feed";
import { formatGroupedInt } from "@/lib/format";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { BlockHeaderFields } from "@/lib/list-snapshots";

function grouped(raw: string | null, locale: string): string {
  if (!raw) return "";
  try {
    return formatGroupedInt(BigInt(raw), locale).replace(/\u00a0/g, " ");
  } catch {
    return raw;
  }
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
      onClick={() => {
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

function HexRow({
  label,
  value,
  copyText,
  copyLabel,
  copiedLabel,
  numeric = false,
  tone,
}: {
  label: string;
  value: string;
  copyText: string;
  copyLabel: string;
  copiedLabel: string;
  numeric?: boolean;
  tone?: string;
}) {
  return (
    <div className={tone ? `hdr-row is-${tone}` : "hdr-row"}>
      <div className="hdr-k">{label}</div>
      {value ? (
        <code className={numeric ? "hdr-num" : "hdr-hex"}>{value}</code>
      ) : (
        <span className="hdr-empty">—</span>
      )}
      {copyText ? (
        <CopyChip text={copyText} copyLabel={copyLabel} copiedLabel={copiedLabel} />
      ) : (
        <span />
      )}
    </div>
  );
}

export function BlockHeaderSheet({
  header,
  t,
}: {
  header: BlockHeaderFields;
  t: (k: string) => string;
}) {
  const { locale } = useI18n();
  const copyLabel = t("tx.copy");
  const copiedLabel = t("tx.copied");
  const roots: { label: string; value: string; tone: string }[] = [
    { label: t("block.header.state"), value: header.stateRoot, tone: "violet" },
    { label: t("block.header.txRoot"), value: header.transactionsRoot, tone: "cyan" },
    { label: t("block.header.ad"), value: header.adProofsRoot, tone: "teal" },
    { label: t("block.header.extension"), value: header.extensionHash, tone: "gold" },
  ];
  const proof: { label: string; value: string; copy: string; numeric?: boolean; tone: string }[] = [
    { label: "pk", value: header.powPk ?? "", copy: header.powPk ?? "", tone: "sky" },
    { label: "w", value: header.powW ?? "", copy: header.powW ?? "", tone: "green" },
    { label: "n", value: header.powN ?? "", copy: header.powN ?? "", tone: "gold" },
    { label: "d", value: grouped(header.powD, locale), copy: header.powD ?? "", numeric: true, tone: "coral" },
  ];
  return (
    <section className="hdr-doc" aria-label={t("block.tab.header")}>
      <dl className="hdr-facts">
        <div className="hdr-fact is-violet">
          <dt>{t("block.header.version")}</dt>
          <dd>{header.version ?? "—"}</dd>
        </div>
        <div className="hdr-fact is-sky">
          <dt>{t("block.header.votes")}</dt>
          <dd>
            {header.votes.length ? (
              <span className="hdr-votes">
                {header.votes.map((v, i) => (
                  <span key={i} className={v ? "hdr-vote is-on" : "hdr-vote"}>
                    {v}
                  </span>
                ))}
              </span>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div className="hdr-fact is-gold">
          <dt>{t("block.header.bits")}</dt>
          <dd>{grouped(header.nBits, locale) || "—"}</dd>
        </div>
        <div className="hdr-fact is-teal">
          <dt>{t("block.header.difficulty")}</dt>
          <dd>{grouped(header.difficulty, locale) || "—"}</dd>
        </div>
      </dl>
      <div className="feed hdr-feed">
        <section className="feed-day">
          <FeedPlate tag={t("block.header.roots")} />
          <div className="hdr-rows">
          {roots.map((row) => (
            <HexRow
              key={row.label}
              label={row.label}
              value={row.value}
              copyText={row.value}
              copyLabel={copyLabel}
              copiedLabel={copiedLabel}
              tone={row.tone}
            />
          ))}
          </div>
        </section>
        <section className="feed-day">
          <FeedPlate tag={t("block.header.pow")} />
          <div className="hdr-rows">
          {proof.map((row) => (
            <HexRow
              key={row.label}
              label={row.label}
              value={row.value}
              copyText={row.copy}
              copyLabel={copyLabel}
              copiedLabel={copiedLabel}
              numeric={row.numeric}
              tone={row.tone}
            />
          ))}
          </div>
        </section>
      </div>
    </section>
  );
}
