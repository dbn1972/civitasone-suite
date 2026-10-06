import Link from "next/link";
import { AUDIT_HOME, AUDIT_HOME_LABEL } from "./auditNav";

/**
 * GAP-AUDIT-DASHBOARD-03 / GAP-AUDIT-HOME-05 — one breadcrumb for every audit
 * sub-page so the "Audit" parent always points at the same route the sidebar
 * does (AUDIT_HOME). On the module home itself (the Event Log at /audit, and
 * the overview at /audit/dashboard) the "Audit" crumb must not link back to
 * the current page, so pass `isHome` to render it as plain current-page text.
 */
export function AuditBreadcrumb({ current, isHome = false }: { current: string; isHome?: boolean }) {
  return (
    <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 4 }}>
      {isHome ? (
        <span aria-current="page">{current}</span>
      ) : (
        <>
          <Link href={AUDIT_HOME} className="lnk">{AUDIT_HOME_LABEL}</Link>
          <span aria-hidden="true" style={{ margin: "0 7px", color: "var(--line)" }}>/</span>
          <span aria-current="page">{current}</span>
        </>
      )}
    </nav>
  );
}
