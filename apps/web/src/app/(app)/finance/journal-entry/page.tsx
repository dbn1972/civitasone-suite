import { PageShell } from "../../../_components/PageShell";
import { JournalEntryForm } from "./JournalEntryForm";

export default function Page() {
  return (
    <PageShell title="Journal Entry" description="Create balanced accounting entries with voucher context.">
      <JournalEntryForm />
    </PageShell>
  );
}
