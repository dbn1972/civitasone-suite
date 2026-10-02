"use client";

import { useState } from "react";
import { Segmented, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import type { BudgetSummary } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";
import { BUDGET_COLUMN_LABELS, BUDGET_STATUS_LABEL, budgetHeadKey, type BudgetStatus } from "../_lib/budgetColumns";

// The tab labels ARE the status labels (one vocabulary with the stat cards and
// the status pill -- GAP-FINANCE-BUDGET-FORMULATION-05).
const TAB_STATUSES: BudgetStatus[] = ["submitted", "approved", "pending"];
const ALL_TAB = "All";
const TABS: string[] = [ALL_TAB, ...TAB_STATUSES.map((s) => BUDGET_STATUS_LABEL[s])];

type Row = {
  majorHead: string;
  subHead: string;
  // Minor-unit (paise) decimal strings (null = no such figure) -- cellType:"amount"
  // passes these to formatMoney() directly; do not convert to number here.
  priorBe: string | null;
  be: string;
  sanctioned: string;
  released: string;
  expenditure: string;
  balance: string;
  financialYear: string;
  status: string;
};

export function FormulationTable({
  budgets,
  source = "api",
  priorBe = {},
}: {
  budgets: BudgetSummary[];
  source?: "api" | "error";
  /** head key (see budgetHeadKey) -> previous FY's BE in paise; absent = no prior-year row. */
  priorBe?: Record<string, string>;
}) {
  const [activeTab, setActiveTab] = useState<string>(ALL_TAB);
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<BudgetSummary[]>(
    "finance.budgets",
    budgets,
    source,
    (d) => d.length === 0,
  );

  const activeStatus = TAB_STATUSES.find((s) => BUDGET_STATUS_LABEL[s] === activeTab);
  const filtered = activeStatus ? rows.filter((b) => b.status === activeStatus) : rows;

  // GAP-FINANCE-BUDGET-FORMULATION-01: each column shows the field it is
  // named for. "Last Year" used to print releasedAmount and "Proposed" printed
  // sanctionedAmount; BE is beMinor (same field Revised Estimates uses).
  // Last year's BE is per HEAD: if the current FY repeats a head, attach it to the
  // first row only (over the unfiltered rows, so a tab never changes which row)
  // -- repeating it would make a column total double-count last year.
  const priorOwner = new Map<string, string>();
  for (const b of rows) if (!priorOwner.has(budgetHeadKey(b))) priorOwner.set(budgetHeadKey(b), b.id);

  const tableRows: Row[] = filtered.map((b) => ({
    majorHead: b.majorHead,
    subHead: b.subHead ?? "—",
    priorBe: priorOwner.get(budgetHeadKey(b)) === b.id ? (priorBe[budgetHeadKey(b)] ?? null) : null,
    be: b.beMinor,
    sanctioned: b.sanctionedAmount,
    released: b.releasedAmount,
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
        <Segmented options={TABS} value={activeTab} onChange={(v) => setActiveTab(v)} />
      </div>

      <DataTable<Row>
        columns={[
          { key: "majorHead", label: "Major Head" },
          { key: "subHead", label: "Sub Head" },
          { key: "priorBe", label: BUDGET_COLUMN_LABELS.priorBe, align: "right", cellType: "amount" },
          { key: "be", label: BUDGET_COLUMN_LABELS.be, align: "right", cellType: "amount" },
          { key: "sanctioned", label: BUDGET_COLUMN_LABELS.sanctioned, align: "right", cellType: "amount" },
          { key: "released", label: BUDGET_COLUMN_LABELS.released, align: "right", cellType: "amount" },
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
