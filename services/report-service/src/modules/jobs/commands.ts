/**
 * Command handlers (WRITE PATH) — publish command, prime cache, return accepted.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { CreateJobBody } from "./validators.js";
import type { JobView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createJob(ctx: RequestContext, body: CreateJobBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: JobView = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    reportType: body.reportType ?? null,
    status: "queued",
    format: "pdf",
    rowCount: null,
    requestedBy: ctx.actorId,
    completedAt: null,
    downloadUrl: null,
    resultColumns: null,
    resultPreview: null,
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);

  await queue.publish(COMMANDS.createJob, {
    messageId: id,
    type: COMMANDS.createJob,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
