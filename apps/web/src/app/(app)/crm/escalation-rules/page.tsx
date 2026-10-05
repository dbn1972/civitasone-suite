import Link from "next/link";
import { PageHeader } from "../../../_components/ds";
import { EscalationRulesEditor } from "../../../_components/crm/EscalationRulesEditor";

/** AS-004 admin — escalate leads left unaccepted or unattended past a threshold. */
export default function Page() {
  return (
    <>
      {/* GAP-CRM-ESCALATION-RULES-07: titled "Lead Escalation Rules" (not the
          ambiguous "Escalation Rules") to disambiguate from the sibling
          /crm/task-escalation route, with a cross-link to it. */}
      <PageHeader
        title="Lead Escalation Rules"
        subtitle={
          <>
            Escalate leads that sit unaccepted or unattended beyond a time threshold. For overdue
            tasks, see <Link href="/crm/task-escalation">Task Escalation</Link>.
          </>
        }
        back="/crm"
        backLabel="CRM"
      />
      <EscalationRulesEditor />
    </>
  );
}
