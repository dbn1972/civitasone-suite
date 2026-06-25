"use client";

import { useMemo, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DataTable, Segmented } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import type { AuditObservationSummary } from "@civitasone/types";

type Filter = "All" | "Open" | "Settled";
const FILTERS: Filter[] = ["All", "Open", "Settled"];

function riskPill(severity: string): ReactNode {
  if (severity === "critical" || severity === "major") return <span className="pill bad">{severity}</span>;
  if (severity === "minor") return <span className="pill warn">Medium</span>;
  return <span className="pill mut">Low</span>;
}

function statusPill(status: string): ReactNode {
  if (status === "open") return <span className="pill warn">Open</span>;
  if (status === "closed") return <span className="pill good">Settled</span>;
  if (status === "replied") return <span className="pill info">Under reply</span>;
  if (status === "partially_closed") return <span className="pill info">Part-settled</span>;
  if (status === "compliance_pending") return <span className="pill warn">Compliance pending</span>;
  return <span className="pill mut">{status}</span>;
}

export function ObservationsTable({ items }: { items: AuditObservationSummary[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("status");
  const active: Filter = raw === "open" ? "Open" : raw === "settled" ? "Settled" : "All";

  const rows = useMemo(() => {
    if (active === "Open") return items.filter((i) => i.status !== "closed");
    if (active === "Settled") return items.filter((i) => i.status === "closed");
    return items;
  }, [items, active]);

  const onSegment = (v: string) => {
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (v === "Open") sp.set("status", "open");
    else if (v === "Settled") sp.set("status", "settled");
    else sp.delete("status");
    const qs = sp.toString();
    router.replace(qs ? `/audit/observations?${qs}` : "/audit/observations");
  };

  return (
    <div className="card">
      <div className="card-h">
        <h3>Audit observations</h3>
        <Segmented options={FILTERS} value={active} onChange={onSegment} />
      </div>
      <div className="pad">
        <DataTable<AuditObservationSummary>
          columns={[
            { key: "observationNo", label: "Obs", render: (r) => <span className="mono">{r.observationNo}</span> },
            { key: "department", label: "Auditee", render: (r) => r.department ?? "—" },
            { key: "title", label: "Finding" },
            { key: "severity", label: "Risk", render: (r) => riskPill(r.severity) },
            { key: "raisedDate", label: "Raised", render: (r) => formatIndianDate(r.raisedDate) },
            { key: "amount", label: "Money value", align: "right", render: (r) => (r.amount ? formatMoney(r.amount) : "—") },
            { key: "status", label: "Status", render: (r) => statusPill(r.status) },
          ]}
          rows={rows}
          rowHref={(r) => `/audit/observations/${r.id}`}
          sortable
          filterable
          filterPlaceholder="Filter by finding, auditee, status…"
          pageSize={12}
        />
      </div>
    </div>
  );
}
