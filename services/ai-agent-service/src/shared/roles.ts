/** Role constants for ai-agent-service. */
export const READ_ROLES = ["ai_user", "ai_admin", "super_admin"];
export const ADMIN_ROLES = ["ai_admin", "super_admin"];
/** Governance reads are also visible to auditors. */
export const GOVERNANCE_ROLES = ["ai_user", "ai_admin", "audit_officer", "super_admin"];
