"use client";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceGuaranteeSummary } from "@civitasone/types";
type Row = FinanceGuaranteeSummary;
export function GuaranteesTable({ guarantees, source = "api" }: { guarantees: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("finance.guarantees", guarantees, source, (d) => d.length === 0);
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
          { key: "entity", label: "Entity" },
          { key: "type", label: "Type" },
          { key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },
          { key: "feePct", label: "Fee %", align: "right" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search guarantees…"
        pageSize={15}
        exportable
        exportFilename="guarantees-emd"
        emptyIcon="🛡️"
        emptyTitle="No guarantees"
        emptyMessage="No bank guarantees or EMDs found."
      />
    </>
  );
}
