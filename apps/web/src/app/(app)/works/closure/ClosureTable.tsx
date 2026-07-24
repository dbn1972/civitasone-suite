"use client";

import { useState } from "react";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

const columns = [
  { key: "workNumber", label: "Work Number", sortable: true },
  { key: "description", label: "Description", sortable: true },
  { key: "agreement", label: "Agreement", sortable: true },
  { key: "statusDate", label: "Status Date", sortable: true },
  { key: "remarks", label: "Remarks", sortable: true },
];

type Tab = "closed" | "dropped" | "completion";

export function ClosureTable({ closures, source }: { closures: Record<string, unknown>[]; source: "api" | "error" }) {
  const [tab, setTab] = useState<Tab>("closed");
  const { data } = useSeededResource("works-closure", closures, source, (rows) => rows.length === 0);
  const rows = data.filter((c) => String(c.status ?? "").toLowerCase() === tab);

  return (
    <div>
      <div className="flex gap-2 mb-4" role="tablist" aria-label="Closure type">
        <button
          role="tab"
          aria-selected={tab === "closed"}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === "closed" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          onClick={() => setTab("closed")}
        >
          Closed
        </button>
        <button
          role="tab"
          aria-selected={tab === "dropped"}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === "dropped" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          onClick={() => setTab("dropped")}
        >
          Dropped
        </button>
        <button
          role="tab"
          aria-selected={tab === "completion"}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === "completion" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          onClick={() => setTab("completion")}
        >
          Completion List
        </button>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search works..."
        pageSize={15}
        exportable
        exportFilename={`works-closure-${tab}`}
        emptyIcon="🔒"
        emptyTitle="No records found"
        emptyMessage={`No ${tab} works to display.`}
      />
    </div>
  );
}
