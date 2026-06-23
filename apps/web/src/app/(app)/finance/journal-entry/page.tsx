import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, Card } from "../../../_components/ds";
import { getChartOfAccounts } from "../../../_data/loaders";
import { JournalEntryForm } from "./JournalEntryForm";

export default async function JournalEntryPage() {
  const { data: accounts, source } = await getChartOfAccounts();

  return (
    <>
      <PageHeader
        title="Journal Entry"
        subtitle="Create balanced accounting entries with voucher context."
        back="/finance/accounting/general-ledger"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />

      <Card title="Post journal entry" padding>
        <JournalEntryForm accounts={accounts} />
      </Card>
    </>
  );
}
