import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { LoanSearchForm } from "./LoanSearchForm";
import { CreateLoanForm } from "./CreateLoanForm";
import { LoansTable, type LoanRow } from "./LoansTable";
import { toHumanError } from "@/lib/messages";

async function getLoans(empId: string): Promise<LoaderResult<LoanRow[]>> {
  return fetchJson<unknown, LoanRow[]>(`/api/v1/payroll/loans?empId=${encodeURIComponent(empId)}`, [], {
    telemetryKey: "payroll.loans",
    mapResponse: (p) => (Array.isArray(p) ? (p as LoanRow[]) : null),
  });
}

export default async function LoansPage({
  searchParams,
}: {
  searchParams: { empId?: string };
}) {
  const t = await getTranslations("payrollLoans");
  const empId = searchParams?.empId?.trim() || "";
  const result: LoaderResult<LoanRow[]> = empId ? await getLoans(empId) : { data: [], source: "api" };
  const errored = result.source === "error";
  const loans = result.data;
  const activeLoans = loans.filter((l) => ["applied", "disbursed", "active"].includes(l.status)).length;
  const totalOutstandingMinor = loans.reduce((s, l) => s + Number(l.outstandingMinor || 0), 0);
  const totalEmiMinor = loans.reduce((s, l) => s + Number(l.emiMinor || 0), 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll"
      />
      {empId && <DataSourceBadge source={result.source} message={t("loadErrorMessage")} />}

      {empId && (
        <StatGrid>
          <StatCard icon="💳" iconBg="var(--infobg)" label={t("statTotalLoans")} value={errored ? null : loans.length} />
          <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statActiveDisbursed")} value={errored ? null : activeLoans} />
          <StatCard icon="💰" iconBg="var(--warnbg)" label={t("statTotalOutstanding")} value={errored ? null : formatMoney(totalOutstandingMinor)} />
          <StatCard icon="📅" iconBg="var(--goodbg)" label={t("statMonthlyEmiTotal")} value={errored ? null : formatMoney(totalEmiMinor)} />
        </StatGrid>
      )}

      <Card title={t("searchCardTitle")}>
        <LoanSearchForm initialEmpId={empId} />
      </Card>

      <CreateLoanForm />

      <Card title={t("loansCardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "loans" })} backHref="/hr/payroll" />
          </div>
        ) : (<>

        {!empId ? (
          <EmptyState
            icon="🔎"
            title={t("searchEmptyTitle")}
            message={t("searchEmptyMessage")}
          />
        ) : (
          <LoansTable rows={loans} />
        )}
        </>)}
        </Card>

      <Card title={t("recoveryCardTitle")}>
        <EmptyState
          icon="📅"
          title={t("recoveryEmptyTitle")}
          message={t("recoveryEmptyMessage")}
        />
      </Card>
    </main>
  );
}
