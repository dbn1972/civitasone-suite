import { PageHeader } from "../../../_components/ds";
import { DedupRulesEditor } from "../../../_components/crm/DedupRulesEditor";

/** DQ-001 admin — configurable duplicate-matching rules. Role-gated via layout. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Duplicate Matching Rules"
        subtitle="Configure which fields identify a duplicate contact, lead or account, and how strictly they are compared."
        back="/crm/data-quality"
        backLabel="Data Quality"
      />
      <DedupRulesEditor />
    </>
  );
}
