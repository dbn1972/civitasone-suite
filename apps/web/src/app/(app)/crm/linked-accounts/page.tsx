import { PageHeader } from "../../../_components/ds";
import { LinkedAccountsPanel } from "../../../_components/crm/LinkedAccountsPanel";

/** AC-004 — connect email/calendar providers (framework; live sync deferred). */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Connected Accounts"
        subtitle="Connect email and calendar providers so their activity can sync into CRM."
        back="/crm"
        backLabel="CRM"
      />
      <LinkedAccountsPanel />
    </>
  );
}
