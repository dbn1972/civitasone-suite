"use client";
import { useTranslations } from "next-intl";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { humanizeStatus } from "@/lib/formatters";
import { guaranteeValidity } from "@/lib/finance/expenditureStats";
import type { FinanceGuaranteeSummary } from "@civitasone/types";
type Row = FinanceGuaranteeSummary & { validity?: string };
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
          { key: "type", label: t("colType"), render: (g) => humanizeStatus(String(g.type)) },
          { key: "amountMinor", label: t("colAmount"), align: "right", cellType: "amount" },
          { key: "feePct", label: t("colFeePct"), align: "right" },
          { key: "validUntil", label: t("colValidUntil"), cellType: "date" },
          {
            key: "validity",
            label: t("colValidity"),
            // Flagged by TEXT as well as colour (WCAG 1.4.1).
            render: (g) => {
              const v = guaranteeValidity(g);
              if (v === "lapsed") return <span className="pill bad">{t("validityLapsed")}</span>;
              if (v === "expiring") return <span className="pill warn">{t("validityExpiring")}</span>;
              return <span style={{ color: "var(--mut)" }}>{v === "ok" ? t("validityOk") : "—"}</span>;
            },
          },
          { key: "beneficiary", label: t("colBeneficiary") },
          { key: "linkedRef", label: t("colLinkedRef") },
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
