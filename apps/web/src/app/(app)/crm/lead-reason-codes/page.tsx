import { PageHeader } from "../../../_components/ds";
import { ReasonCodesEditor } from "../../../_components/crm/ReasonCodesEditor";

/** LQ-004 admin — controlled reason codes for lead status changes. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Lead Stage Reasons"
        subtitle="Manage the reason codes captured when a lead changes status (disqualify, re-open, …)."
        back="/crm"
        backLabel="CRM"
      />
      <ReasonCodesEditor />
    </>
  );
}
