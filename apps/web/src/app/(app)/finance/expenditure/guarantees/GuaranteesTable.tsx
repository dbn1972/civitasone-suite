"use client";
import { useTranslations } from "next-intl";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { FinanceGuaranteeSummary } from "@civitasone/types";
type Row = FinanceGuaranteeSummary;
export function GuaranteesTable({ guarantees, source = "api" }: { guarantees: Row[]; source?: "api" | "error" }) {
  const t = useTranslations("expenditureGuaranteesTable");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>("finance.guarantees", guarantees, source, (d) => d.length === 0);
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
          { key: "entity", label: t("colEntity") },
          { key: "type", label: t("colType") },
          { key: "amountMinor", label: t("colAmount"), align: "right", cellType: "amount" },
          { key: "feePct", label: t("colFeePct"), align: "right" },
          { key: "status", label: t("colStatus"), cellType: "status" },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={15}
        exportable
        exportFilename="guarantees-emd"
        emptyIcon="🛡️"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
      />
    </>
  );
}
