import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getEstabCompliance } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { ComplianceTable, type ComplianceRow } from "./ComplianceTable";

export default async function CompliancePage() {
  const { data: items, source } = await getEstabCompliance();
  const today = new Date().toISOString().split("T")[0];
  const complianceRate = items.length > 0
    ? Math.round((items.filter((c) => c.status === "complied").length / items.length) * 100)
    : 0;
  const openActions = items.filter((c) => c.status === "pending").length;
  const overdue = items.filter((c) => c.status === "overdue").length;
  const escalated = items.filter((c) => c.status === "overdue" && c.dueDate < today).length;

  const rows: ComplianceRow[] = items.map((c) => ({
    id: c.id,
    title: c.title,
    category: c.category,
    assignedTo: c.assignedTo ?? "—",
    due: formatIndianDate(c.dueDate),
    status: c.status.replace(/_/g, " "),
    statusRaw: c.status,
  }));

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Action / Decision Compliance"
        subtitle="Track closure of meeting action items & decisions."
        actions={<Link href="/estab/compliance?tab=reminders" className="btn primary" style={{ minHeight: 44 }}>Reminders</Link>}
      />
      <StatGrid>
        <StatCard icon="✅" iconBg="#ecfdf3" label="Compliance Rate" value={`${complianceRate}%`} delta="+3%" up />
        <StatCard icon="📋" iconBg="#e6f7f5" label="Open Actions" value={openActions.toLocaleString("en-IN")} />
        <StatCard icon="⏰" iconBg="#fffaeb" label="Overdue" value={overdue.toLocaleString("en-IN")} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Escalated" value={escalated.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        {items.length === 0 ? (
          <>
            <div className="card-h">
              <h3>Action items across meetings</h3>
            </div>
            <EmptyState icon="✅" title="No compliance items" message="Action items from meetings will appear here." />
          </>
        ) : (
          <ComplianceTable rows={rows} />
        )}
      </div>
    </>
  );
}
