import { PageHeader } from "../../../_components/ds";
import { LeadScoreRulesEditor } from "../../../_components/crm/LeadScoreRulesEditor";

/** LQ-002 admin — weighted lead-scoring rules. Role-gated via this route's own layout.tsx (admin-only), not just the broad CRM layout. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Lead Scoring"
        subtitle="Configure the weighted rules that drive automatic lead scores."
        back="/crm"
        backLabel="CRM"
      />
      <LeadScoreRulesEditor />
    </>
  );
}
