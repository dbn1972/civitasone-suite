import { Card, DataTable, PageHeader, RefreshErrorState } from "../../../_components/ds";
import { getFieldTasksDetailed, type FieldTaskRow, FIELD_TASKS_LIMIT } from "../_data";

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

  return (
    <>
      <PageHeader title="Tasks" subtitle="Field task assignments from field-service." back="/field" backLabel="Field Operations" />
      <Card title={data.length >= FIELD_TASKS_LIMIT ? `Tasks (latest ${FIELD_TASKS_LIMIT})` : "Tasks"}>
        <DataTable<FieldTaskRow>
          columns={[
            { key: "title", label: "Title" },
            { key: "taskType", label: "Type" },
            { key: "assignee", label: "Assignee" },
            { key: "dueDate", label: "Due", cellType: "date" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={data}
          sortable
          filterable
          filterPlaceholder="Filter tasks…"
          pageSize={20}
          emptyIcon="✅"
          emptyTitle="No tasks yet"
          emptyMessage="Field task assignments will appear here."
        />
      </Card>
    </>
  );
}
