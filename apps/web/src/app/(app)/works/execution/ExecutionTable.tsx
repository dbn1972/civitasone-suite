"use client";

import { useState } from "react";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

const progressColumns = [
  { key: "work", label: "Work", sortable: true },
  { key: "scope", label: "Scope", sortable: true },
  { key: "target", label: "Target", align: "right" as const, sortable: true },
  { key: "achievement", label: "Achievement", align: "right" as const, sortable: true },
  { key: "percentage", label: "%", align: "right" as const, sortable: true },
];

const issueColumns = [
  { key: "work", label: "Work", sortable: true },
  { key: "description", label: "Description", sortable: true },
  { key: "raisedDate", label: "Raised", sortable: true },
  { key: "status", label: "Status", cellType: "status" as const, sortable: true },
];

type Tab = "progress" | "issues";

export function ExecutionTable({
  progress,
  issues,
  source,
}: {
  progress: Record<string, unknown>[];
  issues: Record<string, unknown>[];
  source: "api" | "error";
}) {
  const [tab, setTab] = useState<Tab>("progress");
  const { data: progressData } = useSeededResource("works-execution-progress", progress, source, (rows) => rows.length === 0);
  const { data: issuesData } = useSeededResource("works-execution-issues", issues, source, (rows) => rows.length === 0);

  return (
    <div>
      <div className="flex gap-2 mb-4" role="tablist" aria-label="Execution view">
        <button
          role="tab"
          aria-selected={tab === "progress"}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === "progress" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          onClick={() => setTab("progress")}
        >
          Progress
        </button>
        <button
          role="tab"
          aria-selected={tab === "issues"}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === "issues" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          onClick={() => setTab("issues")}
        >
          Issues
        </button>
      </div>
      {tab === "progress" ? (
        <DataTable
          columns={progressColumns}
          rows={progressData}
          sortable
          filterable
          filterPlaceholder="Search works..."
          pageSize={15}
          exportable
          exportFilename="works-execution-progress"
          emptyIcon="🏗️"
          emptyTitle="No execution data"
          emptyMessage="Execution progress records will appear here."
        />
      ) : (
        <DataTable
          columns={issueColumns}
          rows={issuesData}
          sortable
          filterable
          filterPlaceholder="Search issues..."
          pageSize={15}
          exportable
          exportFilename="works-execution-issues"
          emptyIcon="🚧"
          emptyTitle="No issues found"
          emptyMessage="Execution issues will appear here once raised."
        />
      )}
    </div>
  );
}
