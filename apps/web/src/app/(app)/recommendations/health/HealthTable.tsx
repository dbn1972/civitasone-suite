"use client";

/**
 * GAP-RECOMMENDATIONS-HEALTH-01 / HEALTH-03: dedicated at-risk table with a
 * visible numeric Score and a Band pill, default-sorted worst-first (score
 * ascending — the API already returns that order; the client sort lets a clerk
 * re-sort). Replaces the generic 5-column ID/Name/Detail/Status/Meta list that
 * showed no score at all, so "who to call first" was invisible.
 */
import { DataTable } from "@/app/_components/ds/DataTable";
import type { HealthRow } from "../_data";

export function HealthTable({ rows }: { rows: HealthRow[] }) {
  return (
    <DataTable<HealthRow & Record<string, unknown>>
      caption="At-risk accounts, highest risk first"
      rows={rows as (HealthRow & Record<string, unknown>)[]}
      columns={[
        { key: "accountId", label: "Account" },
        { key: "score", label: "Score", align: "right" },
        { key: "band", label: "Band", cellType: "status" },
        { key: "computedAt", label: "Updated", cellType: "datetime" },
      ]}
      sortable
      emptyIcon="✅"
      emptyTitle="No at-risk accounts"
      emptyMessage="No accounts are currently in the critical or at-risk bands."
    />
  );
}
