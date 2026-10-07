import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PrintExportButton } from "../../../_components/PrintExportButton";
import { PageHeader, StatCard, RefreshErrorState } from "../../../_components/ds";
import { getBreakglassLog } from "../../../_data/loaders";
import { toResourceState } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { Breadcrumb } from "../Breadcrumb";
import { BreakglassTable } from "./BreakglassTable";

export default async function BreakglassPage() {
  const result = await getBreakglassLog();
  const { data: events, source } = result;
  // GAP-TENANT-ADMIN-BREAKGLASS-02 (FAILMASK): on a fetch failure the loader
  // returns [], which would make activeNow=0 and silently hide a live
  // emergency session. Treat an errored load as "cannot determine" and show a
  // prominent alert instead of a reassuring zero.
  const errored = toResourceState(result).status === "error";

  const total = events.length;
  const activeNow = events.filter((e) => e.status === "active").length;
  const ended = events.filter((e) => e.status === "ended").length;
  const thisMonth = events.filter((e) => {
    const d = new Date(e.startedAt);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;

  return (
    <div className="page-main wrap">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Break-Glass Access" }]} />
      {errored ? (
        <div className="banner" role="alert" style={{ background: "#fef3f2", border: "1px solid #fca5a5", color: "#991b1b", borderRadius: 12, padding: "13px 16px", marginBottom: 18, fontSize: 13 }}>
          🚨 <b>Cannot determine active break-glass sessions.</b> The access log could not be loaded, so a live emergency session may be in progress but hidden. Refresh to try again.
        </div>
      ) : activeNow > 0 ? (
        // GAP-TENANT-ADMIN-BREAKGLASS-01 (FABRICATED): state only facts; the
        // page cannot verify any alert was sent, so no "SRE has been alerted".
        <div className="banner" role="status" style={{ background: "#fef3f2", border: "1px solid #fca5a5", color: "#991b1b", borderRadius: 12, padding: "13px 16px", marginBottom: 18, fontSize: 13 }}>
          🚨 <b>{activeNow} active break-glass session{activeNow > 1 ? "s" : ""} in progress.</b> Review and close each one when it is no longer needed.
        </div>
      ) : null}
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
        <StatCard icon="🚨" iconBg="#fef3f2" label="Active Now" value={errored ? "—" : activeNow} />
        <StatCard icon="📅" iconBg="#fffaeb" label="This Month" value={errored ? "—" : thisMonth} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Ended" value={errored ? "—" : ended} />
        <StatCard icon="🔑" iconBg="#f1f5f9" label="Total Events" value={errored ? "—" : total} />
      </div>
      {errored ? (
        <div className="card">
          <div className="card-h"><h3 id="bg-table-heading">Break-glass log</h3></div>
          <div style={{ padding: 16 }}>
            <RefreshErrorState error={toHumanError("load", { area: "break-glass access log" })} backHref="/tenant-admin" />
          </div>
        </div>
      ) : (
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
      )}
    </div>
  );
}
