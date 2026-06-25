"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DataTable, Segmented, StatusPill } from "../../../_components/ds";
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
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Opinion[]>(
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

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <div className="card">
      <div className="card-h">
        <h3>Opinion repository</h3>
        <Segmented options={[...FILTERS]} value={filter} onChange={setFilter} />
      </div>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
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
