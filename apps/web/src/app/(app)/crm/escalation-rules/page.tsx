import { PageHeader } from "../../../_components/ds";
import { EscalationRulesEditor } from "../../../_components/crm/EscalationRulesEditor";

/** AS-004 admin — escalate leads left unaccepted or unattended past a threshold. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Escalation Rules"
        subtitle="Escalate leads that sit unaccepted or unattended beyond a time threshold."
        back="/crm"
        backLabel="CRM"
      />
      <EscalationRulesEditor />
    </>
  );
}
