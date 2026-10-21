import {
  CRM_ADMIN_ROLES,
  CRM_DEDUP_RULES_ROLES,
  CRM_PIPELINE_WRITE_ROLES,
  CRM_STRICT_ADMIN_ROLES,
  hasAnyRole,
} from "@/lib/auth/roleGuard";

/**
 * CRM hub (crm/page.tsx) tile registry.
 *
 * GAP-CRM-HOME-01: every tile declares who can actually open its destination, so
 * a plain crm_user is never shown a tile whose route layout silently redirects
 * them back to /crm. `access` mirrors the destination's own layout guard:
 *
 *   - "all"          no role gate beyond the CRM segment itself
 *   - "admin"        the route layout calls requireAnyRole(CRM_ADMIN_ROLES, ...)
 *   - "strictAdmin"  the route layout calls requireAnyRole(CRM_STRICT_ADMIN_ROLES, ...)
 *   - "dedupRules"   the route layout calls requireAnyRole(CRM_DEDUP_RULES_ROLES, ...)
 *                    (Matching Rules: narrower still -- crm_admin and super_admin
 *                    only, the roles crm-service admits on /v1/crm/dedup-rules;
 *                    GAP-CRM-DEDUP-RULES-05)
 *   - "pipelineWrite" the route layout calls requireAnyRole(CRM_PIPELINE_WRITE_ROLES, ...)
 *                    (Pipelines editor: crm_admin and super_admin only, the roles
 *                    crm-service admits on /v1/crm/pipelines writes; tenant_admin
 *                    would see a wired editor whose every call 403s)
 *
 * hubTiles.test.ts reads every destination layout.tsx and fails if a tile's
 * `access` drifts from the guard the route really enforces. Hiding a tile is UX
 * only -- crm-service stays the authority.
 *
 * Section and tile keys map to the crm.hub.sections.* / crm.hub.tiles.* i18n
 * keys (GAP-CRM-HOME-03); hrefs are static.
 */
export type TileAccess = "all" | "admin" | "strictAdmin" | "dedupRules" | "pipelineWrite";

export interface TileDef {
  tileKey: string;
  href: string;
  access: TileAccess;
}

export interface SectionDef {
  sectionKey: string;
  tiles: TileDef[];
}

export const CRM_HUB_SECTIONS: SectionDef[] = [
  {
    sectionKey: "core",
    tiles: [
      { tileKey: "dashboard", href: "/crm/dashboard", access: "all" },
      { tileKey: "contacts", href: "/crm/contacts", access: "all" },
      { tileKey: "accounts", href: "/crm/accounts", access: "all" },
      { tileKey: "deals", href: "/crm/deals", access: "all" },
      { tileKey: "activities", href: "/crm/activities", access: "all" },
      // GAP-CRM-TASK-ESCALATION-03: the overdue-task monitor is open to every CRM role (managers
      // who RECEIVE escalations need not be admins), so it lives with the everyday tiles, not
      // under the admin-only Configuration section next to the rule editor.
      { tileKey: "overdueTasks", href: "/crm/overdue-tasks", access: "all" },
    ],
  },
  {
    sectionKey: "pipeline",
    tiles: [
      { tileKey: "pipelineBoard", href: "/crm/pipeline", access: "all" },
      { tileKey: "pipelines", href: "/crm/pipelines", access: "pipelineWrite" },
      { tileKey: "opportunities", href: "/crm/opportunities", access: "all" },
      { tileKey: "ageing", href: "/crm/opportunity-ageing", access: "all" },
      { tileKey: "forecast", href: "/crm/forecast", access: "all" },
      { tileKey: "quotations", href: "/crm/quotations", access: "all" },
      { tileKey: "onboarding", href: "/crm/onboarding", access: "all" },
    ],
  },
  {
    sectionKey: "service",
    tiles: [
      { tileKey: "grievances", href: "/crm/grievances", access: "all" },
      { tileKey: "serviceRequests", href: "/crm/service-requests", access: "all" },
      { tileKey: "campaigns", href: "/crm/campaigns", access: "all" },
      { tileKey: "voiceOfCustomer", href: "/crm/voice-of-customer", access: "all" },
      { tileKey: "health", href: "/crm/health", access: "all" },
      { tileKey: "controlTower", href: "/crm/control-tower", access: "all" },
      { tileKey: "leadForms", href: "/crm/lead-forms", access: "admin" },
    ],
  },
  {
    sectionKey: "products",
    tiles: [
      { tileKey: "products", href: "/crm/products", access: "strictAdmin" },
      { tileKey: "priceBooks", href: "/crm/price-books", access: "all" },
      { tileKey: "documents", href: "/crm/documents", access: "all" },
      { tileKey: "documentTypes", href: "/crm/document-types", access: "admin" },
      { tileKey: "serviceTypes", href: "/crm/service-types", access: "strictAdmin" },
      { tileKey: "grievanceCategories", href: "/crm/grievance-categories", access: "admin" },
    ],
  },
  {
    sectionKey: "configuration",
    tiles: [
      { tileKey: "customFields", href: "/crm/custom-fields", access: "admin" },
      { tileKey: "dedupRules", href: "/crm/dedup-rules", access: "dedupRules" },
      { tileKey: "leadScoring", href: "/crm/lead-scoring", access: "admin" },
      { tileKey: "qualificationFrameworks", href: "/crm/qualification-frameworks", access: "admin" },
      { tileKey: "leadReasonCodes", href: "/crm/lead-reason-codes", access: "admin" },
      { tileKey: "assignmentRules", href: "/crm/assignment-rules", access: "admin" },
      { tileKey: "assignmentDirectory", href: "/crm/assignment-directory", access: "admin" },
      { tileKey: "agentWorkload", href: "/crm/agent-workload", access: "strictAdmin" },
      { tileKey: "escalationRules", href: "/crm/escalation-rules", access: "admin" },
      { tileKey: "taskEscalation", href: "/crm/task-escalation", access: "admin" },
      // Not admin-gated: Connected Accounts is a per-user connector panel and
      // Data Quality is usable by a crm_user (only its "Matching rules" link is
      // admin-only), so both stay visible to every CRM role.
      { tileKey: "linkedAccounts", href: "/crm/linked-accounts", access: "all" },
      { tileKey: "dataQuality", href: "/crm/data-quality", access: "all" },
    ],
  },
];

/** True when a viewer holding `roles` can open the tile's destination. */
export function canSeeTile(access: TileAccess, roles: readonly string[]): boolean {
  if (access === "admin") return hasAnyRole(roles, CRM_ADMIN_ROLES);
  if (access === "strictAdmin") return hasAnyRole(roles, CRM_STRICT_ADMIN_ROLES);
  if (access === "dedupRules") return hasAnyRole(roles, CRM_DEDUP_RULES_ROLES);
  if (access === "pipelineWrite") return hasAnyRole(roles, CRM_PIPELINE_WRITE_ROLES);
  return true;
}

/**
 * The sections a viewer should see: each section keeps only the tiles they can
 * open, and a section with no visible tile is dropped entirely (no empty
 * heading).
 */
export function visibleHubSections(roles: readonly string[]): SectionDef[] {
  return CRM_HUB_SECTIONS.map((section) => ({
    ...section,
    tiles: section.tiles.filter((tile) => canSeeTile(tile.access, roles)),
  })).filter((section) => section.tiles.length > 0);
}
