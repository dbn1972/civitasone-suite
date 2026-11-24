/**
 * Inspection intake -> findings -> CAPA -> re-inspection: role sets that decide which actions the UI OFFERS.
 * They mirror services/inspection-service (execution/routes.ts CREATE_ROLES, findings/routes.ts
 * INSPECTOR_ROLES / NOTICE_ROLES / READ_ROLES, capa/routes.ts WRITE_ROLES). The service stays the authority.
 */
export const INSPECTION_CREATE_ROLES = ["supervising_officer", "inspection_admin", "tenant_admin", "super_admin"];
export const FINDING_WRITE_ROLES = ["inspector", "inspection_admin", "tenant_admin", "super_admin"];
export const FINDING_NOTICE_ROLES = ["inspector", "reviewing_officer", "inspection_admin", "tenant_admin", "super_admin"];
export const FINDING_READ_ROLES = ["inspector", "reviewing_officer", "inspection_admin", "tenant_admin", "super_admin"];
export const CAPA_WRITE_ROLES = ["inspector", "reviewing_officer", "inspection_admin", "tenant_admin", "super_admin"];

/** Finding lifecycle (findings/domain.ts): verify-resolved closes any non-closed finding; a notice needs `open`. */
export const FINDING_CLOSED_STATE = "closed";
export const FINDING_OPEN_STATE = "open";

export const CAPA_TYPES = ["corrective", "preventive"] as const;
