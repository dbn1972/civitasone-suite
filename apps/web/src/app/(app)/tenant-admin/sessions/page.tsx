import { PrintExportButton } from "../../../_components/PrintExportButton";
import { PageHeader, StatCard, Card, RefreshErrorState } from "../../../_components/ds";
import { getActiveSessions } from "../../../_data/loaders";
import { toResourceState } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { getSessionUserId } from "@/lib/auth/roleGuard";
import { Breadcrumb } from "../Breadcrumb";
import { SessionsTable } from "./SessionsTable";
import { distinctNetworkCount } from "./sessionHelpers";

export default async function AdminSessionsPage() {
  const result = await getActiveSessions();
  const { data: sessions } = result;
  const errored = toResourceState(result).status === "error";

  // The signed-in user's id (JWT sub == identity-service ctx.actorId). Used to
  // flag "This session"-owned rows so the admin cannot casually revoke their
  // own live session from the list (GAP-TENANT-ADMIN-SESSIONS-04). The server
  // is still the authority; identity-service authorises every revoke.
  const currentUserId = getSessionUserId();

  const active = sessions.filter((s) => s.status === "active").length;
  const distinctNetworks = distinctNetworkCount(sessions.map((s) => s.ipAddress));
  const mfaVerified = sessions.filter((s) => s.mfaVerified).length;
  // GAP-TENANT-ADMIN-SESSIONS-03: this is "active sessions without MFA", not a
  // real risk score — label it honestly rather than calling it "Suspicious".
  const activeWithoutMfa = sessions.filter((s) => !s.mfaVerified && s.status === "active").length;

  return (
    <div className="page-main wrap">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Active Sessions" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Active Sessions"
        subtitle="All active and recent user sessions for this tenant."
        actions={<PrintExportButton label="Export" style={{ minHeight: 44 }} documentTitle="Active Sessions" />}
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🖥️" iconBg="#f1f5f9" label="Active Sessions" value={errored ? "—" : active} />
        <StatCard icon="📍" iconBg="#eff6ff" label="Distinct networks" value={errored ? "—" : distinctNetworks} />
        <StatCard icon="🔐" iconBg="#ecfdf3" label="MFA Verified" value={errored ? "—" : mfaVerified} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Active without MFA" value={errored ? "—" : activeWithoutMfa} />
      </div>
      {errored ? (
        <Card title="Session log">
          <RefreshErrorState error={toHumanError("load", { area: "sessions" })} backHref="/tenant-admin" />
        </Card>
      ) : (
        <SessionsTable
          currentUserId={currentUserId}
          sessions={sessions.map((s) => ({
            id: s.id,
            userId: s.userId,
            userEmail: s.userEmail,
            userName: s.userName,
            ipAddress: s.ipAddress,
            userAgent: s.userAgent,
            lastActiveAt: s.lastActiveAt,
            mfaVerified: s.mfaVerified,
            status: s.status,
          }))}
        />
      )}
    </div>
  );
}
