import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import {
  EmptyState,
  PageHeader,
  StatCard,
  StatGrid,
  StatusPill,
} from "../../../_components/ds";
import { getCrmServiceRequests } from "../../../_data/loaders";
import Link from "next/link";

export default async function ServiceRequestsPage() {
  const { data: rows, source } = await getCrmServiceRequests();

  const open       = rows.filter((r) => r.status === "open" || r.status === "in_progress").length;
  const pending    = rows.filter((r) => r.status === "pending").length;
  const closed     = rows.filter((r) => r.status === "closed" || r.status === "resolved").length;

  return (
    <>
      <PageHeader
        title="Service Requests"
        subtitle="Citizen service requests — track from intake to closure."
        back="/crm"
        actions={
          <Link href="/crm/grievances/new" className="btn">
            + New Request
          </Link>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}

      <StatGrid>
        <StatCard icon="📥" iconBg="color-mix(in srgb, var(--ink2) 10%, transparent)" label="Open / In Progress" value={open.toLocaleString("en-IN")} />
        <StatCard icon="⏳" iconBg="color-mix(in srgb, var(--warn) 15%, transparent)" label="Pending" value={pending.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="color-mix(in srgb, var(--good) 12%, transparent)" label="Closed / Resolved" value={closed.toLocaleString("en-IN")} />
        <StatCard icon="📋" iconBg="color-mix(in srgb, var(--ink2) 10%, transparent)" label="Total" value={rows.length.toLocaleString("en-IN")} />
      </StatGrid>

      {rows.length === 0 ? (
        <EmptyState
          icon="📭"
          title="No service requests yet"
          message="Service requests submitted by citizens will appear here."
        />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">Ref No.</th>
                <th scope="col">Citizen</th>
                <th scope="col">Service Type</th>
                <th scope="col">Subject</th>
                <th scope="col">Status</th>
                <th scope="col">Logged</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <code style={{ fontSize: 12, color: "var(--ink2)" }}>
                      {row.meta ?? "—"}
                    </code>
                  </td>
                  <td>{row.label}</td>
                  <td>{row.sublabel ?? "—"}</td>
                  <td style={{ maxWidth: 280 }}>{row.label}</td>
                  <td>
                    <StatusPill status={row.status ?? "open"} />
                  </td>
                  <td style={{ color: "var(--ink2)", fontSize: 13 }}>—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
