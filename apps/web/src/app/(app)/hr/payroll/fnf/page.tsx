import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { ComputeFnfForm } from "./ComputeFnfForm";
import { FnFSettlementCards, type FnFCardRow } from "./FnFSettlementCard";

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
  const { data: settlements, source } = await getSettlements();

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
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Full & Final Settlement"
        subtitle="Compute and track F&F separation settlements — last salary, gratuity, leave encashment, arrears."
        back="/hr/payroll"
      />
      <DataSourceBadge source={source} message="Couldn't load F&F settlements — showing nothing" />

      <StatGrid>
        <StatCard icon="🧮" iconBg="var(--infobg)" label="Total Settlements" value={settlements.length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label="Pending / Draft" value={pending} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Settled / Disbursed" value={settled} />
        <StatCard icon="📊" iconBg="var(--panel)" label="Separation Types" value={separationTypes} />
      </StatGrid>

      <ComputeFnfForm />

      <Card title="F&F Settlements">
        <div style={{ padding: "0 4px" }}>
          <FnFSettlementCards rows={cardRows} />
        </div>
      </Card>
    </main>
  );
}
