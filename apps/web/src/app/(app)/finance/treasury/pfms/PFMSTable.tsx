"use client";

import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { PfmsBatchSummary } from "@civitasone/types";

type Scroll = PfmsBatchSummary;

export function PFMSTable({ scrolls, source = "api" }: { scrolls: Scroll[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Scroll[]>(
    "finance.pfms.scrolls",
    scrolls,
    source,
    (d) => d.length === 0,
  );

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Scroll>
        columns={[
          { key: "pfmsId", label: "Scroll ID" },
          { key: "type", label: "Type" },
          { key: "amountMinor", label: "Amount", align: "right", cellType: "amount" },
          { key: "agencyCode", label: "Agency" },
          { key: "schemeCode", label: "Scheme" },
          { key: "submissionStatus", label: "Status", cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search PFMS scrolls…"
        pageSize={15}
        exportable
        exportFilename="pfms-scrolls"
        emptyIcon="📜"
        emptyTitle="No PFMS scrolls"
        emptyMessage="No payment scrolls found. Scrolls appear when payments are registered with PFMS."
      />
    </>
  );
}
