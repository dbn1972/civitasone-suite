/**
 * templates consumer — processes template commands from queue.
 * CQRS: markProcessed → DB write → outbox event → cache invalidate.
 */
import type { Queue } from "@civitasone/queue";
import type { RequestContext } from "@civitasone/types";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE as JOB_RESOURCE } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as repo from "./repo.js";
import * as jobsRepo from "../jobs/repo.js";
import type { TemplateInsert } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

const RESOURCE = "template";

const log = pino({ name: "report-templates-consumer" });

type Ctx = Pick<RequestContext, "tenantId" | "actorId" | "correlationId">;

/**
 * The create command carries the HTTP-side projection, which went through JSON
 * on the queue: createdAt/updatedAt arrive as ISO strings, and drizzle's
 * timestamp column calls .toISOString() on them, so the insert threw and the
 * command dead-lettered. Build the row from the authenticated envelope instead
 * and let the DB default the timestamps.
 */
function toInsertRow(ctx: Ctx, payload: TemplateInsert): TemplateInsert {
  const row: TemplateInsert = { ...payload, tenantId: ctx.tenantId, createdBy: ctx.actorId, updatedBy: ctx.actorId };
  delete row.createdAt;
  delete row.updatedAt;
  return row;
}

type ExecutePayload = {
  templateId: string;
  jobId: string;
  parameters?: Record<string, unknown>;
  outputFormat?: string;
};

/**
 * Wire the template commands to the queue. Before this existed nothing
 * subscribed to reports.template.*, so create/update/delete/execute returned
 * 202 and were silently dropped (UAT FQ12 #59-#63).
 */
export function registerTemplateConsumers(queue: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  const q = tenantScoped(queue);
  q.subscribe<TemplateInsert>(COMMANDS.createTemplate, (msg) =>
    handleCreateTemplate(msg.messageId, msg, msg.payload));
  q.subscribe<{ id: string; version: number; [key: string]: unknown }>(COMMANDS.updateTemplate, (msg) =>
    handleUpdateTemplate(msg.messageId, msg, msg.payload));
  q.subscribe<{ id: string }>(COMMANDS.deleteTemplate, (msg) =>
    handleDeleteTemplate(msg.messageId, msg, msg.payload));
  q.subscribe<ExecutePayload>(COMMANDS.executeTemplate, (msg) =>
    handleExecuteTemplate(msg.messageId, msg, msg.payload));
}

/** Job parameters are stored as Record<string, string> (reports.jobs.parameters). */
function stringifyParams(params: Record<string, unknown> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params ?? {}).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]),
  );
}

/**
 * Execute a template: create the report job (id = the jobId returned by the
 * 202) and trigger the render pipeline through the outbox, atomically with
 * markProcessed — same shape as the jobs consumer's createJob path.
 */
export async function handleExecuteTemplate(messageId: string, ctx: Ctx, payload: ExecutePayload): Promise<void> {
  let created = false;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, messageId))) return;
    const template = await repo.findByIdTx(tx as unknown as repo.Writer, payload.templateId, ctx.tenantId);
    if (!template || template.status === "archived") {
      // Deleted between the HTTP pre-check and now: nothing to run.
      log.warn({ templateId: payload.templateId, jobId: payload.jobId }, "template execute: template not found or archived");
      return;
    }
    const format = payload.outputFormat ?? template.outputFormat;
    await jobsRepo.insert(tx as unknown as Parameters<typeof jobsRepo.insert>[0], {
      id: payload.jobId,
      tenantId: ctx.tenantId,
      name: template.name,
      reportType: template.dataSourceId.slice(0, 64),
      status: "queued",
      format,
      parameters: stringifyParams(payload.parameters),
      requestedBy: ctx.actorId,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
      version: 1,
    });
    await enqueue(tx, {
      topic: COMMANDS.renderJob,
      eventType: COMMANDS.renderJob,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      payload: {
        jobId: payload.jobId,
        tenantId: ctx.tenantId,
        templateHtml: `<html><body><h1>${template.name}</h1><p>Data source: ${template.dataSourceId}</p><p>Generated at: ${new Date().toISOString()}</p></body></html>`,
        format,
        title: template.name,
        ...(template.watermark ? { watermark: template.watermark } : {}),
        ...(template.piiColumns && template.piiColumns.length > 0 ? { piiColumns: template.piiColumns } : {}),
      },
    });
    await enqueue(tx, {
      topic: EVENTS.templateExecuted,
      eventType: EVENTS.templateExecuted,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      payload: { templateId: template.id, jobId: payload.jobId },
    });
    await enqueue(tx, {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      payload: {
        service: "report-service",
        action: "execute",
        resourceType: "template",
        resourceId: template.id,
        outcome: "success",
        jobId: payload.jobId,
      },
    });
    created = true;
  });
  if (created) await cache.invalidateResource(ctx.tenantId, JOB_RESOURCE);
}

export async function handleCreateTemplate(
  messageId: string,
  ctx: Ctx,
  payload: TemplateInsert,
): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, messageId))) return;
    await repo.insert(tx as unknown as repo.Writer, toInsertRow(ctx, payload));
    await enqueue(tx, {
      topic: EVENTS.templateCreated,
      eventType: EVENTS.templateCreated,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      payload: { id: payload.id, name: payload.name },
    });
    await enqueue(tx, {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      payload: {
        service: "report-service",
        action: "create",
        resourceType: "template",
        resourceId: payload.id,
        outcome: "success",
      },
    });
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, payload.id as string));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
}

export async function handleUpdateTemplate(
  messageId: string,
  ctx: Ctx,
  payload: { id: string; version: number; [key: string]: unknown },
): Promise<void> {
  const { id, version, ...updates } = payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, messageId))) return;
    const success = await repo.update(
      tx as unknown as repo.Writer,
      id,
      ctx.tenantId,
      version,
      { ...updates, updatedBy: ctx.actorId } as Parameters<typeof repo.update>[4],
    );
    if (!success) {
      // Version conflict — command is effectively a no-op; do not emit event
      return;
    }
    await enqueue(tx, {
      topic: EVENTS.templateUpdated,
      eventType: EVENTS.templateUpdated,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      payload: { id },
    });
    await enqueue(tx, {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      payload: {
        service: "report-service",
        action: "update",
        resourceType: "template",
        resourceId: id,
        outcome: "success",
      },
    });
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
}

export async function handleDeleteTemplate(
  messageId: string,
  ctx: Ctx,
  payload: { id: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, messageId))) return;
    await repo.softDelete(tx as unknown as repo.Writer, payload.id, ctx.tenantId, ctx.actorId);
    await enqueue(tx, {
      topic: EVENTS.templateDeleted,
      eventType: EVENTS.templateDeleted,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      payload: { id: payload.id },
    });
    await enqueue(tx, {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      payload: {
        service: "report-service",
        action: "delete",
        resourceType: "template",
        resourceId: payload.id,
        outcome: "success",
      },
    });
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, payload.id));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
}
