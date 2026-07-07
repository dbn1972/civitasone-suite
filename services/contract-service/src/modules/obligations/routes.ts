import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createObligationBody, updateObligationBody, obligationIdParam, obligationListQuery } from "./validators.js";
import { computeReminderSchedule, validateStatusTransition, type ObligationStatus } from "./domain.js";
import * as repo from "./repo.js";
import { cache } from "../../shared/infra.js";

const WRITE_ROLES = ["procurement_admin", "finance_admin", "super_admin", "legal_officer", "contract_admin"];
const READ_ROLES = [...WRITE_ROLES, "audit_officer", "procurement_officer", "finance_officer"];

export async function obligationRoutes(app: FastifyInstance): Promise<void> {
  // ── Create obligation ─────────────────────────────────────────────────
  app.post("/v1/contract/obligations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createObligationBody.parse(req.body);

    const id = randomUUID();
    const today = new Date().toISOString().split("T")[0]!;

    const obligation = await repo.insertObligation({
      id,
      tenantId: ctx.tenantId,
      contractId: body.contractId,
      title: body.title,
      description: body.description,
      dueDate: body.dueDate,
      ownerId: body.ownerId,
      status: "pending",
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
    });

    // Generate reminders at 30d/14d/7d before due date
    const schedule = computeReminderSchedule(body.dueDate, today);
    if (schedule.length > 0) {
      await repo.insertReminders(
        schedule.map((s) => ({
          id: randomUUID(),
          tenantId: ctx.tenantId,
          obligationId: id,
          reminderDate: s.reminderDate,
          daysBefore: s.daysBefore,
          sent: "pending" as const,
        })),
      );
    }

    return reply.code(201).send({
      id: obligation.id,
      status: "created",
      remindersScheduled: schedule.length,
      correlationId: ctx.correlationId,
    });
  });

  // ── List obligations ──────────────────────────────────────────────────
  app.get("/v1/contract/obligations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = obligationListQuery.parse(req.query);

    const { data, total } = await repo.listObligations(ctx.tenantId, {
      ...(q.contractId !== undefined && { contractId: q.contractId }),
      ...(q.status !== undefined && { status: q.status }),
      limit: q.limit,
      offset: q.offset,
    });

    return reply.send({
      data,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // ── Get single obligation ─────────────────────────────────────────────
  app.get("/v1/contract/obligations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = obligationIdParam.parse(req.params);

    const obligation = await repo.getObligationById(id, ctx.tenantId);
    if (!obligation) {
      throw new HttpError(404, "NOT_FOUND", "obligation not found");
    }

    const reminders = await repo.getRemindersForObligation(id, ctx.tenantId);

    return reply.send({ data: { ...obligation, reminders } });
  });

  // ── Update obligation ─────────────────────────────────────────────────
  app.patch("/v1/contract/obligations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = obligationIdParam.parse(req.params);
    const body = updateObligationBody.parse(req.body);

    const existing = await repo.getObligationById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "obligation not found");
    }

    // Validate status transition if status is being changed
    if (body.status && body.status !== existing.status) {
      if (!validateStatusTransition(existing.status as ObligationStatus, body.status)) {
        throw new HttpError(422, "INVALID_TRANSITION", `cannot transition from ${existing.status} to ${body.status}`);
      }
    }

    const updated = await repo.updateObligation(id, ctx.tenantId, body.version, {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.dueDate !== undefined && { dueDate: body.dueDate }),
      ...(body.ownerId !== undefined && { ownerId: body.ownerId }),
      ...(body.status !== undefined && { status: body.status }),
      updatedBy: ctx.actorId,
    });

    if (!updated) {
      throw new HttpError(409, "VERSION_CONFLICT", "obligation was modified by another request");
    }

    await cache.invalidate(cache.makeKey(ctx.tenantId, "obligation", id));

    return reply.code(202).send({
      id: updated.id,
      status: "updated",
      correlationId: ctx.correlationId,
    });
  });

  // ── Error handler ─────────────────────────────────────────────────────
  app.setErrorHandler((err: unknown, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      void reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    if (err instanceof HttpError) {
      void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
      return;
    }
    req.log.error({ err }, "unhandled error");
    void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
