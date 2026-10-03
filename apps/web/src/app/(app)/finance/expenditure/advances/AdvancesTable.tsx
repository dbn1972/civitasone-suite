"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Segmented, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import type { AdvanceSummary } from "@civitasone/types";
import { formatIndianDate, humanizeStatus } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";

// UX-017 (tranche 10): TABS used to double as both <Segmented>'s displayed
// text AND the filter identity (TAB_STATUS_MAP[activeTab], activeTab ===
// "All") -- translating the strings in place would have silently broken tab
// filtering under hi.json, the same class of bug tranche 5 found in
// PfmsConsole.tsx's own TABS array (Tabs.tsx/Segmented.tsx both compare by
// plain string identity, with no separate value/label pair). Fixed by
// tracking the active tab by POSITION instead of by the (now-translated)
// string value, so selection stays correct in either locale.
const TAB_STATUS_MAP: string[][] = [
  [], // All
  ["active"], // Open
  ["overdue"], // Overdue
];

// GAP-FINANCE-EXPENDITURE-ADVANCES-03: personal (officer/employee) advances
// and party (vendor / other) advances share one list; this second filter, also
// tracked by position, separates them. `type` is the API's own enum.
const KIND_TYPE_MAP: string[][] = [
  [], // All
  ["employee"], // Officers
  ["vendor", "other"], // Parties
];

export function AdvancesTable({ advances, source = "api" }: { advances: AdvanceSummary[]; source?: "api" | "error" }) {
  const t = useTranslations("expenditureAdvancesTable");
  const TABS = [t("tabAll"), t("tabOpen"), t("tabOverdue")];
  const KINDS = [t("kindAll"), t("kindOfficer"), t("kindParty")];
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [activeKindIndex, setActiveKindIndex] = useState(0);
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<AdvanceSummary[]>(
    "finance.advances",
    advances,
    source,
    (d) => d.length === 0,
  );

  const filtered = rows.filter(
    (a) =>
      (activeTabIndex === 0 || TAB_STATUS_MAP[activeTabIndex].includes(a.status)) &&
      (activeKindIndex === 0 || KIND_TYPE_MAP[activeKindIndex].includes(a.type)),
  );

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <div className="no-print" style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Segmented
          options={KINDS}
          value={KINDS[activeKindIndex]}
          onChange={(v) => {
            const idx = KINDS.indexOf(v);
            if (idx !== -1) setActiveKindIndex(idx);
          }}
        />
        <Segmented
          options={TABS}
          value={TABS[activeTabIndex]}
          onChange={(v) => {
            const idx = TABS.indexOf(v);
            if (idx !== -1) setActiveTabIndex(idx);
          }}
        />
      </div>

      <DataTable<AdvanceSummary>
        columns={[
          { key: "advanceNo", label: t("colAdvanceNo"), render: (a) => <span className="mono">{a.advanceNo}</span> },
          { key: "beneficiary", label: t("colBeneficiary") },
          { key: "type", label: t("colType"), render: (a) => humanizeStatus(a.type) },
          { key: "purpose", label: t("colPurpose"), render: (a) => a.purpose ?? "—" },
          { key: "amount", label: t("colAdvance"), align: "right", cellType: "amount" },
          { key: "adjustedAmount", label: t("colSettled"), align: "right", cellType: "amount" },
          { key: "balance", label: t("colBalance"), align: "right", cellType: "amount" },
          { key: "disbursedDate", label: t("colDisbursed"), render: (a) => formatIndianDate(a.disbursedDate) },
          { key: "dueDate", label: t("colDue"), render: (a) => formatIndianDate(a.dueDate) },
          { key: "status", label: t("colStatus"), cellType: "status" },
        ]}
        rows={filtered}
        sortable
        filterable
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={15}
        exportable
        exportFilename="advances-register"
      />
    </>
  );
}
