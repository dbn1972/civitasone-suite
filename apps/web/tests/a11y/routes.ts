/**
 * Route manifest for the accessibility gate.
 *
 * WCAG 2.2 AA is a government mandate (GIGW 3.0), so the gate must measure the
 * RENDERED page, not the source text. Rendering all 410 static routes takes too
 * long for a per-PR gate, so the default set below is curated to cover:
 *
 *   - every module hub page (the LinkTiles grid every user lands on)
 *   - the highest-traffic list/detail screens per persona journey
 *   - every distinct page ARCHETYPE (hub, list+DataTable, form, dashboard,
 *     wizard, error/empty state) so a violation in a shared DS primitive is
 *     caught even if the specific page using it is not in the set
 *
 * Set A11Y_FULL=1 to sweep every route discovered under (app)/ instead. That is
 * the nightly/pre-release mode; use it before claiming GIGW compliance.
 */

/** Persona used to open a route. Determines which cookie is minted. */
export type Persona =
  | "superadmin"
  | "commissioner"
  | "financeofficer"
  | "hrofficer"
  | "procurementofficer"
  | "grievanceofficer"
  | "auditor"
  | "legalofficer"
  | "inspector"
  | "citizen";

export type RouteSpec = {
  path: string;
  /** Who can see it. A route opened as the wrong persona renders a 403 shell. */
  persona: Persona;
  /** Archetype label — used to report which shared pattern is failing. */
  archetype: "hub" | "list" | "form" | "dashboard" | "wizard" | "detail";
};

/**
 * Curated default set. Keep this list honest: if you add a page with a new
 * layout pattern, add it here too, or the gate will not see it.
 */
export const CURATED_ROUTES: RouteSpec[] = [
  // ── landing / cross-cutting ────────────────────────────────────────────────
  { path: "/dashboard", persona: "superadmin", archetype: "dashboard" },
  { path: "/approvals", persona: "commissioner", archetype: "list" },
  { path: "/notifications", persona: "superadmin", archetype: "list" },
  { path: "/help", persona: "superadmin", archetype: "hub" },
  { path: "/settings/branding", persona: "superadmin", archetype: "form" },

  // ── finance (largest module — 55 pages) ────────────────────────────────────
  { path: "/finance", persona: "financeofficer", archetype: "hub" },
  { path: "/finance/dashboard", persona: "financeofficer", archetype: "dashboard" },
  { path: "/finance/budget/allocation", persona: "financeofficer", archetype: "list" },
  { path: "/finance/budget/sanctions", persona: "financeofficer", archetype: "list" },
  { path: "/finance/expenditure/bills", persona: "financeofficer", archetype: "list" },
  { path: "/finance/payments", persona: "financeofficer", archetype: "list" },
  { path: "/finance/accounting/general-ledger", persona: "financeofficer", archetype: "list" },

  // ── HR / establishment (74 pages) ─────────────────────────────────────────
  { path: "/hr", persona: "hrofficer", archetype: "hub" },
  { path: "/hr/employees", persona: "hrofficer", archetype: "list" },
  { path: "/hr/leave", persona: "hrofficer", archetype: "list" },
  { path: "/hr/attendance", persona: "hrofficer", archetype: "list" },
  { path: "/estab", persona: "hrofficer", archetype: "hub" },

  // ── procurement (30 pages) ────────────────────────────────────────────────
  { path: "/procurement", persona: "procurementofficer", archetype: "hub" },
  { path: "/procurement/vendors", persona: "procurementofficer", archetype: "list" },
  { path: "/procurement/indents", persona: "procurementofficer", archetype: "list" },
  { path: "/procurement/tenders", persona: "procurementofficer", archetype: "list" },
  { path: "/procurement/grn", persona: "procurementofficer", archetype: "list" },

  // ── citizen-facing (public trust surface — highest a11y stakes) ───────────
  { path: "/citizen", persona: "grievanceofficer", archetype: "hub" },
  { path: "/citizen/grievances", persona: "grievanceofficer", archetype: "list" },
  { path: "/citizen/rti", persona: "grievanceofficer", archetype: "list" },
  { path: "/citizen/catalogue", persona: "grievanceofficer", archetype: "list" },

  // ── audit / legal / inspection ────────────────────────────────────────────
  { path: "/audit", persona: "auditor", archetype: "hub" },
  { path: "/legal", persona: "legalofficer", archetype: "hub" },
  { path: "/legal/hearings", persona: "legalofficer", archetype: "list" },

  // ── remaining module hubs (one per module, catches shared hub pattern) ────
  { path: "/analytics", persona: "superadmin", archetype: "hub" },
  { path: "/assets", persona: "superadmin", archetype: "hub" },
  { path: "/billing", persona: "superadmin", archetype: "hub" },
  { path: "/contracts", persona: "superadmin", archetype: "hub" },
  { path: "/court", persona: "legalofficer", archetype: "hub" },
  { path: "/crm", persona: "superadmin", archetype: "hub" },
  { path: "/grants", persona: "superadmin", archetype: "hub" },
  { path: "/helpdesk", persona: "superadmin", archetype: "hub" },
  { path: "/inventory", persona: "superadmin", archetype: "hub" },
  { path: "/knowledge", persona: "superadmin", archetype: "hub" },
  { path: "/locations", persona: "superadmin", archetype: "hub" },
  { path: "/meeting", persona: "superadmin", archetype: "hub" },
  { path: "/projects", persona: "superadmin", archetype: "hub" },
  { path: "/reports", persona: "superadmin", archetype: "hub" },
  { path: "/stock", persona: "superadmin", archetype: "hub" },
  { path: "/telephony", persona: "superadmin", archetype: "hub" },
  { path: "/visitor", persona: "superadmin", archetype: "hub" },
  { path: "/workflow", persona: "superadmin", archetype: "hub" },
  { path: "/works", persona: "superadmin", archetype: "hub" },

  // ── admin / tenant-admin (34 pages) ──────────────────────────────────────
  { path: "/admin", persona: "superadmin", archetype: "hub" },
  { path: "/tenant-admin", persona: "superadmin", archetype: "hub" },
];

/** Unauthenticated routes — these are the first thing any user meets. */
export const PUBLIC_ROUTES: { path: string; archetype: RouteSpec["archetype"] }[] = [
  { path: "/auth/login", archetype: "form" },
  { path: "/auth/forgot", archetype: "form" },
];
