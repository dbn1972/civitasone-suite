import { PageHeader, Card, LoadErrorState } from "../../../../_components/ds";
import { getFinancialStatements } from "../../../../_data/loaders";
import { StatementsTable } from "./StatementsTable";
import { PrintExportButton } from "../../_components/PrintExportButton";

/**
 * GET /v1/finance/statements is an all-time (cumulative) trial balance per head:
 * finance-service ignores any `?fy=` and reports openingBalance 0. So this page
 * makes no financial-year claim -- no FY picker, no FY in the title -- and says
 * "cumulative, all periods" instead (GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-02).
 */
export default async function FinancialStatementsPage() {
  const result = await getFinancialStatements();
  const { data: statements, source } = result;

  return (
    <>
      <PageHeader
        title="Financial Statements"
        subtitle="Receipts &amp; Payments, Income &amp; Expenditure, Balance Sheet — cumulative, all periods."
        actions={<PrintExportButton label="Export PDF" documentTitle="Financial Statements" />}
      />

      {source === "error" && result.status === 403 ? (
        <LoadErrorState result={result} area="financial statements" backHref="/finance" />
      ) : (
        <Card title="Financial Statements · cumulative, all periods">
          <StatementsTable statements={statements} source={source} />
        </Card>
      )}
    </>
  );
}
