"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Segmented, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import type { UCSummary } from "@civitasone/types";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";

// UX-017 (tranche 10): same tab-identity fix as AdvancesTable.tsx -- TABS
// used to double as both <Segmented>'s displayed text AND the filter
// identity (TAB_STATUS_MAP[activeTab]); translating the strings in place
// would have silently broken filtering under hi.json (the same class of bug
// tranche 5 found in PfmsConsole.tsx). Tracked by position instead.
const TAB_STATUS_MAP: string[][] = [
  [], // All
  ["pending", "rejected"], // Pending
  ["submitted", "verified"], // Submitted
];

type Row = UCSummary & { period: string };

export function UCsTable({ ucs, source = "api" }: { ucs: UCSummary[]; source?: "api" | "error" }) {
  const t = useTranslations("expenditureUtilizationCertificatesTable");
  const TABS = [t("tabAll"), t("tabPending"), t("tabSubmitted")];
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<UCSummary[]>(
    "finance.ucs",
    ucs,
    source,
    (d) => d.length === 0,
  );

  const filtered =
    activeTabIndex === 0
      ? rows
      : rows.filter((u) => TAB_STATUS_MAP[activeTabIndex].includes(u.status));

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
        <Segmented
          options={TABS}
          value={TABS[activeTabIndex]}
          onChange={(v) => {
            const idx = TABS.indexOf(v);
            if (idx !== -1) setActiveTabIndex(idx);
          }}
        />
      </div>

      <DataTable<Row>
        columns={[
          { key: "ucNo", label: t("colUcNo"), render: (u) => <span className="mono">{u.ucNo}</span> },
          { key: "grantee", label: t("colGrantee") },
          { key: "grantRef", label: t("colGrantRef"), render: (u) => u.grantRef ?? "—" },
          { key: "period", label: t("colPeriod") },
          { key: "amount", label: t("colAmount"), align: "right", cellType: "amount" },
          { key: "submittedDate", label: t("colSubmitted"), render: (u) => formatIndianDate(u.submittedDate) },
          { key: "status", label: t("colStatus"), cellType: "status" },
        ]}
        rows={tableRows}
        sortable
        filterable
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={15}
      />
    </>
  );
}
