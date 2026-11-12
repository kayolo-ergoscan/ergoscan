"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { EvidenceBadge } from "@/components/EvidenceBadge";
import { publicGatewayHref } from "@/lib/config";
import {
  formatErgPrecise,
  formatFeeRate,
  formatTokenAmount,
  shortId,
} from "@/lib/format";
import type { TxPageSnapshot, TxTokenMeta } from "@/lib/list-snapshots";
import { tokenDecimals, tokenSymbol } from "@/lib/token-meta";
import { explainTransaction } from "@/lib/tx-explain";
import type { TxIo } from "@/lib/tx-flow";
import { useI18n, useT } from "@/lib/i18n/I18nProvider";

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template
  );
}

export function TxExplanationPanel({
  tx,
  inputs,
  outputs,
  protocolLabel,
  tokens,
}: {
  tx: TxPageSnapshot;
  inputs: TxIo[];
  outputs: TxIo[];
  protocolLabel: string | null;
  tokens: Map<string, TxTokenMeta>;
}) {
  const t = useT();
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  const explanation = useMemo(
    () =>
      explainTransaction({
        confirmed: tx.confirmed,
        source: tx.source,
        size: tx.size,
        fee: tx.fee,
        category: tx.category,
        shape: tx.shape,
        protocolHint: protocolLabel,
        inputCount: tx.inputCount,
        outputCount: tx.outputCount,
        assetsComplete: tx.assetsComplete,
        inputs,
        outputs,
        dataInputs: (tx.dataInputs ?? []) as TxIo[],
      }),
    [inputs, outputs, protocolLabel, tx]
  );

  const shapeKey = `tx.explain.shape.${explanation.shape}`;
  const translatedShape = t(shapeKey);
  const shapeText =
    explanation.coverage !== "complete"
      ? t("tx.explain.shape.partial")
      : translatedShape === shapeKey
      ? fill(t("tx.explain.shape.unknown"), { shape: explanation.shape })
      : translatedShape;
  const ioText = fill(t("tx.explain.io"), {
    inputs: explanation.actualInputs,
    outputs: explanation.actualOutputs,
  });
  const coverageText =
    explanation.coverage === "complete"
      ? t("tx.explain.coverage.complete")
      : explanation.coverage === "partial"
        ? fill(t("tx.explain.coverage.partial"), {
            inputs: explanation.resolvedInputs,
            inputTotal: explanation.declaredInputs ?? "?",
            outputs: explanation.resolvedOutputs,
            outputTotal: explanation.declaredOutputs ?? "?",
          })
        : t("tx.explain.coverage.unknown");
  const labelShape =
    explanation.coverage === "complete"
      ? explanation.shape
      : tx.shape || tx.category || explanation.shape;
  const categoryKey = `tx.cat.${labelShape}`;
  const translatedCategory = t(categoryKey);
  const categoryLabel =
    translatedCategory !== categoryKey ? translatedCategory : t("tx.cat.unknown");
  const isFeeCollect = explanation.shape === "fee-collect";
  const compactFee =
    isFeeCollect && explanation.nonFeeOutputNano > 0n
      ? `${formatErgPrecise(explanation.nonFeeOutputNano, locale, false)} ERG`
      : explanation.feeNano > 0n
        ? `${formatErgPrecise(explanation.feeNano, locale, false)} ERG`
        : t("tx.explain.fee.none");
  const compactText = fill(
    t(isFeeCollect ? "tx.explain.compact.collect" : "tx.explain.compact"),
    {
      effect: categoryLabel,
      inputs: explanation.actualInputs,
      outputs: explanation.actualOutputs,
      fee: compactFee,
    }
  );

  return (
    <section
      id="explanation"
      className="mod rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-3"
      aria-labelledby="tx-explanation-title"
    >
      <button
        type="button"
        className={clsx(
          "chip-press w-full overflow-hidden rounded-[10px] px-2 py-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
          open && "is-pressed"
        )}
        aria-expanded={open}
        aria-controls="tx-explanation-details"
        onClick={() => setOpen((value) => !value)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--muted-2)]">
              {t("tx.explain.eyebrow")}
            </p>
            <h2
              id="tx-explanation-title"
              className="mt-1 text-[17px] font-semibold leading-tight text-[var(--text)]"
            >
              {t("tx.explain.title")}
            </h2>
            <p className="mt-1 text-[12px] leading-snug text-[var(--muted)]">
              {compactText}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <div className="hidden items-center gap-1.5 md:flex">
              <EvidenceBadge kind={explanation.source === "index" ? "chain" : "live"} />
              <EvidenceBadge kind="decoded" />
              <span className="rounded-full bg-[var(--wash)] px-2 py-1 font-mono text-[10px] text-[var(--muted)]">
                {fill(t("tx.explain.rules"), { version: explanation.version })}
              </span>
            </div>
            <span className="hidden text-[11px] text-[var(--accent)] sm:inline">
              {t(open ? "tx.explain.collapse" : "tx.explain.expand")}
            </span>
            <Chevron open={open} />
          </div>
        </div>
      </button>

      <div
        id="tx-explanation-details"
        className={clsx(
          "grid transition-[grid-template-rows,opacity] duration-[400ms] ease-[var(--ease)]",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="overflow-hidden">
          <div className="pt-3">

            <p className="max-w-3xl text-[13px] leading-relaxed text-[var(--muted)]">
              {t("tx.explain.lead")}
            </p>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        <ExplainFact label={t("tx.explain.fact.effect")} body={shapeText}>
          {explanation.protocolHint ? (
            <p className="mt-1 text-[12px] leading-snug text-[var(--muted-2)]">
              {fill(t("tx.explain.protocol"), {
                protocol: explanation.protocolHint,
              })}
            </p>
          ) : null}
        </ExplainFact>

        <ExplainFact label={t("tx.explain.fact.boxes")} body={ioText}>
          {explanation.selfFlows.length ? (
            <p className="mt-1 text-[12px] leading-snug text-[var(--muted-2)]">
              {fill(
                t(
                  explanation.selfFlows.length === 1
                    ? "tx.explain.self.one"
                    : "tx.explain.self.many"
                ),
                { n: explanation.selfFlows.length }
              )}
            </p>
          ) : null}
        </ExplainFact>

        <ExplainFact
          label={t(isFeeCollect ? "tx.explain.fact.collected" : "tx.explain.fact.fee")}
          body={
            isFeeCollect && explanation.nonFeeOutputNano > 0n
              ? `${formatErgPrecise(explanation.nonFeeOutputNano, locale, false)} ERG`
              : explanation.feeNano > 0n
                ? `${formatErgPrecise(explanation.feeNano, locale, false)} ERG`
                : t("tx.explain.fee.none")
          }
        >
          {explanation.feeRateNanoPerByte != null ? (
            <p className="mt-1 text-[12px] leading-snug text-[var(--muted-2)]">
              {formatFeeRate(explanation.feeRateNanoPerByte)}
            </p>
          ) : null}
        </ExplainFact>

        <ExplainFact
          label={t("tx.explain.fact.status")}
          body={
            explanation.confirmed
              ? t("tx.explain.status.confirmed")
              : t("tx.explain.status.mempool")
          }
        >
          <p
            className={
              explanation.coverage === "complete"
                ? "mt-1 text-[12px] leading-snug text-[var(--muted-2)]"
                : "mt-1 text-[12px] leading-snug text-[var(--warning)]"
            }
          >
            {coverageText}
          </p>
        </ExplainFact>
      </div>

      {explanation.tokenChanges.length ? (
        <div className="mt-3 border-t border-[var(--border-soft)] pt-3">
          <p className="text-[12px] font-medium text-[var(--muted)]">
            {t("tx.explain.tokenChanges")}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {explanation.tokenChanges.slice(0, 6).map((change) => {
              const meta = tokens.get(change.tokenId.toLowerCase());
              const symbol =
                tokenSymbol(change.tokenId, meta?.name) || shortId(change.tokenId, 4);
              const decimals = tokenDecimals(change.tokenId, meta?.decimals);
              const raw =
                change.kind === "mint"
                  ? change.outAmt
                  : change.kind === "burn"
                    ? change.inAmt
                    : change.outAmt - change.inAmt;
              const amount = formatTokenAmount(raw, decimals, locale);
              return (
                <Link
                  prefetch={false}
                  key={change.tokenId}
                  href={`/token/${change.tokenId}`}
                  className="rounded-full bg-[var(--wash)] px-2.5 py-1 text-[11px] text-[var(--text)] transition-colors duration-[400ms] hover:bg-[var(--wash-mid)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  {t(`tx.explain.token.${change.kind}`)}{" "}
                  <span className="font-mono">{amount}</span> {symbol}
                </Link>
              );
            })}
            {explanation.tokenChanges.length > 6 ? (
              <span className="rounded-full bg-[var(--wash-faint)] px-2.5 py-1 text-[11px] text-[var(--muted)]">
                {fill(t("tx.explain.token.more"), {
                  n: explanation.tokenChanges.length - 6,
                })}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--border-soft)] pt-3 text-[11px] text-[var(--muted-2)]">
        <span>{t("tx.explain.noIntent")}</span>
        <Link prefetch={false} href="/learn#evidence" className="text-[var(--accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
          {t("tx.explain.how")}
        </Link>
        <a
          href={publicGatewayHref(`/v1/transactions/${encodeURIComponent(tx.id)}`)}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[var(--accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          {t("tx.explain.verify")}
        </a>
      </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={clsx(
        "h-5 w-5 text-[var(--accent)] transition-transform duration-[400ms] ease-[var(--ease)]",
        open && "rotate-180"
      )}
    >
      <path
        d="m5.5 7.5 4.5 4.5 4.5-4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExplainFact({
  label,
  body,
  children,
}: {
  label: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <article className="rounded-[14px] bg-[var(--wash-faint)] px-3 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted-2)]">
        {label}
      </p>
      <p className="mt-1 text-[13px] font-medium leading-snug text-[var(--text)]">
        {body}
      </p>
      {children}
    </article>
  );
}
