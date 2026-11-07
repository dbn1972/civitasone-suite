/**
 * Meeting-service role lists, kept free of next/headers so client components
 * (the shared Sidebar) can import them. roleGuard.ts re-exports both.
 */
/** Meeting configuration (meeting/admin): meeting-service CONFIG admin tier. */
export const MEETING_CONFIG_ADMIN_ROLES = ["meeting_admin", "tenant_admin", "super_admin", "admin"];

/**
 * GAP-MEETING-MEETINGS-03: roles permitted to CREATE / schedule a meeting.
 * Mirrors meeting-service WRITE_ROLES in meeting-core/routes.ts, which guards
 * POST /v1/meetings. The server is the authority.
 */
export const MEETING_CREATE_ROLES = [
  "meeting_admin",
  "committee_secretary",
  "tenant_admin",
  "super_admin",
  "admin",
];
