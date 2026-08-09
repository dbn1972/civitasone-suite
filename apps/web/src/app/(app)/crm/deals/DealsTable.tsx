"use client";

import { useState } from "react";
import { DataTable, Segmented, EmptyState } from "../../../_components/ds";
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

const SEGMENTS = ["All", "Open", "Won"] as const;

export function DealsTable({ deals, source = "api" }: { deals: Deal[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Deal[]>(
    "crm.deals",
    deals,
    source,
    (d) => d.length === 0,
  );

  const [segment, setSegment] = useState<string>("All");

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  const tableRows: DealRow[] = rows
    .filter((d) => {
      if (segment === "Open") return d.status === "open";
      if (segment === "Won") return d.status === "won";
      return true;
    })
    .map((d) => ({
      id: d.id,
      dealName: d.dealName,
      account: d.contactName ?? "—",
      amount: d.amount,
      stage: d.stage.replace(/_/g, " "),
      owner: d.owner,
    }));

  function exportCsv() {
    const header = ["Deal", "Account", "Value", "Stage", "Owner"];
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
    a.download = `deals-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card">
      <div className="card-h" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ marginRight: "auto" }}>Deals</h3>
        <Segmented options={[...SEGMENTS]} value={segment} onChange={setSegment} />
      </div>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon="🎯" title="No deals found" message="Start adding deals to track your pipeline." />
      ) : (
        <DataTable<DealRow>
          columns={[
            { key: "dealName", label: "Deal #" },
            { key: "account", label: "Account" },
            { key: "amount", label: "Value", align: "right", cellType: "amount" },
            { key: "stage", label: "Stage", cellType: "status" },
            { key: "owner", label: "Owner" },
          ]}
          rows={tableRows}
          rowHref={(row) => `/crm/deals/${row.id}`}
          sortable
          filterable
          filterPlaceholder="Filter deals by name, account or stage…"
          exportable
          exportFilename="deals"
          pageSize={15}
        />
      )}
    </div>
  );
}
