"use client";

import { useState } from "react";
import { DataTable, Segmented, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";

type Deal = {
  id: string;
  dealName: string;
  contactName?: string | null;
  amount: number;
  stage: string;
  status: string;
  owner: string;
} & Record<string, unknown>;

type DealRow = {
  id: string;
  dealName: string;
  account: string;
  amount: number;
  stage: string;
  owner: string;
};

const SEGMENTS = ["All", "Open", "Concluded"] as const;

export function DealsTable({ deals, source = "api" }: { deals: Deal[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Deal[]>(
    "crm.deals",
    deals,
    source,
    (d) => d.length === 0,
  );

  const [segment, setSegment] = useState<string>("All");

  const tableRows: DealRow[] = rows
    .filter((d) => {
      if (segment === "Open") return d.status === "open";
      if (segment === "Concluded") return d.status === "won";
      return true;
    })
    .map((d) => ({
      id: d.id,
      dealName: d.dealName,
      account: d.contactName ?? "—",
      amount: d.amount,
      stage: d.stage.replace(/_/g, " ").replace(/\bWon\b/, "Concluded").replace(/\bLost\b/, "Lapsed"),
      owner: d.owner,
    }));

  function exportCsv() {
    const header = ["Engagement", "Account", "Value", "Stage", "Owner"];
    const lines = tableRows.map((r) =>
      [r.dealName, r.account, String(r.amount), r.stage, r.owner]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `engagements-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card">
      <div className="card-h" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ marginRight: "auto" }}>Engagements</h3>
        <Segmented options={[...SEGMENTS]} value={segment} onChange={setSegment} />
      </div>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {rows.length === 0 ? (
        <EmptyState icon="◈" title="No engagements found" message="Start adding engagements to track your procurement pipeline." />
      ) : (
        <DataTable<DealRow>
          columns={[
            { key: "dealName", label: "Engagement" },
            { key: "account", label: "Account" },
            { key: "amount", label: "Value", align: "right", cellType: "amount" },
            { key: "stage", label: "Stage", cellType: "status" },
            { key: "owner", label: "Owner" },
          ]}
          rows={tableRows}
          rowHref={(row) => `/crm/deals/${row.id}`}
          sortable
          filterable
          filterPlaceholder="Filter engagements…"
          exportable
          exportFilename="engagements"
          pageSize={15}
        />
      )}
    </div>
  );
}
