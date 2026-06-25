import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getActiveSessions } from "../../../_data/loaders";
import { Breadcrumb } from "../Breadcrumb";
import { SessionsTable } from "./SessionsTable";

export default async function AdminSessionsPage() {
  const { data: sessions, source } = await getActiveSessions();

  const active = sessions.filter((s) => s.status === "active").length;
  const locations = new Set(sessions.map((s) => s.ipAddress?.split(".").slice(0, 2).join(".") ?? "unknown")).size;
  const mfaVerified = sessions.filter((s) => s.mfaVerified).length;
  const suspicious = sessions.filter((s) => !s.mfaVerified && s.status === "active").length;

  return (
    <div className="wrap">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Active Sessions" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Active Sessions"
        subtitle="All active and recent user sessions for this tenant."
        actions={<button type="button" className="btn ghost">Export</button>}
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🖥️" iconBg="#f1f5f9" label="Active Sessions" value={active} />
        <StatCard icon="📍" iconBg="#eff6ff" label="Locations" value={locations} />
        <StatCard icon="🔐" iconBg="#ecfdf3" label="MFA Verified" value={mfaVerified} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Suspicious" value={suspicious} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <SessionsTable
        sessions={sessions.map((s) => ({
          id: s.id,
          userEmail: s.userEmail,
          userName: s.userName,
          ipAddress: s.ipAddress,
          userAgent: s.userAgent,
          lastActiveAt: s.lastActiveAt,
          mfaVerified: s.mfaVerified,
          status: s.status,
        }))}
      />
    </div>
  );
}
