import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as ucRepo from "../utilisation/repo.js";

const GRANT_ROLES = ["grant_officer", "grant_admin", "finance_admin", "super_admin"];

const validateBody = z.object({
  status: z.enum(["validated", "rejected"]),
  remarks: z.string().max(1000).optional(),
});

export async function ucValidationRoutes(app: FastifyInstance): Promise<void> {
  // P0-1/P0-2: persist UC validation decision to utilisation.grant_uc_validations
  // and flip grant_uc_statements.validation_status. No in-memory store.
  app.post("/v1/grants/utilization-certs/:id/validate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRANT_ROLES);
    const { id: ucId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = validateBody.parse(req.body);

    // UC must exist within this tenant before it can be validated.
    const uc = await ucRepo.findUcById(ucId, ctx.tenantId);
    if (!uc) {
      throw new HttpError(404, "NOT_FOUND", "utilisation certificate not found");
    }

    const validationId = randomUUID();
    const validatedAt = new Date();
    await db.transaction(async (tx) => {
      await ucRepo.insertUcValidation(tx, {
        id: validationId,
        tenantId: ctx.tenantId,
        ucId,
        status: body.status,
        remarks: body.remarks ?? null,
        validatedBy: ctx.actorId,
        validatedAt,
      });
      await ucRepo.setUcValidationStatus(
        tx, ucId, ctx.tenantId, body.status, ctx.actorId, body.remarks ?? null,
      );
      await enqueue(tx, {
        topic: body.status === "validated" ? EVENTS.ucValidated : EVENTS.ucRejected,
        eventType: body.status === "validated" ? EVENTS.ucValidated : EVENTS.ucRejected,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { ucId, applicationId: uc.applicationId, installmentNo: uc.installmentNo, status: body.status },
      });
      await enqueue(tx, {
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: {
          service: "grant", action: `uc_${body.status}`,
          resourceType: "grant_uc_statement", resourceId: ucId,
          outcome: "success",
        },
      });
    });

    return reply.code(200).send({
      data: {
        id: validationId,
        tenantId: ctx.tenantId,
        ucId,
        status: body.status,
        validatedBy: ctx.actorId,
        validatedAt: validatedAt.toISOString(),
        remarks: body.remarks ?? null,
      },
    });
  });

  app.get("/v1/grants/utilization-certs/:id/validation-status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRANT_ROLES);
    const { id: ucId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const uc = await ucRepo.findUcById(ucId, ctx.tenantId);
    if (!uc) {
      return reply.send({ data: { ucId, status: "pending", validatedBy: null, validatedAt: null } });
    }
    return reply.send({
      data: {
        ucId,
        status: uc.validationStatus,
        validatedBy: uc.validatedBy,
        validatedAt: uc.validatedAt ? uc.validatedAt.toISOString() : null,
        remarks: uc.validationRemarks,
      },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
