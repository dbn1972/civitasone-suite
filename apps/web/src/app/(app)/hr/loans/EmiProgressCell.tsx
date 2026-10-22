"use client";

import { useTranslations } from "next-intl";
import { ProgressBar } from "../../../_components/ds";

/**
 * GAP-HR-LOANS-03: whole-number percentage of instalments paid, or null when
 * the loan has no instalment schedule (totalEmis <= 0) so callers render a dash
 * instead of dividing by zero. Counts of instalments, not money, so plain
 * integer arithmetic is fine here. Clamped to 0-100 (an over-paid loan still
 * draws a full bar).
 */
export function emiProgressPercent(paid: number, total: number): number | null {
  if (!Number.isFinite(paid) || !Number.isFinite(total) || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((paid * 100) / total)));
}

export function EmiProgressCell({ paid, total }: { paid: number; total: number }) {
  const t = useTranslations("loans");
  const pct = emiProgressPercent(paid, total);
  if (pct === null) return <span>—</span>;
  return (
    <div style={{ minWidth: 96 }}>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{`${paid} / ${total}`}</span>
      <ProgressBar value={pct} label={t("emiProgressAria", { paid, total })} />
    </div>
  );
}
