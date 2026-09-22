"use client";

import { Chart } from "../../../_components/Chart";
import { formatRupees } from "@/lib/formatters";

interface BudgetChartProps {
  utilisationPct: number | null;
  expenditure: number;
}

export function BudgetChart({ utilisationPct, expenditure }: BudgetChartProps) {
  // `expenditure` arrives from finance-service's dashboard summary in MINOR
  // UNITS (paise) — see dashboard/queries.ts, which intentionally sends the
  // raw ledger sum so the page's `formatMoney()` call on the stat tile can do
  // the one-and-only paise->rupee conversion. Convert to rupees ONCE, here,
  // before deriving any further numbers: the generic <Chart> component (see
  // _components/Chart.tsx) prints its `value`s as raw, unformatted digits
  // with no currency awareness (bar labels, the donut's centre total). Every
  // number below must therefore already be final-scale rupees, or the chart
  // shows a paise-scaled figure 100x larger than the correctly-formatted ₹
  // legend right next to it for the exact same quantity — the bug that made
  // "Expenditure (YTD)" (₹5,000.00) look like it disagreed with this chart's
  // own totals (which, unconverted, summed to 500000).
  const utilized = expenditure / 100;
  // Guard the division: `utilisationPct` is null when there is no sanctioned
  // budget on record for this tenant/FY (see dashboard/queries.ts) — treated
  // as "unknown", not 0%, per UX-006. And when it IS 0 (nothing spent yet, a
  // normal state at the start of a financial year) the old expression
  // evaluated `utilized * (100 / 0)` = Infinity. `|| 0` does NOT catch that,
  // because Infinity is truthy — so the dashboard rendered "Remaining:
  // Infinity" to finance officers. Surfaced by the WCAG gate reading the
  // rendered DOM.
  const remaining =
    utilisationPct !== null && utilisationPct > 0 && utilisationPct <= 100 && Number.isFinite(utilized)
      ? Math.round(utilized * ((100 - utilisationPct) / utilisationPct))
      : 0;

  const donutData = [
    { label: `Utilized (${formatRupees(utilized)})`, value: utilized, color: "#4f46e5" },
    { label: `Remaining (${formatRupees(remaining)})`, value: remaining, color: "#e5e7eb" },
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
