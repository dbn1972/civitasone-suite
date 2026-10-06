import { redirect } from "next/navigation";

/**
 * GAP-IDENTITY-SESSIONS-02 / SESSIONS-03: the old /identity/sessions rendered a
 * read-only generic ModuleListPage — no revoke control, and rows that could not
 * be attributed to a person (a bare id in the Name column, raw ISO dates, no
 * user / IP / device / last-seen). The canonical /tenant-admin/sessions page
 * reads the SAME /api/identity/sessions endpoint via the typed getActiveSessions
 * loader and already provides all of that plus an audited, confirm-gated Revoke
 * (SessionsTable). Rather than maintain a second, weaker, unattributable copy we
 * redirect to the canonical page. Both surfaces are role-gated identically
 * (identity/layout.tsx IDENTITY_ADMIN_ROLES == tenant-admin/layout.tsx ALLOWED),
 * and the redirect preserves existing /identity/sessions bookmarks.
 */
export default function Page() {
  redirect("/tenant-admin/sessions");
}
