import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { HttpError } from "../../shared/context.js";
import { assertNotPlatformOperator } from "../operators/commands.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { CreateUserBody, UpdateUserBody, StatusBody } from "./validators.js";
import type { UserView } from "./domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createUser(ctx: RequestContext, body: CreateUserBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: UserView = {
    id, tenantId: ctx.tenantId, email: body.email, name: body.name,
    empCode: body.empCode ?? null, status: "active", mfaEnabled: false, version: 1,
  };
  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE.user, id), projected);
  await queue.publish(COMMANDS.createUser, {
    messageId: id, type: COMMANDS.createUser, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { ...projected, createdBy: ctx.actorId },
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
  // GAP-ADMIN-OPERATORS-05: suspending a platform operator needs a second super admin's approval,
  // so it cannot be done through this direct route.
  if (body.status !== "active") await assertNotPlatformOperator(ctx.tenantId, id);
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
export async function requestPasswordReset(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.resetPassword, {
    messageId: randomUUID(),
    type: COMMANDS.resetPassword, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
