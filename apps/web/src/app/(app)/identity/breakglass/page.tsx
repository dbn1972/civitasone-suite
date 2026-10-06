import { redirect } from "next/navigation";

/**
 * GAP-IDENTITY-BREAKGLASS-02 / BREAKGLASS-03 (+ BREAKGLASS-01/04/05/06): the old
 * /identity/breakglass rendered a read-only generic ModuleListPage — no
 * requester / reason / window / expiry columns, no Close-session action, and a
 * mapper that could print a free-text reason (DPDP-sensitive) verbatim to any
 * viewer. The canonical /tenant-admin/breakglass page already shows requester /
 * reason / requested / duration / status, a Close-session action, an active-
 * session alert banner, and an [id] detail page, all behind the admin role gate
 * and audited server-side. We redirect to it rather than keep a second, weaker,
 * PII-leaky copy. DECISION: break-glass approve/deny dual-control is a security-
 * owner product decision with no backend endpoint evidenced; not invented here.
 * Preserves /identity/breakglass bookmarks.
 */
export default function Page() {
  redirect("/tenant-admin/breakglass");
}
