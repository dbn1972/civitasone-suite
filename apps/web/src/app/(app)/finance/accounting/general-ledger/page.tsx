import { PageHeader, LoadErrorState } from "../../../../_components/ds";
import { getFinanceGLPage } from "../../../../_data/loaders";
import { GLTable } from "./GLTable";
import { PrintExportButton } from "../../_components/PrintExportButton";
import { PrintHeader } from "../../_components/PrintHeader";
import { FyFilter } from "../../_components/FyFilter";
import { GL_PAGE_SIZE, GL_TAB_TYPE, parseGlView } from "./glPage";

export default async function GeneralLedgerPage({
  searchParams,
}: {
  searchParams?: { posted?: string; state?: string; fy?: string; type?: string; q?: string; page?: string };
}) {
  // GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-02: a just-posted voucher is announced
  // here (the voucher form hands over ?posted=<voucherNo>&state=queued|posted).
  const posted = searchParams?.posted?.trim().slice(0, 64) || null;
  const queued = searchParams?.state === "queued";
  // GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-03: fiscal year / voucher type / search / page are URL state;
  // the server returns one bounded page plus totals over the whole filtered set.
  const view = parseGlView(searchParams);
  const result = await getFinanceGLPage({
    fy: view.fy, type: GL_TAB_TYPE[view.tab], q: view.q || undefined, page: view.page, pageSize: GL_PAGE_SIZE,
  });

  return (
    <>
      <PageHeader
        title="General Ledger"
        subtitle="Double-entry ledger — every debit has a corresponding credit."
        actions={
          <>
            <FyFilter />
            <PrintExportButton label="Print / Save as PDF" documentTitle="General Ledger" />
            <a href="/finance/accounting/vouchers/new" className="btn primary">+ New Voucher</a>
          </>
        }
      />

      <PrintHeader title="General Ledger" scope={`FY ${view.fy}, current page`} />

      {posted ? (
        <p
          role="status"
          style={{
            margin: "0 0 12px",
            padding: "8px 12px",
            borderRadius: 6,
            background: "#f0fdf4",
            color: "#15803d",
            border: "1px solid #bbf7d0",
            fontSize: "0.85rem",
          }}
        >
          {queued
            ? `Voucher ${posted} accepted for processing - it may take a moment to appear. Refresh this page to check.`
            : `Voucher ${posted} posted.`}
        </p>
      ) : null}

      {/* A failed load is its own state (retry / permission), never an empty or "Balanced" ledger. */}
      {result.source === "error" ? (
        <LoadErrorState result={result} area="general ledger" backHref="/finance" />
      ) : (
        <GLTable entries={result.data.entries} pagination={result.data.pagination} totals={result.data.totals} view={view} />
      )}
    </>
  );
}
