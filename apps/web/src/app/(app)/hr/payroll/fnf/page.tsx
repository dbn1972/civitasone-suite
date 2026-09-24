import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { ComputeFnfForm } from "./ComputeFnfForm";
import { FnFSettlementCards, type FnFCardRow } from "./FnFSettlementCard";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

type SettlementRow = {
  id: string;
  employeeId: string;
  employeeName?: string;
  separationType: string;
  separationDate: string;
  netPayableMinor: string | number;
  status: string;
  lastSalaryMinor?: number;
  gratuityMinor?: number;
  leaveEncashmentMinor?: number;
  bonusArrearsMinor?: number;
  deductionsMinor?: number;
} & Record<string, unknown>;

async function getSettlements(): Promise<LoaderResult<SettlementRow[]>> {
  return fetchJson<unknown, SettlementRow[]>("/api/v1/payroll/fnf/settlements", [], {
    telemetryKey: "payroll.fnf.settlements",
    mapResponse: (p) => {
      const arr = (p as { data?: SettlementRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function FnfPage() {
  const t = await getTranslations("payrollFnf");
  const { data: settlements, source } = await getSettlements();
  const errored = source === "error";

  const pending = settlements.filter((s) => s.status === "pending" || s.status === "computed" || s.status === "draft").length;
  const settled = settlements.filter((s) => s.status === "settled" || s.status === "paid" || s.status === "disbursed").length;
  const separationTypes = new Set(settlements.map((s) => s.separationType).filter(Boolean)).size;

  const cardRows: FnFCardRow[] = settlements.map((s) => ({
    id: s.id,
    employeeId: s.employeeId,
    employeeName: s.employeeName,
    separationType: s.separationType,
    separationDate: s.separationDate,
    status: s.status,
    netPayableMinor: s.netPayableMinor,
    lastSalaryMinor: s.lastSalaryMinor,
    gratuityMinor: s.gratuityMinor,
    leaveEncashmentMinor: s.leaveEncashmentMinor,
    bonusArrearsMinor: s.bonusArrearsMinor,
    deductionsMinor: s.deductionsMinor,
  }));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />

      <StatGrid>
        <StatCard icon="🧮" iconBg="var(--infobg)" label={t("statTotal")} value={errored ? null : settlements.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label={t("statPending")} value={errored ? null : pending} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statSettled")} value={errored ? null : settled} />
        <StatCard icon="📊" iconBg="var(--panel)" label={t("statSeparationTypes")} value={errored ? null : separationTypes} />
      </StatGrid>

      <ComputeFnfForm />

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "fnf" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <div style={{ padding: "0 4px" }}>
          <FnFSettlementCards rows={cardRows} />
        </div>
        )}
      </Card>
    </div>
  );
}
