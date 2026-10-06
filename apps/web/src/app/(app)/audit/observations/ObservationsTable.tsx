"use client";

import { useMemo, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DataTable, Segmented } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { severityMeta, statusMeta, isOpen, isSettled } from "@/lib/audit/observationLabels";
import type { AuditObservationSummary } from "@civitasone/types";
import { LogObservationButton } from "./LogObservationButton";

type Filter = "All" | "Open" | "Settled";
const FILTERS: Filter[] = ["All", "Open", "Settled"];

// GAP-AUDIT-OBSERVATIONS-01: one vocabulary via observationLabels — unknown
// severity/status renders raw text in a neutral pill, never silently "Low"/"Open".
function riskPill(severity: string): ReactNode {
  const { label, pill } = severityMeta(severity);
  return <span className={`pill ${pill}`}>{label}</span>;
}

function statusPill(status: string): ReactNode {
  const { label, pill } = statusMeta(status);
  return <span className={`pill ${pill}`}>{label}</span>;
}

export function ObservationsTable({ items }: { items: AuditObservationSummary[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("status");
  const active: Filter = raw === "open" ? "Open" : raw === "settled" ? "Settled" : "All";

  const rows = useMemo(() => {
    // GAP-AUDIT-OBSERVATIONS-02: segment predicates identical to the KPI tiles.
    if (active === "Open") return items.filter((i) => isOpen(i.status));
    if (active === "Settled") return items.filter((i) => isSettled(i.status));
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
            { key: "amount", label: "Money value", align: "right", render: (r) => (r.amount != null && String(r.amount) !== "0" ? formatMoney(r.amount as number) : "—") },
            { key: "status", label: "Status", render: (r) => statusPill(r.status) },
          ]}
          rows={rows}
          rowHref={(r) => `/audit/observations/${r.id}`}
          sortable
          filterable
          filterPlaceholder="Filter by finding, auditee, status…"
          pageSize={12}
          emptyIcon="📋"
          emptyTitle={active === "All" ? "No observations yet" : `No ${active.toLowerCase()} observations`}
          emptyMessage={
            active === "All"
              ? "Log your first audit observation to start tracking findings, risk and money exposure."
              : "No observations match this filter. Switch to All to see every observation."
          }
          emptyAction={active === "All" ? <LogObservationButton /> : undefined}
        />
      </div>
    </div>
  );
}
