"use client";
import { useTranslations } from "next-intl";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceSchemeSummary } from "@civitasone/types";
type Row = FinanceSchemeSummary;
export function SchemeTable({ schemes, source = "api" }: { schemes: Row[]; source?: "api" | "error" }) {
  const t = useTranslations("expenditureSchemeTrackingTable");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("finance.schemes", schemes, source, (d) => d.length === 0);
  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Row>
        columns={[
          { key: "code", label: t("colCode") },
          { key: "name", label: t("colScheme") },
          { key: "funding", label: t("colFunding") },
          { key: "outlayMinor", label: t("colOutlay"), align: "right", cellType: "amount" },
          { key: "utilisedMinor", label: t("colUtilised"), align: "right", cellType: "amount" },
          { key: "status", label: t("colStatus"), cellType: "status" },
        ]}
        rows={rows}
        rowLinkKey="id"
        rowLinkPrefix="/finance/expenditure/scheme-tracking/"
        identifyingColumnKey="name"
        sortable
        filterable
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={15}
        exportable
        exportFilename="scheme-tracking"
        emptyIcon="🎯"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
      />
    </>
  );
}
