/**
 * GAP-ADMIN-TENANTS-DETAIL-05 -- pure rules for tenant lifecycle approval.
 *
 * No I/O here. Everything that decides "may this person do this to this
 * tenant" lives in this file so the route (fast, synchronous 4xx) and the
 * consumer (authoritative, inside the transaction) apply exactly the same rule.
 */
import { z } from "zod";
import type { TenantStatus } from "./domain.js";

/** Only platform operators may ever be approvers; a tenant's own admins never are. */
export const PLATFORM_APPROVER_ROLES = ["super_admin", "platform_admin"] as const;
export type PlatformApproverRole = (typeof PLATFORM_APPROVER_ROLES)[number];

export const LIFECYCLE_KINDS = ["suspend", "reactivate", "edit", "policy_change"] as const;
export type LifecycleKind = (typeof LIFECYCLE_KINDS)[number];

export const LIFECYCLE_STATUSES = ["pending", "scheduled", "executed", "rejected", "failed", "cancelled"] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const approvalPolicySchema = z.object({
  requiresSecondApprover: z.boolean().default(true),
  approverRoles: z.array(z.enum(PLATFORM_APPROVER_ROLES)).min(1).max(PLATFORM_APPROVER_ROLES.length)
    .default([...PLATFORM_APPROVER_ROLES]),
  /** Approvals needed from approvers OTHER than the requester. */
  minApprovals: z.number().int().min(1).max(5).default(1),
  reasonRequired: z.boolean().default(true),
  notifyTenantAdmins: z.boolean().default(true),
});
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  requiresSecondApprover: true,
  approverRoles: [...PLATFORM_APPROVER_ROLES],
  minApprovals: 1,
  reasonRequired: true,
  notifyTenantAdmins: true,
};

/**
 * The tenant's effective policy: settings.approvalPolicy with defaults filled
 * in. A stored value that fails validation (hand-edited jsonb, an old shape)
 * falls back to the strict default -- never to a looser one.
 */
export function resolvePolicy(settings: Record<string, unknown> | null | undefined): ApprovalPolicy {
  const raw = settings && typeof settings === "object" ? settings["approvalPolicy"] : undefined;
  if (raw === undefined || raw === null) return { ...DEFAULT_APPROVAL_POLICY, approverRoles: [...DEFAULT_APPROVAL_POLICY.approverRoles] };
  const parsed = approvalPolicySchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_APPROVAL_POLICY, approverRoles: [...DEFAULT_APPROVAL_POLICY.approverRoles] };
}

export const KIND_TARGET_STATUS: Partial<Record<LifecycleKind, TenantStatus>> = {
  suspend: "suspended",
  reactivate: "active",
};

/** What a request of this kind needs, derived from the policy at creation time. */
export interface RequestRequirements {
  /** true => the requester's own action executes at once (audited). */
  direct: boolean;
  requiredApprovals: number;
  approverRoles: string[];
  reasonRequired: boolean;
}

/**
 * Changing the policy itself ALWAYS needs a second platform approver, whatever
 * the policy currently says -- otherwise a lone operator could first switch the
 * control off and then use it. Its approvers are fixed to the platform roles
 * and it always needs a stated reason.
 */
export function requirementsFor(kind: LifecycleKind, policy: ApprovalPolicy): RequestRequirements {
  if (kind === "policy_change") {
    return {
      direct: false,
      requiredApprovals: Math.max(1, policy.minApprovals),
      approverRoles: [...PLATFORM_APPROVER_ROLES],
      reasonRequired: true,
    };
  }
  return {
    direct: !policy.requiresSecondApprover,
    requiredApprovals: policy.requiresSecondApprover ? policy.minApprovals : 0,
    approverRoles: [...policy.approverRoles],
    reasonRequired: policy.reasonRequired,
  };
}

export function holdsAnyRole(roles: readonly string[], allowed: readonly string[]): boolean {
  return roles.some((r) => allowed.includes(r));
}

export function isPlatformOperator(roles: readonly string[]): boolean {
  return holdsAnyRole(roles, PLATFORM_APPROVER_ROLES);
}

export class LifecycleError extends Error {
  constructor(public code: LifecycleErrorCode, message: string, public status = 403) {
    super(message);
    this.name = "LifecycleError";
  }
}
export type LifecycleErrorCode =
  | "TENANT_SELF_ACTION_FORBIDDEN"
  | "NOT_AN_APPROVER"
  | "MAKER_CHECKER_VIOLATION"
  | "REASON_REQUIRED"
  | "INVALID_TRANSITION"
  | "REQUEST_ALREADY_OPEN"
  | "REQUEST_NOT_PENDING"
  | "ALREADY_APPROVED_BY_YOU"
  | "NOT_FOUND"
  | "NO_CHANGE"
  | "NOT_SCHEDULED"
  | "NOT_PARTY_TO_REQUEST"
  | "INVALID_REQUEST"
  | "EXECUTION_FAILED";

/**
 * Nobody acting from inside the target tenant may suspend, reactivate, edit or
 * approve changes to it, whatever roles the token carries: a genuine platform
 * operator belongs to the platform tenant, never the target. Keyed on the
 * actor's tenant alone so a platform-role token minted inside the tenant (or a
 * tenant_admin with a forged platform role) is refused the same way.
 */
export function assertNotOwnTenant(actor: { tenantId: string; roles: readonly string[] }, targetTenantId: string): void {
  if (actor.tenantId === targetTenantId) {
    throw new LifecycleError("TENANT_SELF_ACTION_FORBIDDEN", "a tenant's own administrators cannot change or approve changes to their own tenant", 403);
  }
}

export function assertReason(reason: string | undefined, required: boolean): string {
  const r = (reason ?? "").trim();
  if (required && r.length < 3) throw new LifecycleError("REASON_REQUIRED", "a reason of at least 3 characters is required", 400);
  return r;
}

export function assertCanDecide(args: {
  actor: { actorId: string; tenantId: string; roles: readonly string[] };
  request: { requestedBy: string; tenantId: string; approverRoles: readonly string[]; status: string };
}): void {
  const { actor, request } = args;
  assertNotOwnTenant(actor, request.tenantId);
  if (request.status !== "pending") throw new LifecycleError("REQUEST_NOT_PENDING", "this request has already been decided", 409);
  if (request.requestedBy === actor.actorId) {
    throw new LifecycleError("MAKER_CHECKER_VIOLATION", "the requester cannot approve or reject their own request", 403);
  }
  if (!holdsAnyRole(actor.roles, request.approverRoles)) {
    throw new LifecycleError("NOT_AN_APPROVER", "your role is not permitted to decide this request for this tenant", 403);
  }
}

export const editPayloadSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  domain: z.string().trim().min(3).max(253).regex(/^[a-z0-9.-]+$/i).optional(),
  edition: z.enum(["govt_dept", "psu", "small_office"]).optional(),
}).refine((v) => v.name !== undefined || v.domain !== undefined || v.edition !== undefined, { message: "no field to change" });
export type EditPayload = z.infer<typeof editPayloadSchema>;

/** Only the fields that actually differ, as before/after pairs (for the audit event). */
export function diffFields<T extends Record<string, unknown>>(before: T, patch: Partial<T>): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(v)) { b[k] = before[k]; a[k] = v; }
  }
  return { before: b, after: a };
}

/**
 * Cancelling a scheduled request: the requester or someone who approved it
 * (never from inside the target tenant, and always a platform operator).
 */
export function assertCanCancel(args: {
  actor: { actorId: string; tenantId: string; roles: readonly string[] };
  request: { requestedBy: string; tenantId: string; status: string };
  approverIds: readonly string[];
}): void {
  const { actor, request, approverIds } = args;
  assertNotOwnTenant(actor, request.tenantId);
  if (!isPlatformOperator(actor.roles)) {
    throw new LifecycleError("NOT_AN_APPROVER", "only platform operators can cancel a scheduled request", 403);
  }
  if (request.status !== "scheduled") {
    throw new LifecycleError("NOT_SCHEDULED", "only a scheduled request can be cancelled", 409);
  }
  if (request.requestedBy !== actor.actorId && !approverIds.includes(actor.actorId)) {
    throw new LifecycleError("NOT_PARTY_TO_REQUEST", "only the requester or an approver can cancel this request", 403);
  }
}
