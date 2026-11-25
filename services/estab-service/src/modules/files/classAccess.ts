import { randomUUID } from "node:crypto";
import { queue } from "../../shared/infra.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { isConfidentialOrAbove, roleMayAccessClassification } from "./domain.js";

/**
 * D14: Confidential-and-above content is visible/operable only to CLASSIFIED_ACCESS_ROLES
 * (knowledge_admin, estab_admin, super_admin), on top of desk clearance. This module is the one
 * place every route that returns or mutates a file's (or a DAK's) content goes through, so a
 * sibling route cannot forget the gate.
 */
export type ClassCtx = { tenantId: string; actorId: string; correlationId: string; roles: string[] };

const AUDIT_TOPIC = "audit.event.record";

export async function publishFileAccessAudit(
  ctx: { tenantId: string; actorId: string; correlationId: string },
  payload: Record<string, unknown>,
): Promise<void> {
  // Queue-first audit side-effect: no Postgres write in the request handler.
  await queue.publish(AUDIT_TOPIC, {
    messageId: randomUUID(),
    type: AUDIT_TOPIC,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { service: "estab", ...payload },
  });
}

/** True when this caller may see Confidential+ content at all (used to filter lists in SQL). */
export function mayViewClassified(ctx: { roles: string[] }): boolean {
  return roleMayAccessClassification(ctx.roles, "confidential");
}

/** 403 (audited) when the caller's roles may not access this classification. */
export async function assertRoleMayAccess(
  ctx: ClassCtx,
  classification: string,
  action: string,
  resourceId?: string,
): Promise<void> {
  if (roleMayAccessClassification(ctx.roles, classification)) return;
  await publishFileAccessAudit(ctx, {
    action, resourceType: "file", ...(resourceId ? { resourceId } : {}), outcome: "denied", classification,
  });
  throw new HttpError(403, "FORBIDDEN", "Confidential and above files are restricted to knowledge_admin / estab_admin");
}

/**
 * Per-file gate for any `/files/:id/...` route. No-op for a classified-access caller (no read) and
 * for an unknown id (the route's own 404 handling decides). Returns the classification when read.
 */
export async function assertFileClassAccess(ctx: ClassCtx, fileId: string, action: string): Promise<void> {
  if (mayViewClassified(ctx)) return;
  const file = await repo.findFileById(fileId, ctx.tenantId);
  if (!file) return;
  await assertRoleMayAccess(ctx, file.classification, action, fileId);
}

/** Same, for a DAK (inward) entry, which carries its own classification. */
export async function assertInwardClassAccess(ctx: ClassCtx, inwardId: string, action: string): Promise<void> {
  if (mayViewClassified(ctx)) return;
  const row = await repo.findInwardById(inwardId, ctx.tenantId);
  if (!row) return;
  await assertRoleMayAccess(ctx, row.classification, action, inwardId);
}

/**
 * A Confidential+ file may only be held by someone verifiably holding a classified-access role,
 * otherwise they would hold a file they are then 403'd on. estab-service has no way to resolve
 * ANOTHER user's roles (the holder id is an identity sub or an HRMS employee id), so the only
 * holder it can verify is the caller themself (who has already passed assertRoleMayAccess).
 * Everything else is refused (fail closed) with a message that says why.
 */
export function assertClassifiedHolder(
  ctx: { actorId: string }, classification: string, holderId: string | undefined,
): void {
  if (!isConfidentialOrAbove(classification)) return;
  if (holderId === undefined || holderId === ctx.actorId) return;
  throw new HttpError(
    422,
    "CLASSIFIED_HOLDER_UNVERIFIED",
    "a Confidential or above file can only be held by an officer verified to hold knowledge_admin / estab_admin; the receiving officer's roles cannot be verified, so the file cannot be marked to them",
  );
}
