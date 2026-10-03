import { PageHeader, StatGrid, StatCard, LoadErrorState } from "../../../_components/ds";
import { getFinanceFiscalYears } from "@/app/_data/loaders";
import { FiscalYearForm } from "./FiscalYearForm";
import { FiscalYearsTable } from "./FiscalYearsTable";
import { getPeriods } from "../period-close/periodsLoader";

export default async function FiscalYearsPage() {
  const [result, periodsResult] = await Promise.all([getFinanceFiscalYears(), getPeriods()]);
  const { data: fiscalYears, source } = result;
  const activeYear = fiscalYears.find((fy) => fy.status === "active");
  // GAP-FINANCE-FISCAL-YEARS-03: a failed load is not "no fiscal years". Show
  // the retry state instead of Total 0 / the create prompt, and do not offer
  // the create form -- the existing years are unknown, so a duplicate or
  // overlapping year could be created blind.
  const failed = source === "error";

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Fiscal Years"
        subtitle="Define financial years and set the one currently open for posting."
        back="/finance"
      />

      {failed ? (
        <LoadErrorState result={result} area="fiscal years" backHref="/finance" />
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
