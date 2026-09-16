"use client";

import { useState } from "react";
import { Segmented, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import type { UCSummary } from "@civitasone/types";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";

type Tab = "All" | "Pending" | "Submitted";

const TABS: Tab[] = ["All", "Pending", "Submitted"];

const TAB_STATUS_MAP: Record<Tab, string[]> = {
  All: [],
  Pending: ["pending", "rejected"],
  Submitted: ["submitted", "verified"],
};

type Row = UCSummary & { period: string };

export function UCsTable({ ucs, source = "api" }: { ucs: UCSummary[]; source?: "api" | "error" }) {
  const [activeTab, setActiveTab] = useState<Tab>("All");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<UCSummary[]>(
    "finance.ucs",
    ucs,
    source,
    (d) => d.length === 0,
  );

  const filtered =
    activeTab === "All"
      ? rows
      : rows.filter((u) => TAB_STATUS_MAP[activeTab].includes(u.status));

  const tableRows: Row[] = filtered.map((u) => ({ ...u, period: `${u.periodFrom} – ${u.periodTo}` }));

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

      <DataTable<Row>
        columns={[
          { key: "ucNo", label: "UC No", render: (u) => <span className="mono">{u.ucNo}</span> },
          { key: "grantee", label: "Grantee" },
          { key: "grantRef", label: "Grant Ref", render: (u) => u.grantRef ?? "—" },
          { key: "period", label: "Period" },
          { key: "amount", label: "Amount", align: "right", cellType: "amount" },
          { key: "submittedDate", label: "Submitted", render: (u) => formatIndianDate(u.submittedDate) },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={tableRows}
        sortable
        filterable
        filterPlaceholder="Search UCs…"
        pageSize={15}
      />
    </>
  );
}
