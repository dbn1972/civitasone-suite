import { Card, PageHeader, RefreshErrorState } from "../../../_components/ds";
import { getSessionRoles, hasAnyRole, FIELD_AGENT_ROSTER_ROLES } from "@/lib/auth/roleGuard";
import { resolveUsers, userDisplayLabel } from "@/lib/directory/resolveUsers";
import { getFieldTasksDetailed, FIELD_TASKS_LIMIT } from "../_data";
import { FieldTasksTable } from "./FieldTasksTable";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getFieldTasksDetailed();

  if (source === "error") {
    return (
      <>
        <PageHeader title="Tasks" subtitle="Field task assignments from field-service." back="/field" backLabel="Field Operations" />
        <Card title="Tasks">
          <RefreshErrorState
            error={{ what: "Could not load field tasks", next: "Check your connection and try again.", actions: ["retry", "back"] }}
            source={{ area: "field tasks" }}
            backHref="/field"
          />
        </Card>
      </>
    );
  }

  // GAP-FIELD-TASKS-05: show the assignee's name, not a UUID; an unresolved id
  // degrades to a short id, never a guessed name.
  const names = await resolveUsers(data.map((t) => t.assigneeId ?? ""));
  const rows = data.map((t) => (t.assigneeId ? { ...t, assignee: userDisplayLabel(names, t.assigneeId) } : t));
  // Assign is supervisor-only server-side; the UI only offers it to them.
  const canAssign = hasAnyRole(getSessionRoles(), FIELD_AGENT_ROSTER_ROLES);

  return (
    <>
      <PageHeader title="Tasks" subtitle="Field task assignments from field-service." back="/field" backLabel="Field Operations" />
      <Card title={data.length >= FIELD_TASKS_LIMIT ? `Tasks (latest ${FIELD_TASKS_LIMIT})` : "Tasks"}>
        <FieldTasksTable rows={rows} canAssign={canAssign} />
      </Card>
    </>
  );
}
