import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import {
  EmptyState,
  PageHeader,
  StatCard,
  StatGrid,
  StatusPill,
} from "../../../_components/ds";
import { getCrmGrievances } from "../../../_data/loaders";
import Link from "next/link";

type SP = { status?: string; priority?: string; search?: string };

const PRIORITY_CHIP: Record<string, string> = {
  urgent: "var(--bad)",
  high:   "var(--warn)",
  normal: "var(--ink2)",
  low:    "var(--ink2)",
};

function priorityLabel(p: string) {
  return p.charAt(0).toUpperCase() + p.slice(1);
}

export default async function GrievancesPage({ searchParams }: { searchParams?: SP }) {
  const { data: rows, source } = await getCrmGrievances();

  const open       = rows.filter((r) => r.status === "open").length;
  const escalated  = rows.filter((r) => r.status === "escalated").length;
  const resolved   = rows.filter((r) => r.status === "resolved" || r.status === "closed").length;

  return (
    <>
      <PageHeader
        title="Grievances"
        subtitle="Citizen complaints and grievance register — log, assign, escalate, and resolve."
        back="/crm"
        actions={
          <Link href="/crm/grievances/new" className="btn primary">
            + New Grievance
          </Link>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}

      <StatGrid>
        <StatCard icon="🔴" iconBg="color-mix(in srgb, var(--bad) 12%, transparent)" label="Open" value={open.toLocaleString("en-IN")} />
        <StatCard icon="⚠️" iconBg="color-mix(in srgb, var(--warn) 15%, transparent)" label="Escalated" value={escalated.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="color-mix(in srgb, var(--good) 12%, transparent)" label="Resolved / Closed" value={resolved.toLocaleString("en-IN")} />
        <StatCard icon="📋" iconBg="color-mix(in srgb, var(--ink2) 10%, transparent)" label="Total" value={rows.length.toLocaleString("en-IN")} />
      </StatGrid>

      {rows.length === 0 ? (
        <EmptyState
          icon="📭"
          title="No grievances yet"
          message="Use the button above to log the first citizen grievance."
        />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">Ref No.</th>
                <th scope="col">Citizen</th>
                <th scope="col">Category</th>
                <th scope="col">Subject</th>
                <th scope="col">Priority</th>
                <th scope="col">Status</th>
                <th scope="col">Logged</th>
                <th scope="col" aria-label="Actions" />
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
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--bg)",
                        background: PRIORITY_CHIP[row.status ?? "normal"] ?? "var(--ink2)",
                      }}
                    >
                      {row.status ? priorityLabel(row.status) : "Normal"}
                    </span>
                  </td>
                  <td>
                    <StatusPill status={row.status ?? "open"} />
                  </td>
                  <td style={{ color: "var(--ink2)", fontSize: 13 }}>—</td>
                  <td>
                    <Link href={`/crm/grievances/${row.id}`} className="btn" style={{ fontSize: 13 }}>
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
