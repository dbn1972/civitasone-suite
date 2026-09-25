import { PageHeader, StatCard, StatGrid, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";
import { getMfaUsers } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { MfaTable } from "./MfaTable";

export default async function MfaManagementPage() {
  const result = await getMfaUsers();
  const { data: users, source } = result;
  const errored = toResourceState(result).status === "error";
  const totalUsers = users.length;
  const enrolled = users.filter((u) => u.mfaStatus === "active").length;
  const pending = users.filter((u) => u.mfaStatus === "pending").length;
  const enrollmentPct = totalUsers > 0 ? Math.round((enrolled / totalUsers) * 100) : 0;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "MFA Management" }]} />
      <PageHeader
        back="/tenant-admin"
        title="MFA Management"
        subtitle="Multi-factor authentication enrollment status and user-level MFA controls."
      />
      {/* UX-012: the data-source badge now lives inside MfaTable, driven by
          the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}

      <StatGrid>
        <StatCard icon="👥" iconBg="#f1f5f9" label="Total Users" value={errored ? "—" : totalUsers} />
        <StatCard icon="🔐" iconBg="#ecfdf3" label="MFA Enrolled" value={errored ? "—" : enrolled} />
        <StatCard icon="📊" iconBg="#eff6ff" label="Enrollment %" value={errored ? "—" : `${enrollmentPct}%`} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={errored ? "—" : pending} />
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
