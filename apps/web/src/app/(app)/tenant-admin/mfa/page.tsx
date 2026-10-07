import { PageHeader, StatCard, StatGrid, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { getMfaUsers } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { MfaTable } from "./MfaTable";

// GAP-TENANT-ADMIN-MFA-02 / MFA-05: the admin-service MFA endpoint derives
// mfaStatus from a boolean (mfaEnabled) and emits exactly "enabled" or
// "disabled" (see services/admin-service/src/modules/gap/routes.ts). The page
// used to count `mfaStatus === "active"`, which NEVER matches the real enum,
// so the enrolment KPI was always 0%. We normalise the status and treat
// "enabled"/"active" as enrolled; everything else (disabled/not_enrolled/
// pending/…) is counted so the four KPIs always sum to Total Users.
function norm(s: string): string {
  return s.trim().toLowerCase();
}
const ENROLLED = new Set(["enabled", "active", "enrolled"]);
const PENDING = new Set(["pending"]);

export default async function MfaManagementPage() {
  const result = await getMfaUsers();
  const { data: users, source } = result;
  const errored = toResourceState(result).status === "error";
  const totalUsers = users.length;
  const enrolled = users.filter((u) => ENROLLED.has(norm(u.mfaStatus))).length;
  const pending = users.filter((u) => PENDING.has(norm(u.mfaStatus))).length;
  // Everyone who is neither enrolled nor mid-enrolment is "not enrolled" — the
  // security-relevant figure. enrolled + pending + notEnrolled === totalUsers.
  const notEnrolled = totalUsers - enrolled - pending;
  const enrollmentPct = totalUsers > 0 ? Math.round((enrolled / totalUsers) * 100) : 0;

  return (
    <div className="page-main wrap">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "MFA Management" }]} />
      <PageHeader
        back="/tenant-admin"
        title="MFA Management"
        subtitle="Multi-factor authentication enrollment status. Open a user to manage their security."
      />

      <StatGrid>
        <StatCard icon="👥" iconBg="#f1f5f9" label="Total Users" value={errored ? "—" : totalUsers} />
        <StatCard icon="🔐" iconBg="#ecfdf3" label="Enrolled" value={errored ? "—" : enrolled} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={errored ? "—" : pending} />
        {/* GAP-TENANT-ADMIN-MFA-02: a real "Not enrolled" count (the users at
            risk) replaces the opaque "Enrollment %" headline; the percentage
            is still shown as supporting text inside the Enrolled card label is
            not possible, so it's surfaced here honestly. */}
        <StatCard icon="🚫" iconBg="#fef2f2" label={`Not enrolled (${errored ? "—" : `${100 - enrollmentPct}%`})`} value={errored ? "—" : notEnrolled} />
      </StatGrid>

      {errored ? (
        <Card title="User MFA Status">
          <RefreshErrorState error={toHumanError("load", { area: "MFA status" })} backHref="/tenant-admin" />
        </Card>
      ) : users.length === 0 ? (
        <Card title="User MFA Status">
          <EmptyState icon="🔐" title="No users found" message="Users with MFA status will appear here once your directory is populated." />
        </Card>
      ) : (
        <Card title="User MFA Status">
          <MfaTable users={users} source={source} />
        </Card>
      )}
    </div>
  );
}
