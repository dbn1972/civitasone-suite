"use client";
import { useTranslations } from "next-intl";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { StatusPill } from "@/app/_components/ds";
import { utilisationPercent, isOverUtilised } from "@/lib/formatters";
import type { FinanceSchemeSummary } from "@civitasone/types";
// `utilisation` is a derived NUMBER (percent, one decimal, null = no outlay) so
// the column sorts numerically; cellType "percent" keeps the CSV export in
// "%" form (GAP-...-SCHEME-TRACKING-05).
type Row = FinanceSchemeSummary & { utilisation: number | null };
export function SchemeTable({ schemes, source = "api" }: { schemes: FinanceSchemeSummary[]; source?: "api" | "error" }) {
  const t = useTranslations("expenditureSchemeTrackingTable");
  const { data: base, provenance, offline, cachedAt } = useSeededResource<FinanceSchemeSummary[]>("finance.schemes", schemes, source, (d) => d.length === 0);
  const rows: Row[] = base.map((r) => ({ ...r, utilisation: utilisationPercent(r.utilisedMinor, r.outlayMinor) }));
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
          {
            key: "utilisation",
            label: t("colUtilisation"),
            align: "right",
            // Over-utilisation (spend above outlay) must be visible in the list.
            cellType: "percent",
            render: (r) => {
              if (r.utilisation === null) return "—";
              return isOverUtilised(r.utilisedMinor, r.outlayMinor)
                ? <StatusPill status="over-utilised" variant="bad" label={`${r.utilisation}% · ${t("overUtilised")}`} />
                : `${r.utilisation}%`;
            },
          },
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
