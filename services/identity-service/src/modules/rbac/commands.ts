import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { assertCanConfer, hasUnconditionalAuthority, DomainError } from "./domain.js";
import type { CreateRoleBody, CreatePermissionBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

function accepted(id: string, ctx: RequestContext): Accepted {
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Caller's own effective permission keys within the tenant they act in. */
async function callerPermissions(ctx: RequestContext): Promise<Set<string>> {
  const eff = await repo.effectiveAccess(ctx.tenantId, ctx.actorId);
  return new Set(eff.permissions);
}

function mapDomainError(err: unknown): never {
  if (err instanceof DomainError) {
    if (err.code === "SELF_ESCALATION") throw new HttpError(403, "FORBIDDEN", err.message);
    throw new HttpError(409, err.code, err.message);
  }
  throw err;
}

// ── roles ────────────────────────────────────────────────────────────────
export async function createRole(ctx: RequestContext, body: CreateRoleBody): Promise<Accepted> {
  const existing = await repo.findRoleByKey(db, ctx.tenantId, body.key);
  if (existing) throw new HttpError(409, "CONFLICT", `role key '${body.key}' already exists`);
  const id = randomUUID();
  await queue.publish(COMMANDS.rbacCreateRole, {
    messageId: id, type: COMMANDS.rbacCreateRole, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, key: body.key, name: body.name, ...(body.description !== undefined ? { description: body.description } : {}) },
  });
  return accepted(id, ctx);
}

export async function createPermission(ctx: RequestContext, body: CreatePermissionBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.rbacCreatePermission, {
    messageId: id, type: COMMANDS.rbacCreatePermission, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, key: body.key, name: body.name, ...(body.description !== undefined ? { description: body.description } : {}) },
  });
  return accepted(id, ctx);
}

// ── role <-> permission ──────────────────────────────────────────────────
export async function grantPermission(ctx: RequestContext, roleId: string, permissionId: string): Promise<Accepted> {
  const role = await repo.findRoleById(db, ctx.tenantId, roleId);
  if (!role) throw new HttpError(404, "NOT_FOUND", "role not found");
  const perm = await repo.findPermissionById(db, ctx.tenantId, permissionId);
  if (!perm) throw new HttpError(404, "NOT_FOUND", "permission not found");

  // Anti-self-escalation: to add a permission to a role, the caller must hold it.
  try {
    assertCanConfer(ctx.roles, await callerPermissions(ctx), [perm.key]);
  } catch (err) { mapDomainError(err); }

  const messageId = randomUUID();
  await queue.publish(COMMANDS.rbacGrantPermission, {
    messageId, type: COMMANDS.rbacGrantPermission, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { roleId, permissionId, permissionKey: perm.key },
  });
  return accepted(roleId, ctx);
}

export async function revokePermission(ctx: RequestContext, roleId: string, permissionId: string): Promise<Accepted> {
  const role = await repo.findRoleById(db, ctx.tenantId, roleId);
  if (!role) throw new HttpError(404, "NOT_FOUND", "role not found");
  const messageId = randomUUID();
  await queue.publish(COMMANDS.rbacRevokePermission, {
    messageId, type: COMMANDS.rbacRevokePermission, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { roleId, permissionId },
  });
  return accepted(roleId, ctx);
}

// ── role <-> user ──────────────────────────────────────────────────────────
export async function assignRole(ctx: RequestContext, roleId: string, userId: string, reason?: string): Promise<Accepted> {
  const role = await repo.findRoleById(db, ctx.tenantId, roleId);
  if (!role) throw new HttpError(404, "NOT_FOUND", "role not found");

  // Anti-self-escalation: caller must be able to confer everything the role grants.
  const roleperms = await repo.permissionKeysForRole(db, ctx.tenantId, roleId);
  try {
    assertCanConfer(ctx.roles, await callerPermissions(ctx), roleperms);
  } catch (err) { mapDomainError(err); }

  const messageId = randomUUID();
  await queue.publish(COMMANDS.rbacAssignRole, {
    messageId, type: COMMANDS.rbacAssignRole, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { roleId, userId, ...(reason !== undefined ? { reason } : {}) },
  });
  return accepted(roleId, ctx);
}

export async function revokeRole(ctx: RequestContext, roleId: string, userId: string, reason?: string): Promise<Accepted> {
  const role = await repo.findRoleById(db, ctx.tenantId, roleId);
  if (!role) throw new HttpError(404, "NOT_FOUND", "role not found");
  // Caller must have authority over the role to revoke it too (no privilege via revoke side-effects).
  if (!hasUnconditionalAuthority(ctx.roles)) {
    const roleperms = await repo.permissionKeysForRole(db, ctx.tenantId, roleId);
    try {
      assertCanConfer(ctx.roles, await callerPermissions(ctx), roleperms);
    } catch (err) { mapDomainError(err); }
  }
  const messageId = randomUUID();
  await queue.publish(COMMANDS.rbacRevokeRole, {
    messageId, type: COMMANDS.rbacRevokeRole, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { roleId, userId, ...(reason !== undefined ? { reason } : {}) },
  });
  return accepted(roleId, ctx);
}
