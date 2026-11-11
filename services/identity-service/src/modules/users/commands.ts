import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { HttpError } from "../../shared/context.js";
import { assertNotPlatformOperator } from "../operators/commands.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { CreateUserBody, UpdateUserBody, StatusBody } from "./validators.js";
import type { UserView } from "./domain.js";
import type * as rbacRepo from "../rbac/repo.js";
import { strandsTenantAdmins } from "./last-admin.js";
import { scopedRead } from "../../shared/db.js";
import * as userRepo from "./repo.js";
import * as onboardingRepo from "./onboarding-repo.js";
import { checkGrant, effectiveCreateRoles, normaliseRoles, type GrantRefusal } from "./grantable-roles.js";
import { bulkCreateMax, type BulkCreateBody, type SetRolesBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

/** Refuse a role request that is outside the allow-list or beyond what the caller may grant. */
function assertCanGrant(ctx: RequestContext, roles: readonly string[]): string[] {
  const check = checkGrant(ctx.roles, roles);
  if (!check.ok) throw new RoleRefusedError(check.refused);
  return check.roles;
}

export class RoleRefusedError extends HttpError {
  constructor(public refused: GrantRefusal[]) {
    super(403, "ROLE_NOT_GRANTABLE", `refused: ${refused.map((r) => `${r.role} (${r.code})`).join(", ")}`);
  }
}

export async function createUser(ctx: RequestContext, body: CreateUserBody): Promise<Accepted> {
  // Usable-logins create flow (migration 0034). A tenant with no row keeps today's behaviour EXACTLY, which
  // includes ignoring a `roles` field: clients (and tests) already send one, the schema used to drop it silently,
  // and refusing it now would break them. The bulk route, which is new, refuses instead.
  const settings = await onboardingRepo.getSettings(ctx.tenantId);
  const grant = settings.usableLogins ? assertCanGrant(ctx, effectiveCreateRoles(body.roles)) : null;
  // GAP-TENANT-ADMIN-USERS-07: refuse a duplicate email up front. Without this the
  // POST answered 202 and the consumer then failed on the unique index, so the
  // admin saw "invitation sent" for an invite that never created anything (and a
  // projected cache entry for a user that does not exist).
  if (await userRepo.emailExists(ctx.tenantId, body.email)) {
    throw new HttpError(409, "DUPLICATE_EMAIL", "a user with this email already exists in this tenant");
  }
  const id = randomUUID();
  const projected: UserView = {
    id, tenantId: ctx.tenantId, email: body.email, name: body.name,
    empCode: body.empCode ?? null, status: "active", mfaEnabled: false, version: 1,
  };
  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE.user, id), projected);
  await queue.publish(COMMANDS.createUser, {
    messageId: id, type: COMMANDS.createUser, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...projected, createdBy: ctx.actorId, ...(grant ? { requestedRoles: grant, grantorRoles: ctx.roles } : {}) },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export type BulkRowResult = {
  index: number; email: string;
  status: "accepted" | "already_exists" | "duplicate_in_request" | "rejected";
  id?: string; code?: string; message?: string; refused?: GrantRefusal[];
};
export type BulkReport = { correlationId: string; total: number; accepted: number; skipped: number; rejected: number; results: BulkRowResult[] };

/**
 * Bulk onboarding. Capped (IDENTITY_BULK_CREATE_MAX, default 200, hard max 500), idempotent (an email that
 * already exists in the tenant, or repeats inside the request, is reported and skipped, so re-posting the same
 * list creates nothing twice) and partial-success (every row is judged on its own; a bad row never blocks the
 * rest). Each accepted row goes through exactly the same checks and command as a single create.
 */
export async function bulkCreateUsers(ctx: RequestContext, body: BulkCreateBody): Promise<BulkReport> {
  const cap = bulkCreateMax();
  if (body.users.length > cap) {
    throw new HttpError(413, "BULK_TOO_LARGE", `at most ${cap} users per request`);
  }
  const settings = await onboardingRepo.getSettings(ctx.tenantId);
  if (!settings.usableLogins) {
    throw new HttpError(409, "USABLE_LOGINS_DISABLED", "bulk onboarding is not enabled for this tenant");
  }
  const existing = await onboardingRepo.existingEmails(ctx.tenantId, body.users.map((u) => u.email));
  const seen = new Set<string>();
  const results: BulkRowResult[] = [];
  for (const [index, row] of body.users.entries()) {
    const key = row.email.toLowerCase();
    if (seen.has(key)) { results.push({ index, email: row.email, status: "duplicate_in_request" }); continue; }
    seen.add(key);
    if (existing.has(key)) { results.push({ index, email: row.email, status: "already_exists" }); continue; }
    const check = checkGrant(ctx.roles, effectiveCreateRoles(row.roles ?? body.defaultRoles));
    if (!check.ok) { results.push({ index, email: row.email, status: "rejected", code: "ROLE_NOT_GRANTABLE", refused: check.refused }); continue; }
    const id = randomUUID();
    const projected: UserView = {
      id, tenantId: ctx.tenantId, email: row.email, name: row.name,
      empCode: row.empCode ?? null, status: "active", mfaEnabled: false, version: 1,
    };
    try {
      await cache.put(cache.makeKey(ctx.tenantId, RESOURCE.user, id), projected);
      await queue.publish(COMMANDS.createUser, {
        messageId: id, type: COMMANDS.createUser, tenantId: ctx.tenantId, actorId: ctx.actorId,
        correlationId: ctx.correlationId, schemaVersion: "1.0",
        payload: { ...projected, createdBy: ctx.actorId, requestedRoles: check.roles, grantorRoles: ctx.roles },
      });
      results.push({ index, email: row.email, status: "accepted", id });
    } catch {
      results.push({ index, email: row.email, status: "rejected", code: "PUBLISH_FAILED", message: "could not queue this user; retry the request (accepted rows are skipped)" });
    }
  }
  const count = (s: BulkRowResult["status"]) => results.filter((r) => r.status === s).length;
  return {
    correlationId: ctx.correlationId, total: results.length, accepted: count("accepted"),
    skipped: count("already_exists") + count("duplicate_in_request"), rejected: count("rejected"), results,
  };
}

/**
 * Change a user's tenant-grantable roles (the FULL desired set). Same rules as create: allow-list only, the
 * caller must be allowed to grant every role they add AND every role they remove, platform roles never. The
 * caller cannot change their own roles, and a platform operator goes through the operator maker-checker.
 * The worker re-checks, applies it in Keycloak and writes the audit trail.
 */
export async function setUserRoles(ctx: RequestContext, id: string, body: SetRolesBody): Promise<Accepted> {
  if (isSameUuid(id, ctx.actorId)) {
    throw new HttpError(409, "SELF_ROLE_CHANGE", "you cannot change your own roles; ask another admin");
  }
  const roles = assertCanGrant(ctx, normaliseRoles(body.roles));
  const view = await userRepo.findById(ctx.tenantId, id);
  if (!view) throw new HttpError(404, "NOT_FOUND", "user not found");
  if (view.status !== "active") throw new HttpError(409, "USER_NOT_ACTIVE", "roles can only be changed for an active user");
  await assertNotPlatformOperator(ctx.tenantId, id);
  await queue.publish(COMMANDS.setUserRoles, {
    messageId: randomUUID(), type: COMMANDS.setUserRoles, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, roles, grantorRoles: ctx.roles, reason: body.reason },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateUser(ctx: RequestContext, id: string, body: UpdateUserBody): Promise<Accepted> {
  await queue.publish(COMMANDS.updateUser, {
    messageId: randomUUID(),
    type: COMMANDS.updateUser, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isSameUuid(a: string, b: string): boolean {
  return UUID_RE.test(a) && UUID_RE.test(b) && a.toLowerCase() === b.toLowerCase();
}

export async function changeUserStatus(ctx: RequestContext, id: string, body: StatusBody): Promise<Accepted> {
  // GAP-ADMIN-USERS-01: an admin must not suspend, lock or deactivate their own
  // account (also covers DELETE, which routes through this command). Another
  // admin can still do it, so this never strands the account permanently.
  // UUIDs are case-insensitive: the route's zod uuid() accepts an upper-cased id, so compare lower-cased.
  if (body.status !== "active" && isSameUuid(id, ctx.actorId)) {
    throw new HttpError(409, "SELF_STATUS_CHANGE", "you cannot suspend, lock or deactivate your own account");
  }
  // GAP-ADMIN-USERS-01: never take the tenant's last active tenant admin out of service.
  // Checked here for a fast, readable 409; the consumer re-checks under a lock so two admins
  // suspending each other at the same moment cannot both pass.
  if (body.status !== "active" && (await scopedRead((tx) => strandsTenantAdmins(tx as unknown as rbacRepo.Writer, ctx.tenantId, id)))) {
    throw new HttpError(409, "LAST_TENANT_ADMIN", "this is the last active tenant admin; make someone else a tenant admin first");
  }
  // GAP-ADMIN-OPERATORS-05: ANY status change to a platform operator (suspend, lock, deactivate AND
  // reactivate) needs a second super admin's approval, so none can be done through this direct route.
  await assertNotPlatformOperator(ctx.tenantId, id);
  await queue.publish(COMMANDS.deactivateUser, {
    messageId: randomUUID(),
    type: COMMANDS.deactivateUser, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, status: body.status, reason: body.reason },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

// Reset password (P0 security): enqueue a reset request for the user. The
// consumer durably records the request via an audit event (outbox) and triggers
// the best-effort Keycloak UPDATE_PASSWORD action. See the consumer + keycloak
// helper for the honest semantics when Keycloak is not configured.
export async function requestPasswordReset(ctx: RequestContext, id: string, reason?: string): Promise<Accepted> {
  await queue.publish(COMMANDS.resetCredential, {
    messageId: randomUUID(),
    type: COMMANDS.resetCredential, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, reason: reason ?? null },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
