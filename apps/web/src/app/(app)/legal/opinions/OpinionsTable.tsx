"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DataTable, Segmented, StatusPill } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";

type Opinion = {
  id: string;
  opinionNo: string;
  subject: string;
  requestedBy: string;
  advisorName?: string | null;
  status: string;
} & Record<string, unknown>;

const FILTERS = ["All", "Pending"] as const;

function opinionStatusPill(status: string): ReactNode {
  switch (status) {
    case "issued":
      return <span className="pill good">Issued</span>;
    case "draft":
      return <span className="pill warn">Draft</span>;
    case "pending":
      return <span className="pill info">Pending</span>;
    default:
      return <StatusPill status={status} />;
  }
}

export function OpinionsTable({ items, source = "api" }: { items: Opinion[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Opinion[]>(
    "legal.opinions",
    items,
    source,
    (d) => d.length === 0,
  );

  const [filter, setFilter] = useState<string>("All");

  const visible = useMemo(() => {
    if (filter === "Pending") return rows.filter((r) => r.status === "pending");
    return rows;
  }, [rows, filter]);

  return (
    <div className="card">
      <div className="card-h">
        <h3>Opinion repository</h3>
        <Segmented options={[...FILTERS]} value={filter} onChange={setFilter} />
      </div>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Opinion>
        columns={[
          { key: "opinionNo", label: "Opinion", render: (r) => <span className="mono">{r.opinionNo}</span> },
          { key: "subject", label: "Subject" },
          { key: "requestedBy", label: "Sought by" },
          { key: "advisorName", label: "Author", render: (r) => <>{r.advisorName ?? "Law Dept"}</> },
          { key: "status", label: "Status", render: (r) => opinionStatusPill(r.status) },
        ]}
        rows={visible}
        sortable
        filterable
        filterPlaceholder="Filter opinions…"
        pageSize={15}
      />
    </div>
  );
}
