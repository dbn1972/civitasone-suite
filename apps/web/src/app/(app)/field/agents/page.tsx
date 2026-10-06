import { Card, DataTable, PageHeader, RefreshErrorState } from "../../../_components/ds";
import { getFieldAgentsDetailed, type FieldAgentRow } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getFieldAgentsDetailed();

  if (source === "error") {
    return (
      <>
        <PageHeader title="Agents" subtitle="Agents with assigned field tasks and their task counts." back="/field" backLabel="Field Operations" />
        <Card title="Agents">
          <RefreshErrorState
            error={{ what: "Could not load field agents", next: "Check your connection and try again.", actions: ["retry", "back"] }}
            source={{ area: "field agents" }}
            backHref="/field"
          />
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
