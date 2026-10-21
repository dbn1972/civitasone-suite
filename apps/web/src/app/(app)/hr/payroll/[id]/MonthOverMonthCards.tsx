"use client";

import { useTranslations } from "next-intl";
import { formatMoney } from "@/lib/formatters";
import { formatTenths, parseMinor, tenthsOfPercent } from "@/lib/payroll/minor";

/**
 * GAP-PAYROLL-HOME-01: every amount here is an integer-paise string (the API's
 * grossMinor / netMinor), compared with bigint arithmetic and rendered with
 * formatMoney. The percentages are integer-rounded to one decimal, half away
 * from zero (see lib/payroll/minor.ts tenthsOfPercent), not float math.
 */
type Props = {
  currentGrossMinor: string | null;
  /**
   * null means "we don't know" (the prior-period fetch failed) — distinct
   * from a real "0" (no prior period, or a prior period that genuinely had no
   * run). Only a real number renders a MoM delta; null renders "—" with no
   * delta line rather than a fabricated comparison against ₹0.
   */
  previousGrossMinor: string | null;
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
  const currentGross = parseMinor(currentGrossMinor);
  const previousGross = parseMinor(previousGrossMinor);
  const currentNet = parseMinor(currentNetMinor);
  const diff  = previousGross !== null && currentGross !== null ? currentGross - previousGross : null;
  const pctTenths = diff !== null && previousGross !== null && previousGross > 0n ? tenthsOfPercent(diff, previousGross) : null;
  const isUp  = diff !== null && diff >= 0n;
  const ratio = currentGross !== null && currentNet !== null && currentGross > 0n
    ? formatTenths(tenthsOfPercent(currentNet, currentGross))
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
        <div style={valueStyle}>{formatMoney(currentGrossMinor)}</div>
      </div>

      {/* Previous month gross + MoM delta */}
      <div style={cardStyle}>
        <div style={labelStyle}>{t("periodGrossLabel", { period: previousPeriod })}</div>
        <div style={valueStyle}>{formatMoney(previousGrossMinor)}</div>
        {pctTenths !== null && (
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              fontWeight: 600,
              color: isUp ? "var(--success)" : "var(--danger)",
            }}
          >
            {t("vsPreviousPeriod", { arrow: isUp ? "↑" : "↓", pct: formatTenths(pctTenths), period: previousPeriod })}
          </div>
        )}
      </div>

      {/* Net-to-Gross ratio */}
      <div style={cardStyle}>
        <div style={labelStyle}>{t("netToGrossRatioLabel")}</div>
        <div style={valueStyle}>{ratio}{ratio !== "—" ? "%" : ""}</div>
        <div style={{ marginTop: 4, fontSize: 11, color: "var(--mut)" }}>
          {t("netOfGrossSummary", { net: formatMoney(currentNetMinor), gross: formatMoney(currentGrossMinor) })}
        </div>
      </div>
    </div>
  );
}
