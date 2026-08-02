/**
 * Command handlers (WRITE PATH) — publish command, prime cache, return accepted.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateScheduledReportBody, UpdateScheduledReportBody } from "./validators.js";
import type { ScheduledReportView } from "./schema.js";
import type { ScheduledReportCadence } from "./schema.js";
import { computeNextRunAt } from "./domain.js";
import { HttpError } from "../../shared/context.js";
import * as queries from "./queries.js";

export type Accepted = { id: string; status: string; correlationId: string };
export type RunAccepted = Accepted & { jobId: string; scheduledReportId: string };

const RESOURCE = "scheduled";

export async function createScheduledReport(
  ctx: RequestContext,
  body: CreateScheduledReportBody,
): Promise<Accepted> {
  const id = randomUUID();
  const now = new Date();
  const nextRunAt = computeNextRunAt(now, body.cadence as ScheduledReportCadence);

  const projected: ScheduledReportView = {
    id,
    tenantId: ctx.tenantId,
    templateId: body.templateId,
    cadence: body.cadence,
    recipients: body.recipients,
    format: body.format,
    enabled: true,
    lastRunAt: null,
    nextRunAt,
    version: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: ctx.actorId,
    updatedBy: ctx.actorId,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);

  await queue.publish(COMMANDS.createScheduled, {
    messageId: id,
    type: COMMANDS.createScheduled,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateScheduledReport(
  ctx: RequestContext,
  id: string,
  body: UpdateScheduledReportBody,
): Promise<Accepted> {
  const existing = await queries.getScheduledReport(ctx.tenantId, id);
  if (!existing) {
    throw new HttpError(404, "NOT_FOUND", "scheduled report not found");
  }
  if (existing.version !== body.version) {
    throw new HttpError(409, "VERSION_CONFLICT", "version conflict — reload and retry");
  }

  const messageId = randomUUID();
  const updates: Record<string, unknown> = { id, version: body.version };
  if (body.cadence !== undefined) updates.cadence = body.cadence;
  if (body.recipients !== undefined) updates.recipients = body.recipients;
  if (body.format !== undefined) updates.format = body.format;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.cadence !== undefined) {
    updates.nextRunAt = computeNextRunAt(new Date(), body.cadence as ScheduledReportCadence);
  }

  await queue.publish(COMMANDS.updateScheduled, {
    messageId,
    type: COMMANDS.updateScheduled,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: updates,
  });

  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function disableScheduledReport(ctx: RequestContext, id: string): Promise<Accepted> {
  const existing = await queries.getScheduledReport(ctx.tenantId, id);
  if (!existing) {
    throw new HttpError(404, "NOT_FOUND", "scheduled report not found");
  }

  const messageId = randomUUID();

  await queue.publish(COMMANDS.disableScheduled, {
    messageId,
    type: COMMANDS.disableScheduled,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id },
  });

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), { ...existing, enabled: false });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function runScheduledReport(ctx: RequestContext, id: string): Promise<RunAccepted> {
  const scheduled = await queries.getScheduledReport(ctx.tenantId, id);
  if (!scheduled) {
    throw new HttpError(404, "NOT_FOUND", "scheduled report not found");
  }

  const jobId = randomUUID();
  const messageId = randomUUID();

  await queue.publish(COMMANDS.runScheduled, {
    messageId,
    type: COMMANDS.runScheduled,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      scheduledReportId: id,
      jobId,
      templateId: scheduled.templateId,
      format: scheduled.format,
    },
  });

  return {
    id: jobId,
    jobId,
    scheduledReportId: id,
    status: "queued",
    correlationId: ctx.correlationId,
  };
}
