import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, EmptyState } from "../../../_components/ds";
import { getGrievances } from "../_data";
import type { GrievanceSummary } from "../_data";
import { GrievancesTable, type GrievanceRow } from "./GrievancesTable";

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
            <GrievancesTable rows={rows} />
          </>
        )}
      </div>
    </>
  );
}
