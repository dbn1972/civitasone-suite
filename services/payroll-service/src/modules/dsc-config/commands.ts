import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface UpsertDscBody {
  storageRef: string;
  passphrase: string;
  subjectCn: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  sha256Fingerprint: string;
}

export async function upsertDscConfig(ctx: RequestContext, body: UpsertDscBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.dscConfigUpsert, {
    messageId: id,
    type: COMMANDS.dscConfigUpsert,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function removeDscConfig(ctx: RequestContext): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.dscConfigRemove, {
    messageId: id,
    type: COMMANDS.dscConfigRemove,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
