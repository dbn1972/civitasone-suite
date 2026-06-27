"use client";

import { DataTable } from "@/app/_components/ds";

export type DelayRow = {
  project: string;
  originalDeadline: string;
  revisedDeadline: string;
  delayDays: number;
  cause: string;
  rag: string;
} & Record<string, unknown>;

const COLUMNS: {
  key: keyof DelayRow & string;
  label: string;
  cellType?: "status" | "amount";
  align?: "left" | "right" | "center";
}[] = [
  { key: "project", label: "Project Name" },
  { key: "originalDeadline", label: "Original Deadline" },
  { key: "revisedDeadline", label: "Revised Deadline" },
  { key: "delayDays", label: "Delay (days)", align: "right" },
  { key: "cause", label: "Cause" },
  { key: "rag", label: "RAG Status", cellType: "status" },
];

export function DelayAnalysisTable({ rows }: { rows: DelayRow[] }) {
  return (
    <DataTable<DelayRow>
      columns={COLUMNS}
      rows={rows}
      sortable
      filterable
      filterPlaceholder="Filter projects…"
      pageSize={15}
    />
  );
}
