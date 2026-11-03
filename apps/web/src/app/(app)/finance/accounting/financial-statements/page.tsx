import { PageHeader, Card, LoadErrorState } from "../../../../_components/ds";
import { getChartOfAccounts, getFinancialStatements } from "../../../../_data/loaders";
import { buildHeadLookup } from "../../_components/headLookup";
import { StatementsTable } from "./StatementsTable";
import { PrintExportButton } from "../../_components/PrintExportButton";
import { PrintHeader } from "../../_components/PrintHeader";

/**
 * GET /v1/finance/statements is an all-time (cumulative) trial balance per head:
 * finance-service ignores any `?fy=` and reports openingBalance 0. So this page
 * makes no financial-year claim -- no FY picker, no FY in the title -- and says
 * "cumulative, all periods" instead (GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-02).
 */
export default async function FinancialStatementsPage() {
  const [result, accounts] = await Promise.all([getFinancialStatements(), getChartOfAccounts()]);
  const { data: statements, source } = result;
  // UAT Phase 1B (recon D11): the feed names each head by its UUID; resolve to code · name.
  const heads = buildHeadLookup(accounts.source === "error" ? [] : accounts.data);

  return (
    <>
      <PageHeader
        title="Financial Statements"
        subtitle="Receipts &amp; Payments, Income &amp; Expenditure, Balance Sheet — cumulative, all periods."
        actions={<PrintExportButton label="Print / Save as PDF" documentTitle="Financial Statements" />}
      />

      <PrintHeader title="Financial Statements" scope="Cumulative, all periods" />

      {source === "error" && result.status === 403 ? (
        <LoadErrorState result={result} area="financial statements" backHref="/finance" />
      ) : (
        <Card title="Financial Statements · cumulative, all periods">
          <StatementsTable statements={statements} source={source} heads={heads} />
        </Card>
      )}
    </>
  );
}
