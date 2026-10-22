import { Card, DataTable, LoadErrorState, PageHeader } from "../../../_components/ds";
import { getFieldAgentsDetailed, type FieldAgentRow } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const result = await getFieldAgentsDetailed();
  const { data, source } = result;

  if (source === "error") {
    return (
      <>
        <PageHeader title="Agents" subtitle="Agents with assigned field tasks and their task counts." back="/field" backLabel="Field Operations" />
        <Card title="Agents">
          {/* A 403 (a non-supervisor reached this URL directly) is an access decision, not an outage: Retry cannot help. */}
          <LoadErrorState result={result} area="field agents" backHref="/field" backLabel="Field Operations" />
        </Card>
      </>
    );
  }

  // GAP-FIELD-AGENTS-01: one row per agent (distinct assignee) with a task
  // count, from field-service's dedicated /agents endpoint — not one row per
  // task from the tasks endpoint.
  const rows = data.map((a) => ({ ...a, count: a.taskCount }));
  type AgentDisplay = FieldAgentRow & { count: number };

  return (
    <>
      <PageHeader title="Agents" subtitle="Agents with assigned field tasks and their task counts." back="/field" backLabel="Field Operations" />
      <Card title="Agents">
        <DataTable<AgentDisplay>
          columns={[
            { key: "agentId", label: "Agent" },
            { key: "count", label: "Assigned tasks", align: "right" },
          ]}
          rows={rows}
          rowKey={(r) => r.agentId}
          sortable
          filterable
          filterPlaceholder="Filter agents…"
          pageSize={20}
          emptyIcon="👷"
          emptyTitle="No agents yet"
          emptyMessage="Agents appear here once tasks are assigned to them."
        />
      </Card>
    </>
  );
}
