import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getKnowledgeRecords } from "../../../_data/loaders";
import { EmptyState, PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { RecordsClient } from "./RecordsClient";

export default async function KnowledgeRecordsPage() {
  const { data: records, source } = await getKnowledgeRecords();

  const now = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(now.getDate() + 30);

  const total = records.length;
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

  type RecordRow = {
    id: string;
    recordNo: string;
    title: string;
    type: string;
    department: string;
    retentionPeriod: string;
    statusLabel: string;
    statusPill: string;
    rawStatus: string;
  };

  const rows: RecordRow[] = records.map((rec) => ({
    id: rec.id,
    recordNo: rec.recordNo,
    title: rec.title,
    type: rec.type,
    department: rec.department ?? "—",
    retentionPeriod: rec.retentionPeriod ?? "—",
    statusLabel: recordStatusLabel(rec.status),
    statusPill: recordStatusPill(rec.status),
    rawStatus: rec.status,
  }));

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
        </div>
        {records.length === 0 ? (
          <EmptyState icon="🗃️" title="No records found" message="No retention schedules configured yet." />
        ) : (
          <RecordsClient rows={rows} />
        )}
      </div>
    </div>
  );
}
