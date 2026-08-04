import { PageHeader } from "../../../_components/ds";
import { AgentWorkloadEditor } from "../../../_components/crm/AgentWorkloadEditor";

/** AS-003 admin — per-agent lead capacity and availability. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Agent Workload"
        subtitle="Set each agent's lead capacity and availability for auto-assignment."
        back="/crm"
        backLabel="CRM"
      />
      <AgentWorkloadEditor />
    </>
  );
}
