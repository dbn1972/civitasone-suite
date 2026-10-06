import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getKnowledgeRecords } from "../../../_data/loaders";
import { EmptyState, PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";
import { RecordsClient } from "./RecordsClient";
import { recordStatusLabel, recordStatusPill } from "../_data/statusLabels";
import { isReviewDue, isWeedingDue, dueKind, type DueKind } from "../_data/recordDue";

export type RecordRow = {
  id: string;
  recordNo: string;
  title: string;
  type: string;
  department: string;
  retentionPeriod: string;
  disposalDue: string;
  statusLabel: string;
  statusPill: string;
  rawStatus: string;
  dueKind: DueKind;
};

export default async function KnowledgeRecordsPage() {
  const { data: records, source } = await getKnowledgeRecords();
  const errored = source === "error";

  const now = new Date();

  const total = records.length;
  const reviewDueCount = errored ? 0 : records.filter((r) => isReviewDue(r, now)).length;
  const weedingDueCount = errored ? 0 : records.filter((r) => isWeedingDue(r, now)).length;
  const permanent = errored ? 0 : records.filter((r) => r.retentionPeriod?.toLowerCase().includes("perm")).length;

  const rows: RecordRow[] = records.map((rec) => ({
    id: rec.id,
    recordNo: rec.recordNo,
    title: rec.title,
    type: rec.type,
    department: rec.department ?? "—",
    retentionPeriod: rec.retentionPeriod ?? "—",
    disposalDue: rec.disposalDueDate ? formatIndianDate(rec.disposalDueDate) : "—",
    statusLabel: recordStatusLabel(rec.status),
    statusPill: recordStatusPill(rec.status),
    rawStatus: rec.status,
    dueKind: dueKind(rec, now),
  }));

  return (
    <div className="wrap">
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Records Management"
        subtitle="File retention/weeding rules per record category (GFR/manual)."
        actions={
          <>
            <Link href="/knowledge/policies" className="btn ghost" style={{ minHeight: 44 }}>Policy</Link>
            <Link href="/knowledge/documents/new?category=Retention%20Schedule" className="btn primary" style={{ minHeight: 44 }}>+ Schedule</Link>
          </>
        }
      />

      <StatGrid>
        <StatCard icon="🗃️" iconBg="#fef9e7" label="Record Series" value={errored ? "—" : total.toLocaleString("en-IN")} />
        <StatCard icon="📅" iconBg="#eff6ff" label="Due for review (30d)" value={errored ? "—" : reviewDueCount.toLocaleString("en-IN")} />
        <StatCard icon="🗑️" iconBg="#fef3f2" label="Overdue for weeding" value={errored ? "—" : weedingDueCount.toLocaleString("en-IN")} />
        <StatCard icon="🔒" iconBg="#ecfdf3" label="Permanent" value={errored ? "—" : permanent.toLocaleString("en-IN")} />
      </StatGrid>

      <div className="card" style={{ marginTop: "18px" }}>
        <div className="card-h">
          <h3>Retention schedules</h3>
        </div>
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "retention schedules" })} />
        ) : records.length === 0 ? (
          <EmptyState icon="🗃️" title="No records found" message="No retention schedules configured yet." />
        ) : (
          <RecordsClient rows={rows} />
        )}
      </div>
    </div>
  );
}
