"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function SchemeTable({ schemes, source = "api" }: { schemes: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.schemes", schemes, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "schemeName", label: "Scheme" },
          { key: "ministry", label: "Ministry/Dept" },
          { key: "sanctioned", label: "Sanctioned", align: "right" },
          { key: "released", label: "Released", align: "right" },
          { key: "utilized", label: "Utilized", align: "right" },
          { key: "ucStatus", label: "UC Status", cellType: "status" },
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
