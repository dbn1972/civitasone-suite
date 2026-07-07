/**
 * scheduled HTTP routes — CRUD for scheduled_reports.
 * POST   /v1/reports/scheduled         → 201 (create)
 * GET    /v1/reports/scheduled          → 200 (list)
 * GET    /v1/reports/scheduled/:id      → 200 (get)
 * PATCH  /v1/reports/scheduled/:id      → 200 (update, optimistic locking)
 * DELETE /v1/reports/scheduled/:id      → 204 (disable/soft-delete)
 * POST   /v1/reports/scheduled/:id/run  → 202 (trigger manual run)
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { eq, and } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { scheduledReports } from "./schema.js";
import { computeNextRunAt } from "./domain.js";
import type { ScheduledReportCadence } from "./schema.js";
import { createScheduledReportBody, updateScheduledReportBody, idParam } from "./validators.js";
import { COMMANDS } from "../../topics.js";
import { randomUUID } from "node:crypto";
import { listQuerySchema } from "@civitasone/schemas/common";
import { setTenantGuc } from "@civitasone/db";

const REPORT_ROLES = ["report_viewer", "report_admin", "finance_admin", "super_admin", "admin", "tenant_admin"];

/** Helper: run a callback inside a transaction with the tenant GUC set. */
async function tenantTx<T>(tenantId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await setTenantGuc(tx as unknown as { execute: (q: unknown) => Promise<unknown> }, tenantId);
    return fn(tx as unknown as typeof db);
  });
}

export async function scheduledRoutes(app: FastifyInstance): Promise<void> {
  // Create scheduled report
  app.post("/v1/reports/scheduled", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const body = createScheduledReportBody.parse(req.body);

    const now = new Date();
    const nextRunAt = computeNextRunAt(now, body.cadence as ScheduledReportCadence);

    const record = await tenantTx(ctx.tenantId, async (tx) => {
      const [row] = await tx
        .insert(scheduledReports)
        .values({
          tenantId: ctx.tenantId,
          templateId: body.templateId,
          cadence: body.cadence,
          recipients: body.recipients,
          format: body.format,
          enabled: true,
          nextRunAt,
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId,
        })
        .returning();
      return row;
    });

    return reply.code(201).send({ data: record });
  });

  // List scheduled reports
  app.get("/v1/reports/scheduled", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const q = listQuerySchema.parse(req.query);

    const rows = await tenantTx(ctx.tenantId, async (tx) => {
      return tx
        .select()
        .from(scheduledReports)
        .where(and(
          eq(scheduledReports.tenantId, ctx.tenantId),
          eq(scheduledReports.enabled, true),
        ))
        .limit(q.limit)
        .offset(q.offset);
    });

    return reply.send({
      data: rows,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: rows.length },
    });
  });

  // Get single scheduled report
  app.get("/v1/reports/scheduled/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const { id } = idParam.parse(req.params);

    const [row] = await tenantTx(ctx.tenantId, async (tx) => {
      return tx
        .select()
        .from(scheduledReports)
        .where(and(
          eq(scheduledReports.id, id),
          eq(scheduledReports.tenantId, ctx.tenantId),
        ))
        .limit(1);
    });

    if (!row) throw new HttpError(404, "NOT_FOUND", "scheduled report not found");
    return reply.send({ data: row });
  });

  // Update scheduled report (optimistic locking)
  app.patch("/v1/reports/scheduled/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateScheduledReportBody.parse(req.body);

    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy: ctx.actorId,
      version: body.version + 1,
    };
    if (body.cadence !== undefined) updates.cadence = body.cadence;
    if (body.recipients !== undefined) updates.recipients = body.recipients;
    if (body.format !== undefined) updates.format = body.format;
    if (body.enabled !== undefined) updates.enabled = body.enabled;

    // If cadence changed, recompute nextRunAt from now
    if (body.cadence !== undefined) {
      updates.nextRunAt = computeNextRunAt(new Date(), body.cadence as ScheduledReportCadence);
    }

    const result = await tenantTx(ctx.tenantId, async (tx) => {
      const [updated] = await tx
        .update(scheduledReports)
        .set(updates)
        .where(and(
          eq(scheduledReports.id, id),
          eq(scheduledReports.tenantId, ctx.tenantId),
          eq(scheduledReports.version, body.version),
        ))
        .returning();

      if (!updated) {
        // Check if it exists at all
        const [existing] = await tx
          .select()
          .from(scheduledReports)
          .where(and(eq(scheduledReports.id, id), eq(scheduledReports.tenantId, ctx.tenantId)))
          .limit(1);
        if (!existing) return { error: "not_found" as const };
        return { error: "conflict" as const };
      }

      return { data: updated };
    });

    if ("error" in result) {
      if (result.error === "not_found") throw new HttpError(404, "NOT_FOUND", "scheduled report not found");
      throw new HttpError(409, "VERSION_CONFLICT", "version conflict — reload and retry");
    }

    return reply.send({ data: result.data });
  });

  // Delete (disable) scheduled report
  app.delete("/v1/reports/scheduled/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const { id } = idParam.parse(req.params);

    const disabled = await tenantTx(ctx.tenantId, async (tx) => {
      const [row] = await tx
        .update(scheduledReports)
        .set({ enabled: false, updatedAt: new Date(), updatedBy: ctx.actorId })
        .where(and(
          eq(scheduledReports.id, id),
          eq(scheduledReports.tenantId, ctx.tenantId),
        ))
        .returning();
      return row;
    });

    if (!disabled) throw new HttpError(404, "NOT_FOUND", "scheduled report not found");
    return reply.code(204).send();
  });

  // Trigger manual run
  app.post("/v1/reports/scheduled/:id/run", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const { id } = idParam.parse(req.params);

    const scheduled = await tenantTx(ctx.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(scheduledReports)
        .where(and(
          eq(scheduledReports.id, id),
          eq(scheduledReports.tenantId, ctx.tenantId),
        ))
        .limit(1);
      return row;
    });

    if (!scheduled) throw new HttpError(404, "NOT_FOUND", "scheduled report not found");

    const jobId = randomUUID();
    await queue.publish(COMMANDS.renderJob, {
      messageId: jobId,
      type: COMMANDS.renderJob,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: {
        jobId,
        tenantId: ctx.tenantId,
        templateId: scheduled.templateId,
        format: scheduled.format,
        scheduledReportId: scheduled.id,
      },
    });

    // Update lastRunAt
    await tenantTx(ctx.tenantId, async (tx) => {
      await tx
        .update(scheduledReports)
        .set({ lastRunAt: new Date(), updatedAt: new Date(), updatedBy: ctx.actorId })
        .where(eq(scheduledReports.id, id));
    });

    return reply.code(202).send({ data: { jobId, scheduledReportId: id, status: "queued" } });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
