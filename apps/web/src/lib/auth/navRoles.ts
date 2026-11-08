/**
 * Client-safe role lists that a destination layout guards with AND the
 * navigation model (lib/nav/navModel.ts) must carry, so the sidebar and the
 * search index never offer a page its own layout would redirect away from
 * (UAT-P3 S-02 / NAV-02). roleGuard.ts imports next/headers (server only), so
 * these live here; roleGuard re-exports the ones it always exported and the
 * layouts import from here. navModel.parity.test.ts pins nav entry == layout guard.
 */

export const PROJECT_VIEW_ROLES = [
  "project_officer",
  "project_manager",
  "project_admin",
  "finance_officer",
  "tenant_admin",
  "super_admin",
  "audit_officer",
];

export const INSPECTION_ROLES = [
  "inspector",
  "reviewing_officer",
  "supervising_officer",
  "planning_officer",
  "audit_officer",
  "inspection_admin",
  "tenant_admin",
  "super_admin",
];

export const LOYALTY_READ_ROLES = ["loyalty_user", "loyalty_admin", "super_admin"];

export const CATALOGUE_READER_ROLES = ["catalogue_user", "catalogue_admin", "super_admin"];

export const RECOMMENDATION_READER_ROLES = [
  "recommendation_admin",
  "crm_user",
  "sales_user",
  "super_admin",
];

export const REPORTS_READER_ROLES = [
  "report_user",
  "report_viewer",
  "report_admin",
  "finance_admin",
  "admin",
  "tenant_admin",
  "super_admin",
];

export const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];

export const AUDIT_ROLES = ["audit_officer", "audit_admin", "platform_admin", "super_admin", "finance_admin", "dept_head"];

export const LEGAL_ROLES = ["legal_officer", "legal_admin", "platform_admin", "super_admin", "audit_officer"];

export const LOCATION_VIEW_ROLES = [
  "location_user",
  "location_admin",
  "super_admin",
  "admin",
  "hr_admin",
  "hr_officer",
  "manager",
  "employee",
];
