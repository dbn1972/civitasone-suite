import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { CreateSalaryRevisionForm } from "./CreateSalaryRevisionForm";

// HIGH fix: the comment this replaced claimed "payroll-service exposes GET
// /v1/payroll/salary-revisions but no create route" -- that was stale.
// POST /v1/payroll/salary-revisions (world-class-routes.ts) exists and
// works (publishes payroll.salary_revision.create; the consumer persists
// it), it just had zero UI callers. See CreateSalaryRevisionForm.tsx.

type Row = {
  id: string;
  employee_id: string;
  effective_date: string;
  old_basic_minor: number | string;
  new_basic_minor: number | string;
  old_gross_minor: number | string;
  new_gross_minor: number | string;
  revision_type: string;
  order_no: string | null;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/payroll/salary-revisions", [], {
    telemetryKey: "payroll.salary-revisions",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

// UX-017: keys are the stable backend revision_type codes, never translated
// -- only used to look up which message key holds the display text. Same
// safe pattern as OffCycleCard.tsx's REASON_LABEL_KEYS.
const REVISION_TYPE_KEYS: Record<string, string> = {
  annual_increment: "revisionTypeAnnualIncrement",
  promotion: "revisionTypePromotion",
  special: "revisionTypeSpecial",
  pay_commission: "revisionTypePayCommission",
  market_correction: "revisionTypeMarketCorrection",
};

export default async function SalaryRevisionsPage() {
  const t = await getTranslations("salaryRevisions");
  const { data: rawItems, source } = await getData();
  const errored = source === "error";

  const items = rawItems.map((r) => {
    const key = REVISION_TYPE_KEYS[r.revision_type];
    return {
      ...r,
      revisionTypeLabel: key ? t(key) : r.revision_type,
    };
  });
  type Row2 = (typeof items)[number];

  const columns: { key: keyof Row2 & string; label: string; align?: "left" | "right"; cellType?: "status" | "amount" }[] = [
    { key: "employee_id", label: t("colEmployee") },
    { key: "effective_date", label: t("colEffectiveDate") },
    { key: "revisionTypeLabel", label: t("colRevisionType") },
    { key: "old_basic_minor", label: t("colOldBasic"), align: "right", cellType: "amount" },
    { key: "new_basic_minor", label: t("colNewBasic"), align: "right", cellType: "amount" },
    { key: "new_gross_minor", label: t("colNewGross"), align: "right", cellType: "amount" },
    { key: "order_no", label: t("colOrderNo") },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      <StatGrid>
        <StatCard icon="📈" iconBg="var(--infobg)" label={t("statTotalRevisions")} value={errored ? null : items.length} />
        <StatCard icon="🏅" iconBg="var(--goodbg)" label={t("statIncrements")} value={errored ? null : items.filter((i) => i.revision_type === "annual_increment").length} />
        <StatCard icon="🎯" iconBg="var(--warnbg)" label={t("statPromotions")} value={errored ? null : items.filter((i) => i.revision_type === "promotion").length} />
        <StatCard icon="🏛" iconBg="var(--panel)" label={t("statPayCommission")} value={errored ? null : items.filter((i) => i.revision_type === "pay_commission").length} />
      </StatGrid>

      <CreateSalaryRevisionForm />

      <Card title={t("historyCardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "salary revisions" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <DataTable<Row2>
          columns={columns}
          rows={items}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="📈"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </div>
  );
}
