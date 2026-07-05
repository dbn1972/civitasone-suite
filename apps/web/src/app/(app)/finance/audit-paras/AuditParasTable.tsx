"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function AuditParasTable({ paras, source = "api" }: { paras: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.audit-paras", paras, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "paraNo", label: "Para No" },
          { key: "subject", label: "Subject" },
          { key: "auditYear", label: "Audit Year" },
          { key: "amount", label: "Amount", align: "right" },
          { key: "department", label: "Department" },
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
