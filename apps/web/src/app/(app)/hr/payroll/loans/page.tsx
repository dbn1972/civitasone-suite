import { PageHeader, Card, EmptyState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { LoanSearchForm } from "./LoanSearchForm";
import { CreateLoanForm } from "./CreateLoanForm";
import { LoansTable, type LoanRow } from "./LoansTable";

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
  const empId = searchParams?.empId?.trim() || "";
  const result: LoaderResult<LoanRow[]> = empId ? await getLoans(empId) : { data: [], source: "api" };
  const loans = result.data;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Employee Loans"
        subtitle="Search, create and disburse employee loans and view the sanctioned amount, EMI and outstanding balance."
        back="/hr/payroll"
      />
      {empId && result.source === "error" && <DataSourceBadge source="error" />}

      <Card title="Search Loans by Employee">
        <LoanSearchForm initialEmpId={empId} />
      </Card>

      <CreateLoanForm />

      <Card title="Loans">
        {!empId ? (
          <EmptyState
            icon="🔎"
            title="Search for an employee to see their loans"
            message="The payroll-service only supports listing loans for one employee at a time (GET /v1/payroll/loans requires empId) — there is no all-tenant loan list endpoint. Enter an employee ID above."
          />
        ) : (
          <LoansTable rows={loans} />
        )}
      </Card>

      <Card title="Recovery Schedule">
        <EmptyState
          icon="📅"
          title="No repayment schedule yet"
          message="Repayment installments will appear here once the loan is processed and approved. Each EMI will show the amount, due date, and status."
        />
      </Card>
    </main>
  );
}
