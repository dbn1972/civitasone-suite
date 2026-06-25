"use client";

import { useState } from "react";
import { Segmented, DataTable } from "../../../../_components/ds";
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
  lastYear: number;
  proposed: number;
  expenditure: number;
  balance: number;
  financialYear: string;
  status: string;
};

export function FormulationTable({ budgets, source = "api" }: { budgets: BudgetSummary[]; source?: "api" | "error" }) {
  const [activeTab, setActiveTab] = useState<Tab>("All");
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<BudgetSummary[]>(
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
