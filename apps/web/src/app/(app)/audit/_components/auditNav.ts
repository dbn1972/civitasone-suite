/**
 * GAP-AUDIT-DASHBOARD-03 / GAP-AUDIT-HOME-05 — single source of truth for the
 * audit module's "home" so the sidebar target and every sub-page breadcrumb
 * cannot disagree about where "Audit" goes.
 *
 * Decision (recorded): the module landing route stays `/audit` (the Event Log),
 * because that is the route the sidebar (Sidebar.tsx) and global search
 * (GlobalSearch.tsx) already point at and the one every existing deep link and
 * bookmark resolves to. Repointing the shared nav to /audit/dashboard would
 * break those links and churn a shared file multiple concurrent agents touch;
 * instead we make the breadcrumbs agree with the sidebar. The Event Log page
 * itself therefore must NOT render an "Audit" parent that links back to itself
 * (DASHBOARD-03 acceptance: "no page's parent breadcrumb points to itself").
 */
export const AUDIT_HOME = "/audit";
export const AUDIT_HOME_LABEL = "Audit";

/**
 * The audit module's sections, used by both the dashboard quick links and the
 * Event Log sub-nav so the two indexes cannot drift (GAP-AUDIT-DASHBOARD-02).
 */
export const AUDIT_SECTIONS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Event Log", href: "/audit" },
  { label: "Observations", href: "/audit/observations" },
  { label: "Risk Register", href: "/audit/risk-register" },
  { label: "Audit Plan", href: "/audit/plan" },
  { label: "CAG Audit", href: "/audit/cag" },
  { label: "Vigilance", href: "/audit/vigilance" },
  { label: "Investigation", href: "/audit/investigation" },
  { label: "Compliance Tracking", href: "/audit/compliance" },
  { label: "Export Jobs", href: "/audit/exports" },
];
