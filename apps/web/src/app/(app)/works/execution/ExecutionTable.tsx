"use client";

import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

const columns = [
  { key: "work", label: "Work", sortable: true },
  { key: "scope", label: "Scope", sortable: true },
  { key: "target", label: "Target", align: "right" as const, sortable: true },
  { key: "achievement", label: "Achievement", align: "right" as const, sortable: true },
  { key: "percentage", label: "%", align: "right" as const, sortable: true },
  { key: "photos", label: "Photos", align: "right" as const, sortable: true },
  { key: "issues", label: "Issues", align: "right" as const, sortable: true },
];

export function ExecutionTable({ progress, source }: { progress: Record<string, unknown>[]; source: string }) {
  const { data } = useSeededResource("works-execution", progress, source, progress.length === 0);

  return (
    <DataTable
      columns={columns}
      rows={data}
      sortable
      filterable
      filterPlaceholder="Search works..."
      pageSize={15}
      exportable
      exportFilename="works-execution"
      emptyIcon="🏗️"
      emptyTitle="No execution data"
      emptyMessage="Execution progress records will appear here."
    />
  );
}
