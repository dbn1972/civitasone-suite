"use client";

import { useState } from "react";
import { Segmented, DataTable } from "../../../../_components/ds";
import type { AdvanceSummary } from "@civitasone/types";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";

type Tab = "All" | "Open" | "Overdue";

const TABS: Tab[] = ["All", "Open", "Overdue"];

const TAB_STATUS_MAP: Record<Tab, string[]> = {
  All: [],
  Open: ["active"],
  Overdue: ["overdue"],
};

export function AdvancesTable({ advances, source = "api" }: { advances: AdvanceSummary[]; source?: "api" | "error" }) {
  const [activeTab, setActiveTab] = useState<Tab>("All");
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<AdvanceSummary[]>(
    "finance.advances",
    advances,
    source,
    (d) => d.length === 0,
  );

  const filtered =
    activeTab === "All"
      ? rows
      : rows.filter((a) => TAB_STATUS_MAP[activeTab].includes(a.status));

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
      <div style={{ marginBottom: 12 }}>
        <Segmented options={TABS} value={activeTab} onChange={(v) => setActiveTab(v as Tab)} />
      </div>

      <DataTable<AdvanceSummary>
        columns={[
          { key: "advanceNo", label: "Advance No", render: (a) => <span className="mono">{a.advanceNo}</span> },
          { key: "beneficiary", label: "Officer / Party" },
          { key: "type", label: "Purpose", render: (a) => <span style={{ textTransform: "capitalize" }}>{a.type}</span> },
          { key: "amount", label: "Advance", align: "right", cellType: "amount" },
          { key: "adjustedAmount", label: "Settled", align: "right", cellType: "amount" },
          { key: "balance", label: "Balance", align: "right", cellType: "amount" },
          { key: "disbursedDate", label: "Disbursed", render: (a) => formatIndianDate(a.disbursedDate) },
          { key: "dueDate", label: "Due", render: (a) => formatIndianDate(a.dueDate) },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={filtered}
        sortable
        filterable
        filterPlaceholder="Search advances…"
        pageSize={15}
      />
    </>
  );
}
