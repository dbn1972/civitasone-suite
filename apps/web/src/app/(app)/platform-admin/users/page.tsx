import { PageHeader, StatCard } from "@/app/_components/ds";
import { getAdminUsers } from "@/app/_data/loaders";
import { Breadcrumb } from "../Breadcrumb";
import { UserManagementPage } from "./UserManagementPage";

export default async function PlatformUsersPage() {
  const { data: raw, source } = await getAdminUsers();

  const users = raw.map((u) => ({
    id: (u as Record<string, unknown>).id as string ?? String(Math.random()),
    name: (u as Record<string, unknown>).name as string | null ?? null,
    email: (u as Record<string, unknown>).email as string ?? "",
    roles: (u as Record<string, unknown>).roles as string[] ?? [],
    status: (u as Record<string, unknown>).status as string ?? "active",
    lastLoginAt: (u as Record<string, unknown>).lastLoginAt as string | null ?? null,
    mfaEnabled: (u as Record<string, unknown>).mfaEnabled as boolean ?? false,
    department: (u as Record<string, unknown>).department as string | null ?? null,
    tenantId: (u as Record<string, unknown>).tenantId as string | null ?? null,
  }));

  const total = users.length;
  const active = users.filter((u) => u.status === "active").length;
  const suspended = users.filter((u) => u.status === "suspended").length;
  const mfaOn = users.filter((u) => u.mfaEnabled).length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Platform Admin", href: "/platform-admin" }, { label: "User Management" }]} />
      <PageHeader
        back="/platform-admin"
        title="User Management"
        subtitle="All platform users with role badges, last-login, status. Bulk select, export, suspend, and reset password."
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="👥" iconBg="#f1f5f9" label="Total users" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="⛔" iconBg="#fef3f2" label="Suspended" value={suspended} />
        <StatCard icon="🔐" iconBg="#eff6ff" label="MFA enabled" value={mfaOn} />
      </div>
      {/* UX-012: the data-source badge now lives inside UserManagementPage,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). This
          site previously had it worse than most: the table never surfaced
          cache state at all, so a failed fetch with a usable cache showed
          "Couldn't load — showing nothing" while real (cached) rows were
          visible directly underneath it. */}
      <UserManagementPage users={users} source={source} />
    </div>
  );
}
