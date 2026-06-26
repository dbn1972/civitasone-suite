import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, DataTable, EmptyState, StatusPill } from "../../../_components/ds";
import { getGrievances } from "../_data";
import type { GrievanceSummary } from "../_data";

const TODAY = new Date().toISOString().slice(0, 10);

/** CPGRAMS 30-day lifecycle: returns whole days remaining (negative = overdue). */
function daysRemaining(dueDate: string | null | undefined, today: string): number | null {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  const t = new Date(today);
  if (isNaN(d.getTime()) || isNaN(t.getTime())) return null;
  return Math.round((d.getTime() - t.getTime()) / (1000 * 60 * 60 * 24));
}

const CLOSED_STATUSES = new Set(["resolved", "closed", "disposed"]);

interface GrievanceRow extends Record<string, unknown> {
  id: string;
  grievanceNo: string;
  subject: string;
  complainantName: string;
  category: string;
  status: string;
  daysLeft: number | null;
}

/** Statutory clock cell — colour AND text (never colour alone, WCAG 1.4.1). */
function clockCell(row: GrievanceRow) {
  if (CLOSED_STATUSES.has(row.status.toLowerCase())) {
    return <span style={{ color: "var(--muted)" }}>Closed</span>;
  }
  const n = row.daysLeft;
  if (n === null) return <span style={{ color: "var(--muted)" }}>—</span>;
  if (n < 0) {
    return (
      <span style={{ color: "#b42318", fontWeight: 600 }}>
        {`Overdue by ${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"}`}
      </span>
    );
  }
  if (n === 0) return <span style={{ color: "#b42318", fontWeight: 600 }}>Due today</span>;
  const color = n <= 7 ? "#b54708" : "#067647";
  return (
    <span style={{ color, fontWeight: n <= 7 ? 600 : 400 }}>
      {`${n} day${n === 1 ? "" : "s"} left`}
    </span>
  );
}

const COLUMNS = [
  { key: "grievanceNo" as const, label: "Grievance No" },
  { key: "subject" as const, label: "Subject" },
  { key: "complainantName" as const, label: "Complainant" },
  { key: "category" as const, label: "Category" },
  { key: "status" as const, label: "Status", cellType: "status" as const },
  { key: "daysLeft" as const, label: "Days Left", render: clockCell },
];

export default async function GrievancesPage() {
  const { data: grievances, source } = await getGrievances();

  const total = grievances.length;
  const pending = grievances.filter(
    (g) => g.status === "pending" || g.status === "registered" || g.status === "under_review" || g.status === "assigned",
  ).length;
  const escalated = grievances.filter((g) => g.status === "escalated").length;
  const resolved = grievances.filter((g) => CLOSED_STATUSES.has(g.status.toLowerCase())).length;

  const rows: GrievanceRow[] = grievances.map((g: GrievanceSummary) => ({
    id: g.id,
    grievanceNo: g.grievanceNo,
    subject: g.subject,
    complainantName: g.complainantName,
    category: g.category.replace(/_/g, " "),
    status: g.status,
    daysLeft: daysRemaining(g.dueDate, TODAY),
  }));

  return (
    <>
      <PageHeader
        title="Grievances"
        subtitle="CPGRAMS-style grievance register with 30-day lifecycle."
        actions={
          <Link href="/citizen/grievances/new" className="btn primary">
            + Register Grievance
          </Link>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#eff6ff" label="Total" value={total.toLocaleString("en-IN")} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={pending.toLocaleString("en-IN")} />
        <StatCard icon="🔺" iconBg="#fef3f2" label="Escalated" value={escalated.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Resolved" value={resolved.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        {grievances.length === 0 ? (
          <>
            <div className="card-h">
              <h3>Grievance Register</h3>
            </div>
            <EmptyState
              icon="📋"
              title="No grievances filed"
              message="Grievances filed under the CPGRAMS-style system will appear here."
            />
          </>
        ) : (
          <>
            <div className="card-h">
              <h3>Grievance Register</h3>
            </div>
            <DataTable
              columns={COLUMNS}
              rows={rows}
              sortable
              filterable
              pageSize={15}
              rowLinkKey="id"
              rowLinkPrefix="/citizen/grievances/"
            />
          </>
        )}
      </div>
    </>
  );
}
