"use client";

import { useState } from "react";
import { Segmented, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
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
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<AdvanceSummary[]>(
    "finance.advances",
    advances,
    source,
    (d) => d.length === 0,
  );

  const filtered =
    activeTab === "All"
      ? rows
      : rows.filter((a) => TAB_STATUS_MAP[activeTab].includes(a.status));

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
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
