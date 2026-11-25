/**
 * Roles the telephony-service accepts on agent presence routes, mirrored so the web UI can hide
 * actions the viewer cannot perform. DISPLAY gating only: the service re-checks every role
 * (requireRole) and stays the authority.
 *
 * Keep in step with services/telephony-service/src/modules/agents/routes.ts TELEPHONY_ROLES.
 */
export const TELEPHONY_ROLES = ["telephony_user", "telephony_supervisor", "telephony_admin", "super_admin"];

/** May set ANY agent's presence (route comment: "supervisors/admins may set anyone's"). Line agents (telephony_user) may set only their own. */
export const TELEPHONY_PRESENCE_OVERRIDE_ROLES = ["telephony_supervisor", "telephony_admin", "super_admin"];

/** Presence states accepted by POST /v1/telephony/agents/:id/status (AGENT_STATUSES). */
export const AGENT_STATUSES = ["available", "busy", "wrap_up", "offline"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];
