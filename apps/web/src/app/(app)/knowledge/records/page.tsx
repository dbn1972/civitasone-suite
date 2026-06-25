import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getKnowledgeRecords } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, StatusPill } from "../../../_components/ds";

export default async function KnowledgeRecordsPage() {
  const { data: records, source } = await getKnowledgeRecords();

  const now = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(now.getDate() + 30);

  const total = records.length;
  const active = records.filter((r) => r.status === "active").length;
  const dueForDisposal = records.filter((r) => {
    if (!r.disposalDueDate) return false;
    const dueDate = new Date(r.disposalDueDate);
    return dueDate <= thirtyDaysFromNow && r.status === "active";
  }).length;
  const permanent = records.filter((r) => r.retentionPeriod?.toLowerCase().includes("perm")).length;

  function recordStatusPill(s: string) {
    if (s === "active") return "active";
    if (s === "disposed") return "rejected";
    if (s === "transferred") return "pending";
    return "mut";
  }

  function recordStatusLabel(s: string) {
    if (s === "active") return "Active";
    if (s === "disposed") return "Weeding due";
    if (s === "transferred") return "Review";
    if (s === "inactive") return "Inactive";
    return s;
  }

  return (
    <div className="wrap">
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Records Management"
        subtitle="File retention/weeding rules per record category (GFR/manual)."
        actions={
          <>
            <button className="btn ghost">Policy</button>
            <Link href="/knowledge/documents/new?category=Retention%20Schedule" className="btn primary">+ Schedule</Link>
          </>
        }
      />

      <StatGrid>
        <StatCard icon="🗃️" iconBg="#fef9e7" label="Record Series" value={total.toLocaleString("en-IN")} />
        <StatCard icon="📅" iconBg="#eff6ff" label="Due Review" value={dueForDisposal.toLocaleString("en-IN")} />
        <StatCard icon="🗑️" iconBg="#fef3f2" label="Weeding Due" value={records.filter((r) => r.status === "disposed").length.toLocaleString("en-IN")} />
        <StatCard icon="🔒" iconBg="#ecfdf3" label="Permanent" value={permanent.toLocaleString("en-IN")} />
      </StatGrid>

      <div className="card" style={{ marginTop: "18px" }}>
        <div className="card-h">
          <h3>Retention schedules</h3>
          <div className="seg"><span className="on">All</span><span>Due</span></div>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Record No</th>
              <th>Title</th>
              <th>Type</th>
              <th>Department</th>
              <th>Retention Period</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr><td colSpan={6}><div className="empty-state"><div className="ic">🗃️</div><h4>No records found</h4><p>No retention schedules configured yet.</p></div></td></tr>
            ) : records.map((rec) => (
              <tr key={rec.id}>
                <td><span className="mono">{rec.recordNo}</span></td>
                <td>{rec.title}</td>
                <td>{rec.type}</td>
                <td>{rec.department ?? "—"}</td>
                <td>{rec.retentionPeriod ?? "—"}</td>
                <td>
                  <StatusPill status={recordStatusPill(rec.status)} label={recordStatusLabel(rec.status)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
