import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { BreakglassSummaryListSchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { z } from "zod";
import { resolveContext, requireSuperAdmin, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import {
  DataCorrectionError,
  assertJustification,
} from "./domain.js";
import { breakGlassBody, closeParam, breakGlassListQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import { publishAdminCommand } from "../../shared/f3-publish.js";
import { COMMANDS } from "../../topics.js";

const CORRECTION_ROLES = [...TENANT_ADMIN_ROLES];

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

export async function supportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/support/data-corrections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CORRECTION_ROLES);
    const q = listCorrectionsQuery.parse(req.query);
    const rows = await repo.listCorrections(ctx.tenantId, q.limit, q.status);
    return reply.send({ data: rows.map(serializeCorrection) });
  });

  app.post("/v1/admin/support/data-corrections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CORRECTION_ROLES);
    const body = proposeCorrectionBody.parse(req.body);
    assertJustification(body.justification);
    const id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, id, {
      op: "support_op_0",
      body,
      params: {},
      preId: id,
    });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/admin/support/data-corrections/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CORRECTION_ROLES);
    const { id } = correctionIdParam.parse(req.params);
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, id, {
      op: "support_op_1",
      body: {},
      params: { id },
      preId: id,
    });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/admin/support/data-corrections/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CORRECTION_ROLES);
    const { id } = correctionIdParam.parse(req.params);
    const body = rejectCorrectionBody.parse(req.body);
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, id, {
      op: "support_op_2",
      body,
      params: { id },
      preId: id,
    });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.get("/v1/admin/breakglass", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const q = breakGlassListQuery.parse(req.query);
    const rows = await repo.listBreakGlass(q.limit, q.tenantId);
    sendValidated(reply, BreakglassSummaryListSchema, rows.map((row) => ({
      id: row.id,
      actor: row.actorId,
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
