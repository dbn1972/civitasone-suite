"use client";

/**
 * GAP-RECOMMENDATIONS-MATRIX-02 / MATRIX-03: a cross-sell rule has a source
 * product, a target product and a weight — rendering it as a flat
 * ID/Name/Detail list squeezed those into one or two columns by key-name luck.
 * This table gives each its own column and sorts weight numerically.
 *
 * Weight is stored in basis points (10000 = 100%); it is shown as a percentage
 * for the clerk while the raw bps value drives the numeric sort via a hidden
 * key.
 */
import { DataTable } from "@/app/_components/ds/DataTable";
import { formatBps } from "@/lib/formatters";
import type { MatrixRuleRow } from "../_data";

export function MatrixTable({ rows }: { rows: MatrixRuleRow[] }) {
  return (
    <DataTable<MatrixRuleRow & Record<string, unknown>>
      caption="Cross-sell affinity rules"
      rows={rows as (MatrixRuleRow & Record<string, unknown>)[]}
      columns={[
        { key: "source", label: "Source product" },
        { key: "target", label: "Target product" },
        { key: "segment", label: "Segment" },
        { key: "channel", label: "Channel" },
        { key: "priority", label: "Priority", align: "right" },
        { key: "weightBps", label: "Weight", align: "right", render: (r) => formatBps(r.weightBps) },
      ]}
      sortable
      emptyIcon="🔗"
      emptyTitle="No cross-sell rules"
      emptyMessage="No product affinity rules are configured for this tenant yet."
    />
  );
}
