import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import { z } from "zod";
import { createExportBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };
type CreateExportBody = z.infer<typeof createExportBody>;

export async function requestExport(ctx: RequestContext, body: CreateExportBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.exportCreate, {
    messageId: id,
    type: COMMANDS.exportCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE.export, id), {
    id,
    status: "pending",
    format: body.format,
    periodFrom: body.from,
    periodTo: body.to,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
