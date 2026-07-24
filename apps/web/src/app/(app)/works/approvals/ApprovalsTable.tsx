"use client";

import { useState } from "react";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

const columns = [
  { key: "workNumber", label: "Work Number", sortable: true },
  { key: "approvalNumber", label: "Approval Number", sortable: true },
  { key: "date", label: "Date", sortable: true },
  { key: "authority", label: "Authority", sortable: true },
  { key: "amount", label: "Amount", align: "right" as const, cellType: "amount" as const, sortable: true },
  { key: "type", label: "Type", sortable: true },
  { key: "status", label: "Status", cellType: "status" as const, sortable: true },
];

type Tab = "aa" | "ts";

export function ApprovalsTable({
  aaApprovals,
  tsApprovals,
  source,
}: {
  aaApprovals: Record<string, unknown>[];
  tsApprovals: Record<string, unknown>[];
  source: "api" | "error";
}) {
  const [tab, setTab] = useState<Tab>("aa");
  const { data: aaData } = useSeededResource("works-approvals-aa", aaApprovals, source, (rows) => rows.length === 0);
  const { data: tsData } = useSeededResource("works-approvals-ts", tsApprovals, source, (rows) => rows.length === 0);
  const rows = tab === "aa" ? aaData : tsData;

  return (
    <div>
      <div className="flex gap-2 mb-4" role="tablist" aria-label="Approval type">
        <button
          role="tab"
          aria-selected={tab === "aa"}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === "aa" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          onClick={() => setTab("aa")}
        >
          AA Register
        </button>
        <button
          role="tab"
          aria-selected={tab === "ts"}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === "ts" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          onClick={() => setTab("ts")}
        >
          TS Register
        </button>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search approvals..."
        pageSize={15}
        exportable
        exportFilename={`works-approvals-${tab}`}
        emptyIcon="✅"
        emptyTitle="No approvals found"
        emptyMessage={`${tab === "aa" ? "Administrative Approval" : "Technical Sanction"} records will appear here.`}
      />
    </div>
  );
}
