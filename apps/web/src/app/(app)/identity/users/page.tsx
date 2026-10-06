import { redirect } from "next/navigation";

/**
 * GAP-IDENTITY-USERS-02 / USERS-03: the old /identity/users rendered a read-only
 * generic ModuleListPage — no invite / lock / role change, and a generic mapper
 * that dropped email/role and could print a bare UUID in the Name column. The
 * canonical /tenant-admin/users page reads the SAME /api/identity/users endpoint
 * via the typed getAdminUsers loader and provides name/email/role/status columns
 * plus the full management actions (UsersTable), all behind the same admin role
 * gate. We redirect to it rather than keep a second, weaker, PII-leaky copy.
 * Preserves /identity/users bookmarks.
 */
export default function Page() {
  redirect("/tenant-admin/users");
}
