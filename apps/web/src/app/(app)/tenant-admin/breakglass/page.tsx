import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PrintExportButton } from "../../../_components/PrintExportButton";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getBreakglassLog } from "../../../_data/loaders";
import { Breadcrumb } from "../Breadcrumb";
import { BreakglassTable } from "./BreakglassTable";

export default async function BreakglassPage() {
  const { data: events, source } = await getBreakglassLog();

  const total = events.length;
  const activeNow = events.filter((e) => e.status === "active").length;
  const ended = events.filter((e) => e.status === "ended").length;
  const thisMonth = events.filter((e) => {
    const d = new Date(e.startedAt);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Break-Glass Access" }]} />
      {activeNow > 0 && (
        <div className="banner" role="status" style={{ background: "#fef3f2", border: "1px solid #fca5a5", color: "#991b1b", borderRadius: 12, padding: "13px 16px", marginBottom: 18, fontSize: 13 }}>
          🚨 <b>{activeNow} active break-glass session{activeNow > 1 ? "s" : ""} in progress.</b> SRE has been alerted.
        </div>
      )}
      <PageHeader
        back="/tenant-admin"
        title="Break-Glass Access Log"
        subtitle="Emergency support access events — all instances require justification and are fully audited."
        actions={
          <>
            <PrintExportButton label="Export log" style={{ minHeight: 44 }} documentTitle="Break-Glass Access Log" />
            {source === "error" && <DataSourceBadge source={source} />}
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🚨" iconBg="#fef3f2" label="Active Now" value={activeNow} />
        <StatCard icon="📅" iconBg="#fffaeb" label="This Month" value={thisMonth} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Ended" value={ended} />
        <StatCard icon="🔑" iconBg="#f1f5f9" label="Total Events" value={total} />
      </div>
      <BreakglassTable
        events={events.map((e) => ({
          id: e.id,
          actor: e.actor,
          actorEmail: e.actorEmail,
          reason: e.reason,
          startedAt: e.startedAt,
          endedAt: e.endedAt,
          status: e.status,
        }))}
      />
    </main>
  );
}
