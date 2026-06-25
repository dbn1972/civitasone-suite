"use client";

import { DataTable, StatusPill } from "../../../../_components/ds";

type ActionPointRow = {
  id: string;
  description: string;
  assignedTo: string;
  dueDate?: string | null;
  status: string;
};

type AttendeeRow = {
  name: string;
  designation?: string | null;
  present: boolean;
};

export function ActionPointsTable({ rows }: { rows: ActionPointRow[] }) {
  return (
    <DataTable<ActionPointRow>
      columns={[
        { key: "description", label: "Action" },
        { key: "assignedTo", label: "Owner" },
        { key: "dueDate", label: "Due", render: (r) => <>{r.dueDate ?? "—"}</> },
        {
          key: "status",
          label: "Status",
          render: (r) => <StatusPill status={r.status} label={r.status.replace(/_/g, " ")} />,
        },
      ]}
      rows={rows}
      sortable
    />
  );
}

export function AttendeesTable({ rows }: { rows: AttendeeRow[] }) {
  const keyed = rows.map((r, i) => ({ ...r, id: String(i) }));
  return (
    <DataTable<AttendeeRow & { id: string }>
      columns={[
        { key: "name", label: "Name" },
        { key: "designation", label: "Designation", render: (r) => <>{r.designation ?? "—"}</> },
        {
          key: "present",
          label: "Present",
          render: (r) => (
            <StatusPill status={r.present ? "active" : "rejected"} label={r.present ? "Yes" : "No"} />
          ),
        },
      ]}
      rows={keyed}
      sortable
    />
  );
}
