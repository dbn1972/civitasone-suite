"use client";

import { DataTable, StatusPill } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { MfaUserStatus } from "@/app/_data/loaders";

export function MfaTable({ users, source }: { users: MfaUserStatus[]; source: "api" | "error" }) {
  const { data } = useSeededResource("admin.mfa.users", users, source, (d) => d.length === 0);

  return (
    <DataTable<MfaUserStatus & Record<string, unknown>>
      columns={[
        { key: "name", label: "Name" },
        { key: "email", label: "Email" },
        { key: "department", label: "Department" },
        { key: "mfaStatus", label: "MFA Status", render: (row) => <StatusPill status={row.mfaStatus as string} /> },
        { key: "enrolledAt", label: "Enrolled On", render: (row) => row.enrolledAt ? new Date(row.enrolledAt as string).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—" },
      ]}
      rows={data as (MfaUserStatus & Record<string, unknown>)[]}
      sortable
      filterable
      filterPlaceholder="Search users..."
      pageSize={15}
      exportable
      exportFilename="mfa-status"
    />
  );
}
