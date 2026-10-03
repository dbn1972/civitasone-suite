import { PageHeader } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getAdminUsersPage, getAdminRolesList, isUserStatus } from "@/app/_data/loaders";
import { requireAnyRole, getSessionRoles, getSessionUserId } from "@/lib/auth/roleGuard";
import { ADMIN_TENANT_ROLES, ADMIN_PLATFORM_ROLES } from "@/lib/auth/adminRoles";
import { AdminUsersManager } from "./AdminUsersManager";

// COMP-004: this page used to render 12 hardcoded MOCK_USERS with a role
// taxonomy and department/last-login fields that don't exist anywhere in
// identity-service's real user row. Status/roles actions already fired real
// requests (COMP-004's admin-service commit added the status/roles proxy
// routes), but the underlying list itself, and the "did it actually work"
// feedback, were both fake — a suspend click flipped local state regardless
// of what the server returned. Now: the directory is GET /v1/admin/users
// (identity-service's real user rows) via a server loader; every mutation
// (status toggle, role edit) is a real PATCH, confirmed before the row
// updates, with a visible error banner on failure instead of a silent local
// flip. Department and last-login columns are dropped rather than shown as
// invented values — identity-service doesn't track either at this layer
// (same honest-omission call already made for GET /v1/admin/mfa/users, see
// gap/routes.ts).
export default async function AdminUsersPage({ searchParams }: { searchParams?: { q?: string; status?: string; page?: string } }) {
  // GAP-ADMIN-USERS-01/02: admin-service user + role routes require tenant_admin or higher.
  requireAnyRole(ADMIN_TENANT_ROLES);
  const sessionRoles = getSessionRoles();
  // GAP-ADMIN-USERS-03: search, status filter and paging are server-side, so the directory
  // and its total are real however many people the office has.
  const q = (searchParams?.q ?? "").trim().slice(0, 100);
  const status = isUserStatus(searchParams?.status) ? searchParams?.status : undefined;
  const requested = Number(searchParams?.page ?? 1);
  const page = Number.isFinite(requested) && requested > 1 ? Math.floor(requested) : 1;
  const [{ data: pageData, source }, { data: roles }] = await Promise.all([
    getAdminUsersPage({ ...(q ? { q } : {}), ...(status ? { status } : {}), page }),
    getAdminRolesList(),
  ]);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="User Management"
        subtitle="All platform users — roles, status, and access controls."
        back="/admin"
      />
      <DataSourceBadge source={source} message="Couldn't load the user directory — showing nothing" />
      <AdminUsersManager
        // A new search/page is a new server result: remount so local state restarts from it.
        key={`${q}|${status ?? ""}|${page}`}
        initialUsers={pageData.rows}
        roles={roles}
        source={source}
        currentUserId={getSessionUserId()}
        canAssignPlatformRoles={ADMIN_PLATFORM_ROLES.some((r) => sessionRoles.includes(r))}
        directory={{ total: pageData.total, counts: pageData.counts, page: pageData.page, pageSize: pageData.pageSize, query: q, status: status ?? null }}
      />
    </div>
  );
}
