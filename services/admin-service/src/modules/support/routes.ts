import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { BreakglassSummaryListSchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { z } from "zod";
import { resolveContext, requireSuperAdmin, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import {
  DataCorrectionError,
  assertCorrectionApproverDistinct,
  assertCorrectionPending,
  assertJustification,
} from "./domain.js";
import { breakGlassBody, closeParam, breakGlassListQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";
const CORRECTION_ROLES = [...TENANT_ADMIN_ROLES];
type SupTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const proposeCorrectionBody = z.object({
  targetTable: z.string().min(1).max(160),
  targetId: z.string().min(1).max(160),
  justification: z.string().min(10).max(2000),
  proposedChange: z.record(z.string(), z.unknown()),
  ticketId: z.string().uuid().optional(),
});
const correctionIdParam = z.object({ id: z.string().uuid() });
const rejectCorrectionBody = z.object({ reason: z.string().min(3).max(1000) });
const listCorrectionsQuery = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function serializeCorrection(row: import("./schema.js").AdminDataCorrectionRow): Record<string, unknown> {
  return {
    id: row.id, targetTable: row.targetTable, targetId: row.targetId,
    justification: row.justification, proposedChange: row.proposedChange,
    ticketId: row.ticketId, status: row.status, proposedBy: row.proposedBy,
    approvedBy: row.approvedBy, approvedAt: row.approvedAt?.toISOString?.() ?? null,
    rejectedReason: row.rejectedReason,
    createdAt: row.createdAt?.toISOString?.() ?? String(row.createdAt),
  };
}

async function auditCorrection(tx: SupTx, ctx: { tenantId: string; actorId: string; correlationId: string }, action: string, id: string): Promise<void> {
  await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "admin", action, resourceType: "data_correction", resourceId: id, outcome: "success" } });
}

export async function supportRoutes(app: FastifyInstance): Promise<void> {

  // ── data-correction governance (CAP-100, maker-checker) ───────────────────
  const repoMod = repo;

  app.get("/v1/admin/support/data-corrections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CORRECTION_ROLES);
    const q = listCorrectionsQuery.parse(req.query);
    const rows = await repoMod.listCorrections(ctx.tenantId, q.limit, q.status);
    return reply.send({ data: rows.map(serializeCorrection) });
  });

  app.post("/v1/admin/support/data-corrections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CORRECTION_ROLES);
    const body = proposeCorrectionBody.parse(req.body);
    assertJustification(body.justification);
    const row = await db.transaction(async (tx) => {
      const created = await repoMod.insertCorrection(tx as repo.Writer, {
        tenantId: ctx.tenantId, targetTable: body.targetTable, targetId: body.targetId,
        justification: body.justification, proposedChange: body.proposedChange,
        ticketId: body.ticketId ?? null, status: "pending", proposedBy: ctx.actorId,
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
      await auditCorrection(tx, ctx, "data_correction.proposed", created.id);
      return created;
    });
    return reply.code(201).send(serializeCorrection(row));
  });

  app.post("/v1/admin/support/data-corrections/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CORRECTION_ROLES);
    const { id } = correctionIdParam.parse(req.params);
    await db.transaction(async (tx) => {
      const row = await repoMod.findCorrectionByIdTx(tx as repo.Writer, id, ctx.tenantId);
      if (!row) throw new HttpError(404, "NOT_FOUND", "data correction not found");
      assertCorrectionPending(row.status);
      assertCorrectionApproverDistinct(row.proposedBy, ctx.actorId);
      await repoMod.updateCorrection(tx as repo.Writer, id, ctx.tenantId, {
        status: "approved", approvedBy: ctx.actorId, approvedAt: new Date(), updatedBy: ctx.actorId,
      });
      // Delegate the actual mutation to the owning service via a domain event.
      await enqueue(tx, { topic: "admin.data_correction.approved", eventType: "admin.data_correction.approved",
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { id, targetTable: row.targetTable, targetId: row.targetId, proposedChange: row.proposedChange } });
      await auditCorrection(tx, ctx, "data_correction.approved", id);
    });
    return reply.send({ status: "approved", id });
  });

  app.post("/v1/admin/support/data-corrections/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CORRECTION_ROLES);
    const { id } = correctionIdParam.parse(req.params);
    const body = rejectCorrectionBody.parse(req.body);
    await db.transaction(async (tx) => {
      const row = await repoMod.findCorrectionByIdTx(tx as repo.Writer, id, ctx.tenantId);
      if (!row) throw new HttpError(404, "NOT_FOUND", "data correction not found");
      assertCorrectionPending(row.status);
      await repoMod.updateCorrection(tx as repo.Writer, id, ctx.tenantId, {
        status: "rejected", rejectedReason: body.reason, updatedBy: ctx.actorId,
      });
      await auditCorrection(tx, ctx, "data_correction.rejected", id);
    });
    return reply.send({ status: "rejected", id });
  });
  app.get("/v1/admin/breakglass", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    // P1-3: platform-wide review; an optional tenantId query param targets a
    // specific tenant instead of being pinned to the caller's own ctx.tenantId.
    const q = breakGlassListQuery.parse(req.query);
    const rows = await repo.listBreakGlass(q.limit, q.tenantId);
    sendValidated(reply, BreakglassSummaryListSchema, rows.map((row) => ({
      id: row.id,
      actor: row.actorId,
      // P2-2: no email is captured for break-glass actors (only actor_id, a uuid).
      // Emit an empty string rather than misrepresenting the uuid as an email.
      actorEmail: "",
      reason: row.reason,
      resourceAccessed: row.ticketId,
      startedAt: new Date(row.openedAt as unknown as string).toISOString(),
      endedAt: row.closedAt?.toISOString(),
      status: (row.closedAt ? "ended" : row.expiresAt < new Date() ? "auto_expired" : "active") as "active" | "ended" | "auto_expired",
    })));
  });

  app.post("/v1/admin/support/break-glass", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const body = breakGlassBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.openBreakGlass(ctx, body.tenantId, body.ticketId, body.reason));
  });

  app.patch("/v1/admin/support/break-glass/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = closeParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.closeBreakGlass(ctx, id));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof DataCorrectionError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
