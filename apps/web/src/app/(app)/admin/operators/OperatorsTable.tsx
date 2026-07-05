"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function OperatorsTable({ operators, source = "api" }: { operators: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("sa.operators", operators, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "name", label: "Name" },
          { key: "role", label: "Role" },
          { key: "lastLogin", label: "Last Login" },
          { key: "twoFaStatus", label: "2FA", cellType: "status" },
          { key: "permissions", label: "Permissions" },
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search operators…" pageSize={15} exportable exportFilename="operators" emptyIcon="👤" emptyTitle="No operators" emptyMessage="No platform operators configured."
      />
    </>
  );
}
