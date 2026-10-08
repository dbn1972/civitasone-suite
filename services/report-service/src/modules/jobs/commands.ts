/**
 * Command handlers (WRITE PATH) — publish command, prime cache, return accepted.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { CreateJobBody, ShareJobBody } from "./validators.js";
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
    // GAP2-REPORTS-JOBS-01: stamp the projection's createdAt at creation so a
    // just-queued job's Requested time (derived from createdAt in the route
    // mapper) is correct even while served from the write-through cache,
    // before the DB row is read back.
    createdAt: new Date(),
    downloadUrl: null,
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

export async function shareJob(
  ctx: RequestContext,
  id: string,
  payload: { recipients: string[]; message?: string; downloadUrl: string },
): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.shareJob, {
    messageId,
    type: COMMANDS.shareJob,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { jobId: id, ...payload },
  });
  return { id: messageId, status: "accepted", correlationId: ctx.correlationId };
}
