"use client";

import { DataTable } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";

export type ReplyRow = {
  id: string;
  repliedBy: string;
  repliedAt: string;
  content: string;
  acceptedByAuditor?: boolean | null;
} & Record<string, unknown>;

export type StepRow = {
  step: string;
  by: string;
  status: string;
} & Record<string, unknown>;

export function RepliesTable({ rows }: { rows: ReplyRow[] }) {
  return (
    <DataTable<ReplyRow>
      columns={[
        { key: "repliedBy", label: "By" },
        { key: "repliedAt", label: "Date", render: (r) => formatIndianDate(r.repliedAt as string) },
        { key: "content", label: "Note" },
        {
          key: "acceptedByAuditor",
          label: "Status",
          render: (r) =>
            r.acceptedByAuditor === true ? <span className="pill good">Accepted</span>
              : r.acceptedByAuditor === false ? <span className="pill bad">Rejected</span>
              : <span className="pill mut">—</span>,
        },
      ]}
      rows={rows}
    />
  );
}

export function StepsTable({ rows }: { rows: StepRow[] }) {
  return (
    <DataTable<StepRow>
      columns={[
        { key: "step", label: "Step" },
        { key: "by", label: "By" },
        {
          key: "status",
          label: "Status",
          render: (r) => {
            const s = r.status as string;
            if (s === "Done" || s === "Received") return <span className="pill good">{s}</span>;
            if (s === "Pending") return <span className="pill warn">{s}</span>;
            return <span className="pill mut">{s}</span>;
          },
        },
      ]}
      rows={rows}
    />
  );
}
