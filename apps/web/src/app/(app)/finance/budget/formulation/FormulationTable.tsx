"use client";

import { useState } from "react";
import { Segmented, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import type { BudgetSummary } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";

type Tab = "All" | "Submitted" | "Approved" | "Pending";

const TABS: Tab[] = ["All", "Submitted", "Approved", "Pending"];

const TAB_STATUS_MAP: Record<Tab, string[]> = {
  All: [],
  Submitted: ["submitted"],
  Approved: ["approved"],
  Pending: ["pending"],
};

type Row = {
  majorHead: string;
  subHead: string;
  // Minor-unit (paise) decimal strings — cellType:"amount" passes these to
  // formatMoney() directly; do not convert to number here.
  lastYear: string;
  proposed: string;
  expenditure: string;
  balance: string;
  financialYear: string;
  status: string;
};

export function FormulationTable({ budgets, source = "api" }: { budgets: BudgetSummary[]; source?: "api" | "error" }) {
  const [activeTab, setActiveTab] = useState<Tab>("All");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<BudgetSummary[]>(
    "finance.budgets",
    budgets,
    source,
    (d) => d.length === 0,
  );

  const filtered =
    activeTab === "All"
      ? rows
      : rows.filter((b) => TAB_STATUS_MAP[activeTab].includes(b.status));

  const tableRows: Row[] = filtered.map((b) => ({
    majorHead: b.majorHead,
    subHead: b.subHead ?? "—",
    lastYear: b.releasedAmount,
    proposed: b.sanctionedAmount,
    expenditure: b.expenditure,
    balance: b.balance,
    financialYear: b.financialYear,
    status: b.status,
  }));

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
          { key: "majorHead", label: "Major Head" },
          { key: "subHead", label: "Sub Head" },
          { key: "lastYear", label: "Last Year (BE)", align: "right", cellType: "amount" },
          { key: "proposed", label: "Proposed (BE)", align: "right", cellType: "amount" },
          { key: "expenditure", label: "Expenditure", align: "right", cellType: "amount" },
          { key: "balance", label: "Balance", align: "right", cellType: "amount" },
          { key: "financialYear", label: "FY" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={tableRows}
        sortable
        filterable
        filterPlaceholder="Search budget heads…"
        pageSize={15}
      />
    </>
  );
}
