import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(
  ctx: RequestContext, type: string, messageId: string, payload: Record<string, unknown>,
): Promise<Accepted> {
  await queue.publish(type, {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, tenantId: ctx.tenantId },
  });
  return { id: messageId, status: "accepted", correlationId: ctx.correlationId };
}

/** Import a service pack as a new draft catalogue definition (FN-09). */
export async function importServicePack(ctx: RequestContext, packId: string): Promise<Accepted> {
  const pack = await repo.findServicePackById(packId, ctx.tenantId);
  if (!pack) throw new HttpError(404, "NOT_FOUND", "service pack not found");

  const definitionId = randomUUID();
  return publish(ctx, COMMANDS.packServiceImport, definitionId, {
    id: definitionId,
    packId: pack.id,
    packKey: pack.packKey,
    name: pack.name,
    servicePattern: pack.servicePattern,
    feeModel: pack.feeModel,
    hoaCode: pack.hoaCode,
    statutoryReferences: pack.statutoryReferences,
    manifest: pack.manifest,
    domainPackKey: pack.domainPackKey,
  });
}
