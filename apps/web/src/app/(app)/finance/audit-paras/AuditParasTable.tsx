"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceAuditParaSummary } from "@civitasone/types";
type Row = FinanceAuditParaSummary;
export function AuditParasTable({ paras, source = "api" }: { paras: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("finance.audit-paras", paras, source, (d) => d.length === 0);
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
          { key: "paraNo", label: "Para No" },
          { key: "source", label: "Source" },
          { key: "dept", label: "Department" },
          { key: "moneyValueMinor", label: "Amount", align: "right", cellType: "amount" },
          { key: "createdAt", label: "Raised" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        rowLinkKey="id"
        rowLinkPrefix="/finance/audit-paras/"
        sortable
        filterable
        filterPlaceholder="Search audit paras…"
        pageSize={15}
        exportable
        exportFilename="audit-paras"
        emptyIcon="📋"
        emptyTitle="No audit paras"
        emptyMessage="No CAG audit observations found."
      />
    </>
  );
}
