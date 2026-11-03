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
  // `id` (the agent id) gives DataTable its default stable row key. This used to
  // pass `rowKey={(r) => r.agentId}`, but a Server Component cannot hand a
  // function prop to the client DataTable: React threw "Functions cannot be
  // passed directly to Client Components" and /field/agents crashed on every
  // load (UAT L1, Phase 1B).
  const rows = data.map((a) => ({ ...a, id: a.agentId, count: a.taskCount }));
  type AgentDisplay = FieldAgentRow & { id: string; count: number };

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
