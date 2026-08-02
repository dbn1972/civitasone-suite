import { randomUUID } from "node:crypto";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

function envelope(
  type: string,
  tenantId: string,
  actorId: string,
  correlationId: string,
  messageId: string,
  payload: Record<string, unknown>,
) {
  return {
    messageId,
    type,
    tenantId,
    actorId,
    correlationId,
    schemaVersion: "1.0",
    payload,
  };
}

export async function scimCreateUser(
  tenantId: string,
  correlationId: string,
  body: { email: string; name: string },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(
    COMMANDS.scimUserCreate,
    envelope(COMMANDS.scimUserCreate, tenantId, "scim", correlationId, id, {
      id,
      tenantId,
      email: body.email,
      name: body.name,
      status: "active",
    }),
  );
  return { id, status: "accepted", correlationId };
}

export async function scimReplaceUser(
  tenantId: string,
  correlationId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(
    COMMANDS.scimUserReplace,
    envelope(COMMANDS.scimUserReplace, tenantId, "scim", correlationId, messageId, {
      id,
      tenantId,
      patch,
    }),
  );
  return { id, status: "accepted", correlationId };
}

export async function scimPatchUser(
  tenantId: string,
  correlationId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(
    COMMANDS.scimUserPatch,
    envelope(COMMANDS.scimUserPatch, tenantId, "scim", correlationId, messageId, {
      id,
      tenantId,
      patch,
    }),
  );
  return { id, status: "accepted", correlationId };
}

export async function scimDeleteUser(
  tenantId: string,
  correlationId: string,
  id: string,
): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(
    COMMANDS.scimUserDelete,
    envelope(COMMANDS.scimUserDelete, tenantId, "scim", correlationId, messageId, {
      id,
      tenantId,
    }),
  );
  return { id, status: "accepted", correlationId };
}
