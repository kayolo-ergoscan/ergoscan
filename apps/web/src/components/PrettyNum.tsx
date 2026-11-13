import clsx from "clsx";
import {
  describePrice,
  describeScaledAmount,
  describeUsd,
  toBigIntAmt,
} from "@/lib/format";

/** $0.0₄10 — subscript zeros, at most 4 significant digits after them. */
export function PrettyUsd({
  n,
  digits = 2,
  className,
}: {
  n: number | null | undefined;
  digits?: number;
  className?: string;
}) {
  const d = describeUsd(n, digits);
  if (!d) return <span className={className}>—</span>;
  if (!d.tiny) return <span className={className}>{d.text}</span>;
  return (
    <span className={clsx("tabular-nums", className)}>
      {d.sign}$0.0
      <sub className="bottom-0 text-[0.72em] leading-none">{d.tiny.zeros}</sub>
      {d.tiny.digits}
    </span>
  );
}

/** Token / bridge amount: 80 000, 2 674.869, or 0.0₄677. */
export function PrettyAmt({
  raw,
  decimals = 0,
  locale,
  className,
}: {
  raw: number | string | bigint | null | undefined;
  decimals?: number | null;
  locale?: string;
  className?: string;
}) {
  const d = describeScaledAmount(toBigIntAmt(raw), decimals ?? 0, locale);
  if (!d.tiny) return <span className={clsx("tabular-nums", className)}>{d.text}</span>;
  return (
    <span className={clsx("tabular-nums", className)}>
      {d.sign}0.0
      <sub className="bottom-0 text-[0.72em] leading-none">{d.tiny.zeros}</sub>
      {d.tiny.digits}
    </span>
  );
}

/** Same tiny-zero mark as USD, without $ — DEX pool mids. */
export function PrettyPrice({
  n,
  locale,
  className,
}: {
  n: number | null | undefined;
  locale?: string;
  className?: string;
}) {
  const d = describePrice(n, locale);
  if (!d) return <span className={className}>—</span>;
  if (!d.tiny) return <span className={clsx("tabular-nums", className)}>{d.text}</span>;
  return (
    <span className={clsx("tabular-nums", className)}>
      {d.sign}0.0
      <sub className="bottom-0 text-[0.72em] leading-none">{d.tiny.zeros}</sub>
      {d.tiny.digits}
    </span>
  );
}
