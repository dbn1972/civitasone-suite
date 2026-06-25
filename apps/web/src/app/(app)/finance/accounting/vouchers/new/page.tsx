import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { PageHeader, Card } from "../../../../../_components/ds";
import { getChartOfAccounts } from "../../../../../_data/loaders";
import { JournalEntryForm } from "../../../journal-entry/JournalEntryForm";

/**
 * New Journal Voucher — consolidated onto the single balanced-guarded
 * JournalEntryForm (account dropdowns + maker-checker confirm). The previous
 * free-text, unbalanced-allowed form has been retired so both entry points
 * post identical, validated, balanced journals.
 */
export default async function NewVoucherPage() {
  const { data: accounts, source } = await getChartOfAccounts();

  return (
    <>
      <PageHeader
        title="New Journal Voucher"
        subtitle="Create a balanced double-entry voucher — debit must equal credit."
        back="/finance/accounting/general-ledger"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />

      <Card title="Voucher entry" padding>
        <JournalEntryForm accounts={accounts} redirectTo="/finance/accounting/general-ledger" />
      </Card>
    </>
  );
}
