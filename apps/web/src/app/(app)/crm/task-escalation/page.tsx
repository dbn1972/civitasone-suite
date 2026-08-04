import { PageHeader } from "../../../_components/ds";
import { TaskEscalationEditor } from "../../../_components/crm/TaskEscalationEditor";
import { OverdueTaskAlerts } from "../../../_components/crm/OverdueTaskAlerts";

/** AC-005 — task-escalation configuration + overdue-task alerts. Role-gated via CRM layout. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Task Escalation"
        subtitle="Escalate overdue tasks to a manager, and watch what is already overdue."
        back="/crm"
        backLabel="CRM"
      />
      <div style={{ display: "grid", gap: 18 }}>
        <OverdueTaskAlerts />
        <TaskEscalationEditor />
      </div>
    </>
  );
}
