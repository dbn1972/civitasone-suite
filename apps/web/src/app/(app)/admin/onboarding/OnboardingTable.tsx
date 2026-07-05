"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
type Row = Record<string, unknown>;
export function OnboardingTable({ queue, source = "api" }: { queue: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>("sa.onboarding", queue, source, (d) => d.length === 0);
  const cacheNote = offline || fromCache ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.` : null;
  return (
    <>
      {cacheNote && <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>{cacheNote}</p>}
      <DataTable<Row>
        columns={[
          { key: "org", label: "Organisation" },
          { key: "contact", label: "Contact" },
          { key: "requested", label: "Requested" },
          { key: "assigned", label: "Assigned To" },
          { key: "stage", label: "Stage", cellType: "status" },
        ]}
        rows={rows} sortable filterable filterPlaceholder="Search onboarding…" pageSize={15} exportable exportFilename="onboarding-queue" emptyIcon="📥" emptyTitle="No requests" emptyMessage="No tenant onboarding requests in queue."
      />
    </>
  );
}
