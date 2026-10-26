"use client";

import { useTranslations } from "next-intl";
import { DataTable } from "@/app/_components/ds";
import type { FieldTaskRow } from "../_data";
import { FieldTaskActions } from "./FieldTaskActions";

/**
 * GAP-FIELD-TASKS-05: the tasks list as a client table so each row can carry
 * action controls (a `render` function cannot cross the server boundary).
 * `assignee` is already the resolved display name (server-side); the id and
 * pinned `version` ride along only for the actions.
 */
export function FieldTasksTable({ rows, canAssign }: { rows: FieldTaskRow[]; canAssign: boolean }) {
  const t = useTranslations("fieldTasks");
  return (
    <DataTable<FieldTaskRow>
      columns={[
        { key: "title", label: "Title" },
        { key: "taskType", label: "Type" },
        { key: "assignee", label: "Assignee" },
        { key: "dueDate", label: "Due", cellType: "date" },
        { key: "status", label: "Status", cellType: "status" },
        {
          key: "id",
          label: t("actionsColumn"),
          render: (row) => (
            <FieldTaskActions id={row.id} status={row.status} version={row.version} canAssign={canAssign} />
          ),
        },
      ]}
      rows={rows}
      sortable
      filterable
      filterPlaceholder="Filter tasks…"
      pageSize={20}
      emptyIcon="✅"
      emptyTitle="No tasks yet"
      emptyMessage="Field task assignments will appear here."
    />
  );
}
