"use client";
import { DataTable, ProgressBar } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { BudgetOutcomeSummary } from "@civitasone/types";
import { achievementBpsOrNull } from "../_lib/outcomeStats";
type Row = BudgetOutcomeSummary;

/** "30 days" -- a bare number with no unit is ambiguous (GAP-FINANCE-BUDGET-OUTCOME-BUDGET-02). */
export function withUnit(value: unknown, unit: unknown): string {
  const v = value === null || value === undefined || value === "" ? "—" : String(value);
  const u = typeof unit === "string" ? unit.trim() : "";
  return v !== "—" && u ? `${v} ${u}` : v;
}

const FORMULA = "(achieved − baseline) ÷ (target − baseline)";
const FORMULA_LOWER = "(baseline − achieved) ÷ (baseline − target); a reading at or below the target scores 100%";

/** GAP-FINANCE-BUDGET-OUTCOME-BUDGET-02: the formula that applies to this indicator's polarity. */
export function formulaFor(polarity: unknown): string {
  return polarity === "lower_is_better" ? FORMULA_LOWER : FORMULA;
}

/** "Lower is better" marker shown beside the target so a lower reading is not misread as a shortfall. */
export function polarityNote(polarity: unknown): string | null {
  return polarity === "lower_is_better" ? "Lower is better" : null;
}

export function OutcomeBudgetTable({ outcomes, source = "api" }: { outcomes: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("finance.outcome-budget", outcomes, source, (d) => d.length === 0);
  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Row>
        columns={[
          { key: "outcomeDesc", label: "Outcome" },
          { key: "indicator", label: "Output Indicator" },
          { key: "targetValue", label: "Target", align: "right", render: (o) => (
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {withUnit(o.targetValue, o.unit)}
              {polarityNote(o.polarity) ? <small style={{ display: "block", color: "var(--ink2)" }}>{polarityNote(o.polarity)}</small> : null}
            </span>
          ), csv: (o) => String(o.targetValue ?? "") },
          { key: "achievedValue", label: "Achieved", align: "right", render: (o) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{withUnit(o.achievedValue, o.unit)}</span>, csv: (o) => String(o.achievedValue ?? "") },
          {
            key: "achievementBps",
            label: "% Done",
            align: "right",
            // achievementBps is basis points (0–10000), not a 0–100 percent — divide by 100 to
            // display. A missing measurement is "—", never a fabricated 0.0% (GAP-…-OUTCOME-BUDGET-03).
            // The bar is clamped to its track; the number beside it is the true value.
            render: (o) => {
              const bps = achievementBpsOrNull(o.achievementBps);
              if (bps === null) return <span title="No measurement recorded yet">—</span>;
              const pct = bps / 100;
              return (
                <span title={`Achievement = ${formulaFor(o.polarity)}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 120, justifyContent: "flex-end" }}>
                  <span style={{ width: 64 }}><ProgressBar value={pct} /></span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{pct.toFixed(1)}%</span>
                </span>
              );
            },
            csv: (o) => { const bps = achievementBpsOrNull(o.achievementBps); return bps === null ? "" : (bps / 100).toFixed(2); },
          },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search outcomes…"
        pageSize={15}
        exportable
        exportFilename="outcome-budget"
        emptyIcon="🎯"
        emptyTitle="No outcomes"
        emptyMessage="No outcome budget indicators found."
      />
    </>
  );
}
