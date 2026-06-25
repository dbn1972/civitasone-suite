"use client";

import { useMemo, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DataTable, Segmented } from "@/app/_components/ds";
import type { RiskSummary } from "@civitasone/types";

const FILTERS = ["All", "High"];

function ratingPill(score: number): ReactNode {
  if (score >= 15) return <span className="pill bad">High</span>;
  if (score >= 6) return <span className="pill warn">Medium</span>;
  return <span className="pill mut">Low</span>;
}

function statusPill(status: string): ReactNode {
  if (status === "mitigated") return <span className="pill warn">Mitigating</span>;
  if (status === "closed") return <span className="pill good">Controlled</span>;
  if (status === "escalated") return <span className="pill bad">Escalated</span>;
  return <span className="pill info">Monitored</span>;
}

export function RiskTable({ items }: { items: RiskSummary[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const active = params.get("band") === "high" ? "High" : "All";

  const rows = useMemo(
    () => (active === "High" ? items.filter((i) => i.riskScore >= 15) : items),
    [items, active],
  );

  const onSegment = (v: string) => {
    const sp = new URLSearchParams(Array.from(params.entries()));
    if (v === "High") sp.set("band", "high"); else sp.delete("band");
    const qs = sp.toString();
    router.replace(qs ? `/audit/risk-register?${qs}` : "/audit/risk-register");
  };

  return (
    <div className="card">
      <div className="card-h">
        <h3>Risk register</h3>
        <Segmented options={FILTERS} value={active} onChange={onSegment} />
      </div>
      <div className="pad">
        <DataTable<RiskSummary>
          columns={[
            { key: "riskCode", label: "Risk ID", render: (r) => <span className="mono">{r.riskCode}</span> },
            { key: "title", label: "Risk" },
            { key: "owner", label: "Owner area", render: (r) => r.owner ?? "—" },
            { key: "riskScore", label: "Rating", render: (r) => ratingPill(r.riskScore) },
            { key: "status", label: "Status", render: (r) => statusPill(r.status) },
          ]}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter by risk, owner, status…"
          pageSize={12}
        />
      </div>
    </div>
  );
}
