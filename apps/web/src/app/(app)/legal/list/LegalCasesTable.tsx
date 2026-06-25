"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DataTable, Segmented, StatusPill } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

type LegalCase = {
  id: string;
  caseNo: string;
  title: string;
  court: string;
  type: string;
  advocateName?: string | null;
  status: string;
} & Record<string, unknown>;

const FILTERS = ["All", "High Court", "Adverse risk"] as const;

function caseStatusPill(status: string): ReactNode {
  switch (status) {
    case "active":
      return <span className="pill warn">Pending</span>;
    case "disposed":
      return <span className="pill mut">Disposed</span>;
    case "stayed":
      return <span className="pill info">Stayed</span>;
    case "settled":
      return <span className="pill good">Settled</span>;
    default:
      return <StatusPill status={status} />;
  }
}

export function LegalCasesTable({ items, source = "api" }: { items: LegalCase[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<LegalCase[]>(
    "legal.cases",
    items,
    source,
    (d) => d.length === 0,
  );

  const [filter, setFilter] = useState<string>("All");

  const visible = useMemo(() => {
    if (filter === "High Court") return rows.filter((r) => r.court.toLowerCase().includes("high court"));
    if (filter === "Adverse risk") return rows.filter((r) => r.type === "writ" || r.type === "criminal");
    return rows;
  }, [rows, filter]);

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <div className="card">
      <div className="card-h">
        <h3>Court cases</h3>
        <Segmented options={[...FILTERS]} value={filter} onChange={setFilter} />
      </div>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      <DataTable<LegalCase>
        columns={[
          { key: "caseNo", label: "Case no.", render: (r) => <span className="mono">{r.caseNo}</span> },
          { key: "title", label: "Title" },
          { key: "court", label: "Court" },
          { key: "type", label: "Subject" },
          { key: "advocateName", label: "Counsel", render: (r) => <>{r.advocateName ?? "—"}</> },
          { key: "status", label: "Status", render: (r) => caseStatusPill(r.status) },
        ]}
        rows={visible}
        rowLinkKey="id"
        rowLinkPrefix="/legal/cases/"
        sortable
        filterable
        filterPlaceholder="Filter cases…"
        pageSize={15}
      />
    </div>
  );
}
