"use client";

import { DataTable, StatusPill } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { OfficerName } from "../../files/[id]/OfficerName";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
        {
          key: "assignedTo",
          label: "Owner",
          // The stored owner is an officer id; resolve it to a name, never print the raw id.
          render: (r) => (UUID_RE.test(r.assignedTo) ? <OfficerName id={r.assignedTo} /> : <>{r.assignedTo || "—"}</>),
        },
        { key: "dueDate", label: "Due", render: (r) => <>{r.dueDate ? formatIndianDate(r.dueDate) : "—"}</> },
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
            // GAP-ESTAB-MEETINGS-DETAIL-06: absence is not a rejection — use a
            // neutral/muted "Absent" pill, not a red "rejected" one.
            <StatusPill status={r.present ? "present" : "absent"} label={r.present ? "Present" : "Absent"} variant={r.present ? "good" : "mut"} />
          ),
        },
      ]}
      rows={keyed}
      sortable
    />
  );
}
