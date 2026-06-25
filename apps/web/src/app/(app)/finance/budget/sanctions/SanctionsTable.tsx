"use client";

import { useState } from "react";
import { Segmented, DataTable } from "../../../../_components/ds";
import type { SanctionSummary } from "@civitasone/types";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";

type Tab = "All" | "Pending" | "Sanctioned";

const TABS: Tab[] = ["All", "Pending", "Sanctioned"];

const TAB_STATUS_MAP: Record<Tab, string[]> = {
  All: [],
  Pending: ["pending"],
  Sanctioned: ["approved"],
};

export function SanctionsTable({ sanctions, source = "api" }: { sanctions: SanctionSummary[]; source?: "api" | "error" }) {
  const [activeTab, setActiveTab] = useState<Tab>("All");
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<SanctionSummary[]>(
    "finance.sanctions",
    sanctions,
    source,
    (d) => d.length === 0,
  );

  const filtered =
    activeTab === "All"
      ? rows
      : rows.filter((s) => TAB_STATUS_MAP[activeTab].includes(s.status));

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

      <DataTable<SanctionSummary>
        columns={[
          { key: "sanctionNo", label: "Sanction", render: (s) => <span className="mono">{s.sanctionNo}</span> },
          { key: "subject", label: "Purpose" },
          { key: "majorHead", label: "Head" },
          { key: "amount", label: "Amount", align: "right", cellType: "amount" },
          { key: "sanctionedBy", label: "Sanctioned By" },
          { key: "date", label: "Date", render: (s) => formatIndianDate(s.date) },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={filtered}
        rowHref={(s) => `/finance/budget/sanctions/${s.id}`}
        sortable
        filterable
        filterPlaceholder="Search sanctions…"
        pageSize={15}
      />
    </>
  );
}
