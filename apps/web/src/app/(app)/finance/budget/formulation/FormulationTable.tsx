"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, Segmented, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import type { BudgetSummary } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";
import {
  BUDGET_COLUMN_LABELS, BUDGET_TAB_ALL, BUDGET_TAB_OTHER, budgetHeadKey, budgetTabOf, budgetTabsFor, type BudgetTab,
} from "../_lib/budgetColumns";

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
  initialTab = BUDGET_TAB_ALL,
  highlightId,
}: {
  budgets: BudgetSummary[];
  source?: "api" | "error";
  /** head key (see budgetHeadKey) -> previous FY's BE in paise; absent = no prior-year row. */
  priorBe?: Record<string, string>;
  /** Tab to open on (from ?tab= or the highlighted row's status); falls back to All if it has no rows. */
  initialTab?: BudgetTab;
  /** id of an estimate the officer has just created (?highlight=): announced, and its tab is opened. */
  highlightId?: string;
}) {
  const t = useTranslations("financeBudgetFormulation");
  const [activeTab, setActiveTab] = useState<BudgetTab>(initialTab);
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<BudgetSummary[]>(
    "finance.budgets",
    budgets,
    source,
    (d) => d.length === 0,
  );

  // GAP-FINANCE-BUDGET-FORMULATION-05: one tab per status that actually has rows (the words are the same ones the
  // pill and the stat cards use), so no tab is dead. A tab that no longer has rows (stale link) falls back to All.
  const tabs = budgetTabsFor(rows);
  const effectiveTab = tabs.includes(activeTab) ? activeTab : BUDGET_TAB_ALL;
  const tabLabel = (tab: BudgetTab) => (tab === BUDGET_TAB_ALL ? t("tabAll") : tab === BUDGET_TAB_OTHER ? t("tabOther") : t(`status.${tab}`));
  const filtered = effectiveTab === BUDGET_TAB_ALL ? rows : rows.filter((b) => budgetTabOf(b.status) === effectiveTab);
  const highlighted = highlightId ? rows.find((b) => b.id === highlightId) : undefined;

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
      {highlightId ? (
        highlighted ? (
          <Alert variant="success" role="status" style={{ marginBottom: 12 }}>
            {t("highlightAdded", {
              head: highlighted.subHead ? `${highlighted.majorHead} · ${highlighted.subHead}` : highlighted.majorHead,
              fy: highlighted.financialYear,
              tab: tabLabel(budgetTabOf(highlighted.status)),
            })}
          </Alert>
        ) : (
          <Alert variant="info" role="status" style={{ marginBottom: 12 }}>{t("highlightPending")}</Alert>
        )
      ) : null}
      <div style={{ marginBottom: 12 }}>
        <Segmented
          options={tabs.map((tab) => ({ value: tab, label: tabLabel(tab) }))}
          value={effectiveTab}
          onChange={(v) => setActiveTab(v as BudgetTab)}
        />
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
