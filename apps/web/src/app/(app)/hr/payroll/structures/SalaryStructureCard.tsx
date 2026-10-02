"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chart } from "@/app/_components/Chart";

interface ComponentItem {
  id: string;
  code: string;
  name: string;
  componentType: string;
  isTaxable: boolean;
}

export interface SalaryStructureCardProps {
  id: string;
  name: string;
  isDefault: boolean;
  status: string;
  components: ComponentItem[];
  // GAP-PAYROLL-STRUCTURES-05: components={[]} is ambiguous -- it means
  // "genuinely no components configured yet" on a healthy fetch, but the
  // same empty array is what every structure card got silently handed when
  // GET /v1/payroll/components itself failed. An outage looking identical
  // to "not yet configured" could prompt an admin to recreate components
  // that are not actually missing. Defaults to false so existing callers
  // (tests, storybook-style usage) are unaffected.
  componentsUnavailable?: boolean;
}

function buildChartData(components: ComponentItem[], t: (key: string, values?: Record<string, string | number | Date>) => string) {
  const earnings = components.filter(
    (c) => c.componentType === "earning" || c.componentType === "allowance" || !c.componentType
  );
  const deductions = components.filter((c) => c.componentType === "deduction");
  const employer = components.filter((c) => c.componentType === "employer_contribution");
  const other = components.filter(
    (c) => !["earning", "allowance", "deduction", "employer_contribution"].includes(c.componentType ?? "")
  );

  return [
    { label: t("chartEarningsLabel", { count: earnings.length }), value: earnings.length, color: "var(--indigo, #4f46e5)" },
    { label: t("chartDeductionsLabel", { count: deductions.length }), value: deductions.length, color: "var(--bad, #ef4444)" },
    { label: t("chartEmployerLabel", { count: employer.length }), value: employer.length, color: "var(--good, #10b981)" },
    { label: t("chartOtherLabel", { count: other.length }), value: other.length, color: "var(--warn, #f59e0b)" },
  ].filter((d) => d.value > 0);
}

export function SalaryStructureCard({ name, isDefault, status, components, componentsUnavailable = false }: SalaryStructureCardProps) {
  const t = useTranslations("salaryStructureCard");
  const hasComponents = components.length > 0;
  // COMP-004 fix-up (round 3): this card used to substitute a hardcoded
  // GOI_STANDARD_PCT reference breakdown into the donut chart whenever a
  // structure's real component list was empty, labelled "GoI standard
  // distribution shown" as if it described this structure. A structure
  // with zero components is a real, valid state (not yet configured), so
  // render that honestly instead of a fabricated percentage chart.
  const chartData = buildChartData(components, t);
  const isActive = status === "active";

  return (
    <div
      style={{
        background: "var(--panel)",
        border: `1.5px solid ${isDefault ? "var(--accent, #4f46e5)" : "var(--line)"}`,
        borderRadius: 14,
        padding: "20px 24px",
        position: "relative",
      }}
    >
      {isDefault && (
        <span
          style={{
            position: "absolute",
            top: 12,
            insetInlineEnd: 12,
            background: "var(--accent, #4f46e5)",
            color: "#fff",
            fontSize: 11,
            fontWeight: 600,
            padding: "2px 10px",
            borderRadius: 20,
          }}
        >
          {t("defaultBadge")}
        </span>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: isActive ? "var(--good, #10b981)" : "var(--mut, #94a3b8)",
            flexShrink: 0,
          }}
        />
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>{name}</h3>
      </div>
      <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--mut)" }}>
        {componentsUnavailable
          ? t("componentsUnavailable")
          : hasComponents
            ? t("componentCount", { count: components.length })
            : t("noComponentsConfiguredYet")}{" "}
        &bull; <span style={{ textTransform: "capitalize" }}>{status}</span>
      </p>

      <div style={{ flex: "0 0 auto" }}>
        <p
          style={{
            margin: "0 0 6px",
            fontSize: 11,
            fontWeight: 600,
            color: "var(--mut)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {/* GAP-PAYROLL-STRUCTURES-04: this heading used to say "% of Gross"
              over a donut whose values are component COUNTS by type, not a
              share of gross pay (components carry no amounts here) -- the
              chart was mislabeled, not wrong; the label now says what it
              actually shows. */}
          {t("componentsByTypeLabel")}
        </p>
        {hasComponents ? (
          <Chart type="donut" data={chartData} height={130} />
        ) : (
          <div
            style={{
              width: 130,
              height: 130,
              borderRadius: "50%",
              border: "2px dashed var(--line)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: 12,
              fontSize: 11,
              color: "var(--mut)",
            }}
          >
            {componentsUnavailable ? t("componentsUnavailable") : t("noComponentsConfigured")}
          </div>
        )}
      </div>
    </div>
  );
}
