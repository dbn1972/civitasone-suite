"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { formatMoney } from "@/lib/formatters";
import { rupeesToMinorString } from "@/lib/money";
import { completedServiceYears } from "./serviceYears";
import { GRATUITY_CEILING_PAISE, GRATUITY_DAYS, WORKING_DAYS_PER_MONTH } from "./constants";

/** Upper bound on service years the estimator accepts (no real career exceeds it). */
const MAX_SERVICE_YEARS = 60;

export function GratuityCalculator() {
  const t = useTranslations("gratuityCalculator");
  const [years, setYears] = useState("");
  const [monthlySalary, setMonthlySalary] = useState(""); // in rupees (as string)

  // Guard non-finite input (e.g. "1e400" parses to Infinity, and
  // BigInt(Infinity) throws) and anything beyond a plausible career.
  const parsedYears = parseFloat(years);
  const numYears = Number.isFinite(parsedYears) && parsedYears > 0 ? Math.min(parsedYears, MAX_SERVICE_YEARS) : 0;
  // GAP-PAYROLL-STATUTORY-GRATUITY-03: a fraction over six months counts as a full year.
  const completedYears = completedServiceYears(numYears);

  // GAP-PAYROLL-STATUTORY-GRATUITY-05 [HUMAN REVIEW: statutory compliance]:
  // integer-paise BigInt math via the shared rupeesToMinorString helper,
  // replacing float-rupee arithmetic -- same formula as before (which
  // completed-years count or eligibility rule applies is GAP-
  // PAYROLL-STATUTORY-GRATUITY-03, explicitly left open and untouched here),
  // only the arithmetic precision. The previous float math, rounded for
  // display via maximumFractionDigits: 0, could differ from the paise-exact
  // register figure by up to Rs 1 (e.g. 50,000 x 10y rounded to "Rs
  // 2,88,462" instead of the exact "Rs 2,88,461.53").
  const salaryMinor = BigInt(rupeesToMinorString(monthlySalary.replace(/,/g, "").trim()) ?? "0");
  // Single division at the end (matches the original float formula's order
  // of operations exactly: salary * days * years, divided once) -- dividing
  // per-year first and then multiplying by completedYears would compound a
  // separate truncation at each step and silently drift from the
  // mathematically-correct total by a few paise. perYearMinor below is a
  // display-only figure for the formula trace, deliberately NOT used to
  // derive gratuityRawMinor.
  const gratuityRawMinor = (salaryMinor * BigInt(GRATUITY_DAYS) * BigInt(completedYears)) / BigInt(WORKING_DAYS_PER_MONTH);
  const perYearMinor = (salaryMinor * BigInt(GRATUITY_DAYS)) / BigInt(WORKING_DAYS_PER_MONTH);
  const ceilingMinor = BigInt(GRATUITY_CEILING_PAISE);
  const gratuityMinor = gratuityRawMinor > ceilingMinor ? ceilingMinor : gratuityRawMinor;
  const isCapped = gratuityRawMinor > ceilingMinor;
  const numSalary = Number(salaryMinor) / 100;
  const hasResult = numYears >= 5 && numSalary > 0;
  const belowEligibility = numYears > 0 && numYears < 5;

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: "20px 24px",
        maxWidth: 520,
      }}
    >
      <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
        {t("heading")}
      </h3>
      <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--mut)" }}>
        {t("description", { ceiling: formatMoney(GRATUITY_CEILING_PAISE) })} {t("roundingNote")}
      </p>
      {/* GAP-PAYROLL-STATUTORY-GRATUITY-05: this calculator is a scratch
          estimator with no link to an actual employee record -- its figure
          can disagree with the register below, and nothing previously said
          which one is authoritative. */}
      <p style={{ margin: "0 0 18px", fontSize: 12, color: "var(--warn, #92400e)", fontWeight: 600 }}>
        {t("disclaimerEstimateOnly")}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mut)" }}>
            {t("salaryLabel")}
          </span>
          <input
            type="number"
            min="0"
            step="100"
            placeholder={t("salaryPlaceholder")}
            value={monthlySalary}
            onChange={(e) => setMonthlySalary(e.target.value)}
            style={{
              height: 38,
              padding: "0 12px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg)",
              color: "var(--ink)",
              fontSize: 14,
            }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mut)" }}>
            {t("yearsLabel")}
          </span>
          <input
            type="number"
            min="0"
            max="50"
            step="0.5"
            placeholder={t("yearsPlaceholder")}
            value={years}
            onChange={(e) => setYears(e.target.value)}
            style={{
              height: 38,
              padding: "0 12px",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--bg)",
              color: "var(--ink)",
              fontSize: 14,
            }}
          />
        </label>
      </div>

      {/* Formula trace */}
      {numSalary > 0 && numYears > 0 && (
        <div
          style={{
            marginTop: 16,
            background: "var(--line2)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 12,
            color: "var(--mut)",
            fontFamily: "monospace",
            lineHeight: 1.7,
          }}
        >
          = ({formatMoney(salaryMinor)} × {GRATUITY_DAYS}) / {WORKING_DAYS_PER_MONTH} × {t("yearsCount", { count: completedYears })}
          <br />
          = {formatMoney(perYearMinor)} × {completedYears}
          <br />= {formatMoney(gratuityRawMinor)}
          {isCapped && ` ${t("cappedAtInline", { amount: formatMoney(ceilingMinor) })}`}
        </div>
      )}

      {/* Result */}
      {belowEligibility && (
        <div
          style={{
            marginTop: 14,
            background: "var(--warnbg, #fffbeb)",
            border: "1px solid var(--warnbd, #fde68a)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--warn, #92400e)",
          }}
        >
          {t.rich("belowEligibilityMessage", {
            strong: (chunks) => <strong>{chunks}</strong>,
            years: numYears,
          })}
        </div>
      )}

      {hasResult && (
        <div
          style={{
            marginTop: 14,
            background: "var(--goodbg, #f0fdf4)",
            border: "1px solid var(--goodbd, #bbf7d0)",
            borderRadius: 8,
            padding: "14px 18px",
          }}
        >
          <p style={{ margin: 0, fontSize: 12, color: "var(--good, #14532d)" }}>{t("resultLabel")}</p>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 28,
              fontWeight: 800,
              color: "var(--good, #16a34a)",
              lineHeight: 1,
            }}
          >
            {formatMoney(gratuityMinor)}
          </p>
          {isCapped && (
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--warn, #92400e)" }}>
              {t("cappedNote", { amount: formatMoney(ceilingMinor) })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
