"use client";
import { DataTable } from "@/app/_components/ds";
import { StatusPill, type PillVariant } from "@/app/_components/ds/StatusPill";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { BUDGET_COLUMN_LABELS, MATERIAL_VARIANCE_BPS } from "../_lib/budgetColumns";

export type RevisionStatus = "increased" | "decreased" | "no_change" | "unknown";

export type RevisedEstimateRow = {
  id: string;
  headCode: string;
  description: string;
  financialYear: string;
  // Paise decimal STRINGS (BudgetSummary's contract), kept exact -- never a float
  // rupee number (GAP-FINANCE-BUDGET-REVISED-ESTIMATES-02). null = BE/RE was
  // missing/unparseable on the source row: rendered "—", never a fabricated 0.
  budgetEstimateMinor: string | null;
  revisedEstimateMinor: string | null;
  /** (RE - BE) / BE in basis points, computed from exact BigInt BE/RE by the page; null when undefined. */
  varianceBps: number | null;
  status: RevisionStatus;
  /** |variance| >= MATERIAL_VARIANCE_BPS (REVISED-ESTIMATES-04). */
  material: boolean;
};

/**
 * GAP-FINANCE-BUDGET-REVISED-ESTIMATES-03: direction tone + a text/arrow cue so
 * colour is never the only signal. An increase is neither good nor bad on its
 * own (it can be a justified top-up or an overspend), so it is "warn" -- worth
 * a look -- rather than green; a decrease is neutral "info"; no change / unknown
 * are muted. Tone is a policy value: change it here.
 */
export const REVISION_PILL: Record<RevisionStatus, { label: string; variant: PillVariant }> = {
  increased: { label: "▲ Increased", variant: "warn" },
  decreased: { label: "▼ Decreased", variant: "info" },
  no_change: { label: "= No change", variant: "mut" },
  unknown: { label: "Unknown", variant: "mut" },
};

/** "12.0%" from basis points; "—" when undefined. Exact integer maths on the bps. */
export function formatVarianceBps(bps: number | null): string {
  if (bps === null || !Number.isFinite(bps)) return "—";
  return `${(bps / 100).toFixed(1)}%`;
}

// DataTable's generic requires an index signature; RevisedEstimateRow is a
// plain named type. Intersection satisfies the constraint without widening
// away real field names/types.
type Row = RevisedEstimateRow & Record<string, unknown>;

export function RevisedEstimatesTable({ estimates, source = "api", fy }: { estimates: RevisedEstimateRow[]; source?: "api" | "error"; fy?: string }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("finance.revised-estimates", estimates as Row[], source, (d) => d.length === 0);
  return (
    <>
      {/* UX-002: single source of truth — this reads the same useSeededResource
          call as `rows`, so it can never contradict the table it sits above.
          The page used to render its own badge from the raw server `source`. */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Row>
        columns={[
          { key: "headCode", label: "Head" },
          { key: "description", label: "Description" },
          { key: "financialYear", label: "FY" },
          { key: "budgetEstimateMinor", label: BUDGET_COLUMN_LABELS.be, align: "right", cellType: "amount" },
          { key: "revisedEstimateMinor", label: BUDGET_COLUMN_LABELS.re, align: "right", cellType: "amount" },
          // UX-006: varianceBps is null when BE/RE was missing — show "—", not "NaN%"/"0.0%".
          // A material revision is bold AND carries a text marker (not colour alone).
          {
            key: "varianceBps",
            label: "Variance %",
            align: "right",
            render: (r) => (
              <span style={r.material ? { fontWeight: 700 } : undefined} title={r.material ? `Material: at least ${Number(MATERIAL_VARIANCE_BPS) / 100}% revision` : undefined}>
                {formatVarianceBps(r.varianceBps as number | null)}
                {r.material ? " ◆ Material" : ""}
              </span>
            ),
            csv: (r) => (r.varianceBps === null ? "" : ((r.varianceBps as number) / 100).toFixed(2)),
          },
          {
            key: "status",
            label: "Status",
            render: (r) => {
              const p = REVISION_PILL[(r.status as RevisionStatus) in REVISION_PILL ? (r.status as RevisionStatus) : "unknown"];
              return <StatusPill status={String(r.status)} label={p.label} variant={p.variant} />;
            },
            csv: (r) => String(r.status ?? ""),
          },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search estimates…"
        pageSize={15}
        exportable
        csvPlainAmounts
        exportFilename="revised-estimates"
        emptyIcon="📊"
        emptyTitle="No estimates"
        emptyMessage={fy ? `No revised estimates for FY ${fy}.` : "No revised estimate data found."}
      />
    </>
  );
}

