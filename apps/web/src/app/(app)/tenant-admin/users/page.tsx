import { PrintExportButton } from "../../../_components/PrintExportButton";
import { PageHeader, StatCard, Term } from "../../../_components/ds";
import { getAdminUsers } from "../../../_data/loaders";
import { UsersTable } from "./UsersTable";
import { LABELS } from "@/lib/labels";

export default async function AdminUsersPage() {
  const { data: users, source } = await getAdminUsers();

  const total = users.length;
  const active = users.filter((u) => u.status === "active").length;
  const suspended = users.filter((u) => u.status === "suspended").length;
  const mfaEnabled = users.filter((u) => u.mfaEnabled).length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* fix/tenant-admin-and-establishment-nav (Bug A): this page used to
          render THREE stacked "go up" affordances — the global AutoBreadcrumb
          (from AppShell, every page gets this automatically), a second,
          page-local <Breadcrumb> ("Tenant Admin / Manage Users"), and this
          PageHeader's own "← Back" link (back="/tenant-admin") — all three
          doing the same job. Removed the two redundant ones; AutoBreadcrumb
          alone is the convention the rest of the app already uses (e.g.
          estab/dashboard). NOTE: ~18 other tenant-admin/* pages share the
          exact same now-redundant <Breadcrumb>+back= pattern (roles,
          sessions, audit, mfa, sso, ... — see PR description) — deliberately
          NOT touched here to keep this fix scoped to the reported page. */}
      <PageHeader
        title="Manage Users"
        subtitle={<>Your {LABELS.tenant}&apos;s user directory with role assignment and <Term name="MFA" /> status.</>}
        help="tenant-admin"
        actions={<PrintExportButton label="Export" style={{ minHeight: 44 }} documentTitle="Users" />}
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="👥" iconBg="#f1f5f9" label="Total Users" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="⛔" iconBg="#fef3f2" label="Suspended" value={suspended} />
        <StatCard icon="🔐" iconBg="#eff6ff" label="MFA Enabled" value={mfaEnabled} />
      </div>
      {/* UX-012: the data-source badge now lives inside UsersTable, driven by
          the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      <UsersTable users={users} source={source} />
    </div>
  );
}
