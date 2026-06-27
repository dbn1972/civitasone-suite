"use client";

import { DataTable } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";

export type ExportRow = {
  id: string;
  jobType: string;
  requestedAt: string;
  format: string;
  status: string;
  downloadUrl?: string;
} & Record<string, unknown>;

export function ExportsTable({ rows }: { rows: ExportRow[] }) {
  return (
    <DataTable<ExportRow>
      columns={[
        { key: "jobType", label: "Export", render: (item) => <span className="mono">{item.jobType as string}</span> },
        { key: "requestedAt", label: "Requested", render: (item) => formatIndianDate(item.requestedAt as string) },
        {
          key: "format",
          label: "Format",
          render: (item) => <span className="pill info">{(item.format as string).toUpperCase()}</span>,
        },
        {
          key: "status",
          label: "Status",
          render: (item) => {
            const s = item.status as string;
            if (s === "completed") return <span className="pill good">Ready</span>;
            if (s === "processing") return <span className="pill warn">Generating</span>;
            if (s === "failed") return <span className="pill bad">Failed</span>;
            return <span className="pill mut">Queued</span>;
          },
        },
        {
          key: "downloadUrl",
          label: "Download",
          sortable: false,
          render: (item) =>
            item.status === "completed" && item.downloadUrl
              ? <a href={item.downloadUrl as string} className="lnk" download>Download</a>
              : <span style={{ color: "#98a2b3" }}>—</span>,
        },
      ]}
      rows={rows}
    />
  );
}
