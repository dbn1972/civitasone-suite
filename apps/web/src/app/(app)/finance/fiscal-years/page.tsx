import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getFinanceFiscalYears } from "@/app/_data/loaders";
import { FiscalYearForm } from "./FiscalYearForm";
import { FiscalYearsTable } from "./FiscalYearsTable";
import { getPeriods } from "../period-close/periodsLoader";

export default async function FiscalYearsPage() {
  const [{ data: fiscalYears, source }, periodsResult] = await Promise.all([getFinanceFiscalYears(), getPeriods()]);
  const activeYear = fiscalYears.find((fy) => fy.status === "active");

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Fiscal Years"
        subtitle="Define financial years and set the one currently open for posting."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source="error" /> : null}
      />

      <StatGrid>
        <StatCard icon="📅" iconBg="#e6f0ff" label="Total Fiscal Years" value={fiscalYears.length} />
        <StatCard icon="🟢" iconBg="#e6f7f0" label="Active Fiscal Year" value={activeYear?.code ?? "—"} />
      </StatGrid>

      <FiscalYearForm rows={fiscalYears} />

      <FiscalYearsTable
        rows={fiscalYears}
        periods={periodsResult.data}
        periodsUnavailable={periodsResult.source === "error"}
      />
    </div>
  );
}
