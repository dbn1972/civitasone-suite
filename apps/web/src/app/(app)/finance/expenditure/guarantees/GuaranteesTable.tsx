"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceGuaranteeSummary } from "@civitasone/types";
type Row = FinanceGuaranteeSummary;
export function GuaranteesTable({ guarantees, source = "api" }: { guarantees: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("finance.guarantees", guarantees, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
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
