"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceSchemeSummary } from "@civitasone/types";
type Row = FinanceSchemeSummary;
export function SchemeTable({ schemes, source = "api" }: { schemes: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.schemes", schemes, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "code", label: "Code" },
          { key: "name", label: "Scheme" },
          { key: "funding", label: "Funding" },
          { key: "outlayMinor", label: "Outlay", align: "right", cellType: "amount" },
          { key: "utilisedMinor", label: "Utilised", align: "right", cellType: "amount" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        rowLinkKey="id"
        rowLinkPrefix="/finance/expenditure/scheme-tracking/"
        sortable
        filterable
        filterPlaceholder="Search schemes…"
        pageSize={15}
        exportable
        exportFilename="scheme-tracking"
        emptyIcon="🎯"
        emptyTitle="No schemes"
        emptyMessage="No scheme expenditure records found."
      />
    </>
  );
}
