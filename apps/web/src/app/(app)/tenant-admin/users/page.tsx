import { PrintExportButton } from "../../../_components/PrintExportButton";
import { PageHeader, StatCard, Term, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { getAdminUsers } from "../../../_data/loaders";
import { UsersTable } from "./UsersTable";
import { LABELS } from "@/lib/labels";

export default async function AdminUsersPage() {
  const { data: users, source } = await getAdminUsers();

  // GAP-TENANT-ADMIN-USERS-02: a failed fetch resolves to source "error" with
  // an empty array. The four KPI tiles used to compute from [] and read "0",
  // so an outage looked like a real, empty tenant — only the in-table badge
  // hinted otherwise. Detect error-with-no-rows and render a dash in the tiles
  // plus a retry-able error state above the table. A genuine empty success
  // (source "api", 0 users) still shows real zeros.
  const errored = source === "error" && users.length === 0;

  const total = users.length;
  const active = users.filter((u) => u.status === "active").length;
  const suspended = users.filter((u) => u.status === "suspended").length;
  const mfaEnabled = users.filter((u) => u.mfaEnabled).length;

  const tile = (n: number): string | number => (errored ? "—" : n);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* fix/tenant-admin-and-establishment-nav (Bug A): AutoBreadcrumb from
          AppShell is the single "go up" affordance; the page-local Breadcrumb
          and back link were deliberately removed (GAP-TENANT-ADMIN-USERS-06
          decided NOT to re-add them here — see batch note). */}
      <PageHeader
        title="Manage Users"
        subtitle={<>Your {LABELS.tenant}&apos;s user directory with roles and <Term name="MFA" /> status.</>}
        help="tenant-admin"
        actions={<PrintExportButton label="Export" style={{ minHeight: 44 }} documentTitle="Users" />}
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="👥" iconBg="#f1f5f9" label="Total Users" value={tile(total)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={tile(active)} />
        <StatCard icon="⛔" iconBg="#fef3f2" label="Suspended" value={tile(suspended)} />
        <StatCard icon="🔐" iconBg="#eff6ff" label="MFA Enabled" value={tile(mfaEnabled)} />
      </div>
      {errored ? (
        // Mirror users/[id]/page.tsx's error treatment: a retry-able state, not
        // a silent empty table. UsersTable is still rendered below for the
        // cached/offline-seeded case (useSeededResource may supply rows).
        <RefreshErrorState error={toHumanError("load", { area: "users" })} backHref="/tenant-admin" />
      ) : null}
      {/* UX-012: the data-source badge lives inside UsersTable, driven by the
          same useSeededResource call that produces its rows. */}
      <UsersTable users={users} source={source} />
    </div>
  );
}
