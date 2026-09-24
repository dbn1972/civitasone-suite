import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { CreateFlexPlanForm } from "./CreateFlexPlanForm";
import { ElectFlexBenefitForm } from "./ElectFlexBenefitForm";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

// Note: the payroll-service only exposes POST /v1/payroll/flex-benefits/plans (create) —
// there is no GET list-all-plans endpoint. The only list endpoint available is the
// employee's own elections, so that is what this screen renders.
type ElectionRow = {
  id: string;
  plan_id: string;
  plan_name: string;
  fy: string;
  total_elected_minor: number | string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<ElectionRow[]>> {
  return fetchJson<unknown, ElectionRow[]>("/api/v1/payroll/flex-benefits/my-elections", [], {
    telemetryKey: "payroll.flex-benefits.my-elections",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ElectionRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function FlexBenefitsPage() {
  const t = await getTranslations("payrollFlexBenefits");
  const { data: elections, source } = await getData();
  const errored = source === "error";

  const columns: { key: keyof ElectionRow & string; label: string; align?: "left" | "right"; cellType?: "status" | "amount" }[] = [
    { key: "plan_name", label: t("colPlan") },
    { key: "fy", label: t("colFinancialYear") },
    { key: "total_elected_minor", label: t("colTotalElected"), align: "right", cellType: "amount" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  const totalElectedMinor = elections.reduce((sum, r) => sum + Number(r.total_elected_minor ?? 0), 0);
  const approvedElections = elections.filter((e) => e.status === "approved").length;
  const uniqueFYs = new Set(elections.map((e) => e.fy).filter(Boolean)).size;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      <StatGrid>
        <StatCard icon="🧩" iconBg="var(--infobg)" label={t("statMyElections")} value={errored ? null : elections.length} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statTotalElected")} value={errored ? null : formatMoney(totalElectedMinor)} />
        <StatCard icon="✅" iconBg="var(--warnbg)" label={t("statApproved")} value={errored ? null : approvedElections} />
        <StatCard icon="📅" iconBg="var(--goodbg)" label={t("statFinancialYears")} value={errored ? null : uniqueFYs} />
      </StatGrid>

      <CreateFlexPlanForm />
      <ElectFlexBenefitForm />

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "flex benefits" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <DataTable<ElectionRow>
          columns={columns}
          rows={elections}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🧩"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </div>
  );
}
