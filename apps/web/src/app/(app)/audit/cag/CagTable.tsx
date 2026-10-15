"use client";

import { DataTable, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { useAuditT } from "@/lib/audit/useAuditT";
import { humanizeStatus } from "@/lib/formatters";
import type { CagParaSummary } from "@/app/_data/loaders";

const STATUS_LABELS: Record<Exclude<CagParaSummary["status"], "unknown">, string> = {
  under_review: "Under Review",
  partially_settled: "Partially Settled",
  nearly_settled: "Nearly Settled",
  settled: "Settled",
};

// GAP-AUDIT-CAG-03: an unmodelled backend status shows its humanized raw text
// ("xyz" -> "Xyz"), never a guessed "Under Review".
function statusLabel(row: CagParaSummary, unknownLabel: string): string {
  if (row.status === "unknown") return row.rawStatus ? humanizeStatus(row.rawStatus) : unknownLabel;
  return STATUS_LABELS[row.status] ?? humanizeStatus(String(row.status));
}

export function CagTable({ rows, source }: { rows: CagParaSummary[]; source: "api" | "error" }) {
  const t = useAuditT();
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
                variant={row.status === "unknown" ? "mut" : undefined}
                label={statusLabel(row as unknown as CagParaSummary, t("cagStatusUnknown"))}
              />
            ),
          },
        ]}
        rows={data as (CagParaSummary & Record<string, unknown>)[]}
        sortable
        filterable
        filterPlaceholder="Search CAG paras..."
        pageSize={15}
        exportable exportAudit="audit/cag"
        exportFilename="cag-paras"
      />
    </>
  );
}
