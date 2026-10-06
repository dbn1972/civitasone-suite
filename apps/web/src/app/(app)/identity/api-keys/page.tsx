import { redirect } from "next/navigation";

/**
 * GAP-IDENTITY-API-KEYS-02 (+ API-KEYS-01/04/05/06): the old /identity/api-keys
 * rendered a read-only generic ModuleListPage — no create / rotate / revoke, no
 * scopes / owner / expiry / last-used columns, raw ISO dates, and a failmask that
 * made an error look like an empty list. The canonical /tenant-admin/api-keys
 * page already has APIKeysTable (Name / Scope / Last used / Expires / Status) and
 * APIKeyActions (create with scopes, rotate, revoke via ConfirmDialog), with the
 * backend emitting audit events on every mutation. We redirect to it rather than
 * keep a second, weaker, unguarded list. Preserves /identity/api-keys bookmarks.
 */
export default function Page() {
  redirect("/tenant-admin/api-keys");
}
