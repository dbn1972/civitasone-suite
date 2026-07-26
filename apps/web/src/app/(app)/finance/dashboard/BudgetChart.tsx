"use client";

import { Chart } from "../../../_components/Chart";
import { formatMoney } from "@/lib/formatters";

interface BudgetChartProps {
  utilisationPct: number;
  expenditure: number;
}

export function BudgetChart({ utilisationPct, expenditure }: BudgetChartProps) {
  const utilized = expenditure;
  // Guard the division: when utilisationPct is 0 (nothing spent yet, a normal
  // state at the start of a financial year) the old expression evaluated
  // `utilized * (100 / 0)` = Infinity. `|| 0` does NOT catch that, because
  // Infinity is truthy — so the dashboard rendered "Remaining: Infinity" to
  // finance officers. Surfaced by the WCAG gate reading the rendered DOM.
  const remaining =
    utilisationPct > 0 && utilisationPct <= 100 && Number.isFinite(utilized)
      ? Math.round(utilized * ((100 - utilisationPct) / utilisationPct))
      : 0;

  const donutData = [
    { label: `Utilized (${formatMoney(utilized)})`, value: utilized, color: "#4f46e5" },
    { label: `Remaining (${formatMoney(remaining)})`, value: remaining, color: "#e5e7eb" },
  ];

  const barData = [
    { label: "Salaries", value: Math.round(utilized * 0.35), color: "#4f46e5" },
    { label: "Infra", value: Math.round(utilized * 0.25), color: "#06b6d4" },
    { label: "Programs", value: Math.round(utilized * 0.2), color: "#10b981" },
    { label: "Grants", value: Math.round(utilized * 0.12), color: "#f59e0b" },
    { label: "Other", value: Math.round(utilized * 0.08), color: "#8b5cf6" },
  ];

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
      <div style={{ flex: "1 1 200px" }}>
        <Chart type="donut" data={donutData} title="Budget Utilisation" height={160} />
      </div>
      <div style={{ flex: "2 1 300px" }}>
        <Chart type="bar" data={barData} title="Expenditure by Category" height={160} />
      </div>
    </div>
  );
}
