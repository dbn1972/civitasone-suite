/**
 * Role / desk recipients (notify-roles).
 *
 * Several producers address a notice to a DESK rather than a person (visitor-service's
 * "security_control_room", the contract-expiry alert's "contract_management_desk", a tenant-wide
 * release note's "all_users", a platform billing notice). A desk label is not a user, so the send
 * consumer expands it into one send per real user (see role-fanout.ts) before any channel logic runs.
 * This file is the single place that says which real role(s) each desk label means.
 *
 *   scope "tenant"      ACTIVE holders of these roles in the tenant of the event.
 *   scope "platform"    ACTIVE holders of these PLATFORM-authority roles in any tenant: platform
 *                       operators sit outside the tenant whose event raised the notice.
 *   scope "tenant_all"  every ACTIVE user of the tenant (capped, see MAX_FANOUT).
 *
 * Role keys are the ones the owning services already authorise on: security_admin (visitor-service
 * routes), contract_admin (contract-service routes), platform_admin + super_admin (tenant-service
 * PLATFORM_ADMIN, which gates the subscription approve/decide routes), front_desk (visitor-service).
 */
export type DeskScope = "tenant" | "platform" | "tenant_all";

export interface DeskDefinition {
  scope: DeskScope;
  roles: readonly string[];
}

export const DESK_ROLES: Readonly<Record<string, DeskDefinition>> = Object.freeze({
  security_control_room: { scope: "tenant", roles: ["security_admin"] },
  contract_management_desk: { scope: "tenant", roles: ["contract_admin"] },
  reception_desk: { scope: "tenant", roles: ["front_desk"] },
  platform_billing_desk: { scope: "platform", roles: ["platform_admin", "super_admin"] },
  all_users: { scope: "tenant_all", roles: [] },
});

/** The desk a recipient label names, or null when it is an ordinary (person) recipient. */
export function deskFor(recipient: string | undefined | null): { desk: string; def: DeskDefinition } | null {
  if (!recipient || !Object.prototype.hasOwnProperty.call(DESK_ROLES, recipient)) return null;
  return { desk: recipient, def: DESK_ROLES[recipient]! };
}

/** Hard ceiling on the users one desk notice may fan out to (an audit records a truncation). */
export const MAX_FANOUT = Math.max(1, Number(process.env.NOTIFY_MAX_FANOUT ?? 5000) || 5000);
