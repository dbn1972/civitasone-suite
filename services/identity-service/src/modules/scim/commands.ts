import { randomUUID } from "node:crypto";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

// Real bug (found while fixing test debt, not a test-only issue): every scim/*
// command envelope carried the literal string "scim" as actorId. Consumer.ts
// threads msg.actorId straight into users.created_by / users.updated_by and
// into _outbox.messages.actor_id — both `uuid NOT NULL` columns — so every
// SCIM create/replace/patch/delete has ALWAYS failed inside the consumer's
// db.transaction() with `invalid input syntax for type uuid: "scim"`. Before
// the F3 async conversion this surfaced as a synchronous 500 (see the old test
// comment this replaced); since the write moved into
// registerScimConsumers's handlers it fails silently — no HTTP-visible
// signal — so SCIM-driven user provisioning/deprovisioning from an external
// IdP/HR feed has been a complete no-op. Mirrors tenant-onboard/consumer.ts's
// SYSTEM_ACTOR sentinel convention.
const SCIM_SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000001";

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
    envelope(COMMANDS.scimUserCreate, tenantId, SCIM_SYSTEM_ACTOR_ID, correlationId, id, {
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
    envelope(COMMANDS.scimUserReplace, tenantId, SCIM_SYSTEM_ACTOR_ID, correlationId, messageId, {
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
    envelope(COMMANDS.scimUserPatch, tenantId, SCIM_SYSTEM_ACTOR_ID, correlationId, messageId, {
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
    envelope(COMMANDS.scimUserDelete, tenantId, SCIM_SYSTEM_ACTOR_ID, correlationId, messageId, {
      id,
      tenantId,
    }),
  );
  return { id, status: "accepted", correlationId };
}
