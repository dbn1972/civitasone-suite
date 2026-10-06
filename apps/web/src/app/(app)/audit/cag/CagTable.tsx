"use client";

import { DataTable, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { CagParaSummary } from "@/app/_data/loaders";

const STATUS_LABELS: Record<CagParaSummary["status"], string> = {
  under_review: "Under Review",
  partially_settled: "Partially Settled",
  nearly_settled: "Nearly Settled",
  settled: "Settled",
};

export function CagTable({ rows, source }: { rows: CagParaSummary[]; source: "api" | "error" }) {
  // GAP-AUDIT-CAG-06: surface provenance so cached rows are labelled honestly.
  const { data, provenance, cachedAt, offline } = useSeededResource(
    "audit.cag.paras",
    rows,
    source,
    (d) => d.length === 0,
  );

  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<CagParaSummary & Record<string, unknown>>
        columns={[
          // GAP-AUDIT-CAG-04: raw refs are never shown — a missing report year
          // or department renders "—" instead of leaking an internal id.
          { key: "reportYear", label: "Report Year", sortable: true, render: (row) => <>{(row.reportYear as string | null) ?? "—"}</> },
          { key: "paraNo", label: "Para No." },
          { key: "department", label: "Department", sortable: true, render: (row) => <>{(row.department as string | null) ?? "—"}</> },
          // GAP-AUDIT-CAG-01: the fabricated Total Paras / Settled / Pending
          // per-row count columns (always 1 / 0|1) have been removed — the
          // paras API has no such per-row aggregate.
          {
            key: "status",
            label: "Status",
            // GAP-AUDIT-CAG-03: pass the canonical status as the tone key and the
            // humanized label separately, so a settled para is green and the
            // display text stays readable.
            render: (row) => (
              <StatusPill
                status={row.status as CagParaSummary["status"]}
                label={STATUS_LABELS[row.status as CagParaSummary["status"]] ?? String(row.status)}
              />
            ),
          },
        ]}
        rows={data as (CagParaSummary & Record<string, unknown>)[]}
        sortable
        filterable
        filterPlaceholder="Search CAG paras..."
        pageSize={15}
        exportable
        exportFilename="cag-paras"
      />
    </>
  );
}
