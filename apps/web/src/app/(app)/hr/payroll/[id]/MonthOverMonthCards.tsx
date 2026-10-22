"use client";

import { useTranslations } from "next-intl";
import { formatMoney } from "@/lib/formatters";
import { parseMinorString, percentOneDecimal } from "@/lib/payroll/runMoney";

/**
 * GAP-PAYROLL-RUNS-01: every figure here is EXACT integer paise (digit strings,
 * so they cross the server -> client boundary without float or bigint
 * serialisation issues). The % deltas are computed on the integer ratio
 * (BigInt, rounded half-up to one decimal), never on rupee floats.
 */
type Props = {
  /** This run's gross in paise; null = unknown (renders "—", no delta, no ratio). */
  currentGrossMinor: string | null;
  /**
   * null means "we don't know" (the prior-period fetch failed) — distinct
   * from a real "0" (no prior period, or a prior period that genuinely had no
   * run). Only a real number renders a MoM delta; null renders "—" with no
   * delta line rather than a fabricated comparison against ₹0.
   */
  previousGrossMinor: string | null;
  /** This run's net in paise; null = unknown. */
  currentNetMinor: string | null;
  currentPeriod: string;
  previousPeriod: string;
};

export function MonthOverMonthCards({
  currentGrossMinor,
  previousGrossMinor,
  currentNetMinor,
  currentPeriod,
  previousPeriod,
}: Props) {
  const t = useTranslations("monthOverMonthCards");
  const currentGross = parseMinorString(currentGrossMinor);
  const previousGross = parseMinorString(previousGrossMinor);
  const currentNet = parseMinorString(currentNetMinor);
  const diff = currentGross !== null && previousGross !== null ? currentGross - previousGross : null;
  const pct = diff !== null && previousGross !== null && previousGross > 0n ? percentOneDecimal(diff, previousGross) : null;
  const isUp = diff !== null && diff >= 0n;
  const ratio = currentGross !== null && currentNet !== null && currentGross > 0n
    ? percentOneDecimal(currentNet, currentGross) ?? "—"
    : "—";

  const cardStyle: React.CSSProperties = {
    flex: "1 1 180px",
    minWidth: 160,
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderRadius: 10,
    padding: "14px 16px",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    color: "var(--mut)",
    marginBottom: 4,
  };

  const valueStyle: React.CSSProperties = {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--fg)",
    lineHeight: 1.2,
  };

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
      {/* Current month gross */}
      <div style={cardStyle}>
        <div style={labelStyle}>{t("periodGrossLabel", { period: currentPeriod })}</div>
        <div style={valueStyle}>{formatMoney(currentGross)}</div>
      </div>

      {/* Previous month gross + MoM delta */}
      <div style={cardStyle}>
        <div style={labelStyle}>{t("periodGrossLabel", { period: previousPeriod })}</div>
        <div style={valueStyle}>{formatMoney(previousGross)}</div>
        {pct !== null && (
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              fontWeight: 600,
              color: isUp ? "var(--success)" : "var(--danger)",
            }}
          >
            {t("vsPreviousPeriod", { arrow: isUp ? "↑" : "↓", pct, period: previousPeriod })}
          </div>
        )}
      </div>

      {/* Net-to-Gross ratio */}
      <div style={cardStyle}>
        <div style={labelStyle}>{t("netToGrossRatioLabel")}</div>
        <div style={valueStyle}>{ratio}{ratio !== "—" ? "%" : ""}</div>
        <div style={{ marginTop: 4, fontSize: 11, color: "var(--mut)" }}>
          {t("netOfGrossSummary", { net: formatMoney(currentNet), gross: formatMoney(currentGross) })}
        </div>
      </div>
    </div>
  );
}
