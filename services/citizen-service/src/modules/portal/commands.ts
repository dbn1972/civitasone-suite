import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateProfileBody, DeleteProfileBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createProfile(ctx: RequestContext, body: CreateProfileBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.profileCreate, {
    messageId: id, type: COMMANDS.profileCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    // Strip consentGranted from payload — it is gate-checked at route layer, not stored as-is
    payload: { id, tenantId: ctx.tenantId, name: body.name, email: body.email, mobile: body.mobile,
      digilockerToken: body.digilockerToken, address: body.address, ward: body.ward,
      consentGranted: body.consentGranted },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** DPDP §12: right to erasure — queues a deletion command for the citizen's profile & PII. */
export async function deleteProfile(ctx: RequestContext, citizenId: string, body: DeleteProfileBody): Promise<Accepted> {
  const reqId = randomUUID();
  await queue.publish(COMMANDS.profileDelete, {
    messageId: reqId, type: COMMANDS.profileDelete,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { requestId: reqId, tenantId: ctx.tenantId, citizenId, reason: body.reason ?? "citizen_request" },
  });
  return { id: reqId, status: "accepted", correlationId: ctx.correlationId };
}
