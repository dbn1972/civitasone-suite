import { PageHeader } from "../../../_components/ds";
import { AssignmentRulesEditor } from "../../../_components/crm/AssignmentRulesEditor";

/** AS-001 admin — the ordered rule chain that routes new leads to owners. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Assignment Rules"
        subtitle="Route new leads to owners by territory, round-robin, score, product, segment, language or capacity."
        back="/crm"
        backLabel="CRM"
      />
      <AssignmentRulesEditor />
    </>
  );
}
