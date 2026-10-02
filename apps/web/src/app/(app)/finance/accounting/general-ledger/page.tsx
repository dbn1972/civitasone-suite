import { PageHeader, LoadErrorState } from "../../../../_components/ds";
import { getFinanceGLEntries } from "../../../../_data/loaders";
import { GLTable } from "./GLTable";
import { PrintExportButton } from "../../_components/PrintExportButton";
import { PrintHeader } from "../../_components/PrintHeader";

export default async function GeneralLedgerPage({
  searchParams,
}: {
  searchParams?: { posted?: string; state?: string };
}) {
  // GAP-FINANCE-ACCOUNTING-VOUCHERS-NEW-02: a just-posted voucher is announced
  // here (the voucher form hands over ?posted=<voucherNo>&state=queued|posted).
  const posted = searchParams?.posted?.trim().slice(0, 64) || null;
  const queued = searchParams?.state === "queued";
  const result = await getFinanceGLEntries();
  const { data: entries, source } = result;

  return (
    <>
      <PageHeader
        title="General Ledger"
        subtitle="Double-entry ledger — every debit has a corresponding credit."
        actions={
          <>
            <PrintExportButton label="Print / Save as PDF" documentTitle="General Ledger" />
            <a href="/finance/accounting/vouchers/new" className="btn primary">+ New Voucher</a>
          </>
        }
      />

      <PrintHeader title="General Ledger" scope="All loaded vouchers" />

      {/* UX-012: the data-source badge now lives inside GLTable, driven by
          the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
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

      {/* A 403 is a permission decision a retry cannot fix. */}
      {source === "error" && result.status === 403 ? (
        <LoadErrorState result={result} area="general ledger" backHref="/finance" />
      ) : (
        <GLTable entries={entries} source={source} />
      )}
    </>
  );
}
