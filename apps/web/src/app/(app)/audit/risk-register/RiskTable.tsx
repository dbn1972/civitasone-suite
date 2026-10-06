"use client";

import { useMemo, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DataTable, Segmented } from "@/app/_components/ds";
import type { RiskSummary } from "@civitasone/types";
import { band, BAND_LABEL, statusLabel } from "@/lib/audit/riskScoring";

const FILTERS = ["All", "High", "Medium", "Low"];
const BAND_BY_FILTER: Record<string, "high" | "medium" | "low" | null> = {
  All: null,
  High: "high",
  Medium: "medium",
  Low: "low",
};

// GAP-AUDIT-RISK-REGISTER-01: show the numeric score alongside its band so the
// page can justify why a risk is High (e.g. "12 — Medium").
function ratingCell(score: number): ReactNode {
  const b = band(score);
  const cls = b === "high" ? "bad" : b === "medium" ? "warn" : "mut";
  return <span><span className={`pill ${cls}`}>{BAND_LABEL[b]}</span> <span className="mono" style={{ marginInlineStart: 6 }}>{score}</span></span>;
}

// GAP-AUDIT-RISK-REGISTER-03: map each status one-to-one; unknown statuses get
// a neutral pill with their raw text rather than being shown as "Monitored".
function statusPill(status: string): ReactNode {
  const { label, tone } = statusLabel(status);
  return <span className={`pill ${tone}`} title={status}>{label}</span>;
}

export function RiskTable({ items }: { items: RiskSummary[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const bandParam = params.get("band");
  const active = bandParam === "high" ? "High" : bandParam === "medium" ? "Medium" : bandParam === "low" ? "Low" : "All";

  const rows = useMemo(() => {
    const target = BAND_BY_FILTER[active];
    return target ? items.filter((i) => band(i.riskScore) === target) : items;
  }, [items, active]);

  const onSegment = (v: string) => {
    const sp = new URLSearchParams(Array.from(params.entries()));
    const target = BAND_BY_FILTER[v];
    if (target) sp.set("band", target); else sp.delete("band");
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
            { key: "riskScore", label: "Rating", render: (r) => ratingCell(r.riskScore) },
            { key: "status", label: "Status", render: (r) => statusPill(r.status) },
          ]}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter by risk, owner, status…"
          pageSize={12}
          emptyIcon="⚠️"
          emptyTitle="No risks recorded yet"
          emptyMessage="Add your first risk to start building the enterprise risk register."
        />
      </div>
    </div>
  );
}
