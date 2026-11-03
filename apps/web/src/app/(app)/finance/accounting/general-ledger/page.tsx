import { getTranslations } from "next-intl/server";
import { Alert, PageHeader, LoadErrorState } from "../../../../_components/ds";
import { getChartOfAccounts, getFinanceGLPage } from "../../../../_data/loaders";
import { buildHeadLookup } from "../../_components/headLookup";
import { GLTable } from "./GLTable";
import { PrintExportButton } from "../../_components/PrintExportButton";
import { PrintHeader } from "../../_components/PrintHeader";
import { FyFilter } from "../../_components/FyFilter";
import { GL_PAGE_SIZE, GL_TAB_TYPE, parseGlView } from "./glPage";

export default async function GeneralLedgerPage(
  props: {
    searchParams?: Promise<{ posted?: string; state?: string; fy?: string; type?: string; q?: string; page?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  // GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-02: a just-posted voucher is announced
  // here (the voucher form hands over ?posted=<voucherNo>&state=queued|posted).
  const posted = searchParams?.posted?.trim().slice(0, 64) || null;
  const queued = searchParams?.state === "queued";
  // GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-03: fiscal year / voucher type / search / page are URL state;
  // the server returns one bounded page plus totals over the whole filtered set.
  const view = parseGlView(searchParams);
  const [result, accounts] = await Promise.all([
    getFinanceGLPage({
      fy: view.fy, type: GL_TAB_TYPE[view.tab], q: view.q || undefined, page: view.page, pageSize: GL_PAGE_SIZE,
    }),
    // UAT Phase 1B (recon D13): resolve line account codes / head UUIDs to real head names.
    getChartOfAccounts(),
  ]);
  const heads = buildHeadLookup(accounts.source === "error" ? [] : accounts.data);
  const tj = await getTranslations("journalApprovals");

  return (
    <>
      <PageHeader
        title="General Ledger"
        subtitle="Double-entry ledger — every debit has a corresponding credit."
        actions={
          <>
            <FyFilter />
            <PrintExportButton label="Print / Save as PDF" documentTitle="General Ledger" />
            {/* UAT P2 (J6): a posted voucher waits here for a checker before it reaches this ledger. */}
            <a href="/finance/accounting/journal-approvals" className="btn ghost">{tj("navLink")}</a>
            <a href="/finance/accounting/vouchers/new" className="btn primary">+ New Voucher</a>
          </>
        }
      />

      <PrintHeader title="General Ledger" scope={`FY ${view.fy}, current page`} />

      {posted ? (
        <Alert variant="success" role="status">
          {queued
            ? `Voucher ${posted} accepted for processing - it may take a moment to appear. Refresh this page to check.`
            : `Voucher ${posted} posted.`}
        </Alert>
      ) : null}

      {/* A failed load is its own state (retry / permission), never an empty or "Balanced" ledger. */}
      {result.source === "error" ? (
        <LoadErrorState result={result} area="general ledger" backHref="/finance" />
      ) : (
        <GLTable entries={result.data.entries} pagination={result.data.pagination} totals={result.data.totals} ledgerTotals={result.data.ledgerTotals} view={view} heads={heads} />
      )}
    </>
  );
}
