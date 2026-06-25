"use client";

import { DataTable } from "../../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { SessionRevokeCell } from "./SessionRevokeCell";

export type UserSession = {
  id: string;
  ipAddress?: string;
  createdAt: string;
  lastActiveAt: string;
  status: string;
} & Record<string, unknown>;

/** Format an ISO timestamp as a GFR-compliant Indian date plus 24h time. */
function formatWhen(iso: string): string {
  const time = new Date(iso);
  const hhmm = isNaN(time.getTime())
    ? ""
    : ` ${time.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  return `${formatIndianDate(iso)}${hhmm}`;
}

export function UserSessionsTable({ sessions }: { sessions: UserSession[] }) {
  return (
    <DataTable<UserSession>
      columns={[
        { key: "ipAddress", label: "IP address", render: (s) => <span className="mono">{s.ipAddress ?? "—"}</span> },
        { key: "createdAt", label: "Created", render: (s) => formatWhen(s.createdAt) },
        { key: "lastActiveAt", label: "Last active", render: (s) => formatWhen(s.lastActiveAt) },
        {
          key: "status",
          label: "Status",
          render: (s) =>
            s.status === "active" ? <span className="pill good">Active</span>
              : s.status === "revoked" ? <span className="pill bad">Revoked</span>
              : <span className="pill mut">Expired</span>,
        },
        {
          key: "id",
          label: "Actions",
          sortable: false,
          render: (s) => <SessionRevokeCell sessionId={s.id} active={s.status === "active"} />,
        },
      ]}
      rows={sessions}
    />
  );
}
