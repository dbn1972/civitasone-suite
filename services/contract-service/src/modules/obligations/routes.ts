import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createObligationBody, updateObligationBody, obligationIdParam, obligationListQuery } from "./validators.js";
import { validateStatusTransition, type ObligationStatus } from "./domain.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const WRITE_ROLES = ["procurement_admin", "finance_admin", "super_admin", "legal_officer", "contract_admin"];
const READ_ROLES = [...WRITE_ROLES, "audit_officer", "procurement_officer", "finance_officer"];

export async function obligationRoutes(app: FastifyInstance): Promise<void> {
  // ── Create obligation — queue-first CQRS write ────────────────────────
  app.post("/v1/contract/obligations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createObligationBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createObligation(ctx, body));
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

  // ── Update obligation — queue-first CQRS write ────────────────────────
  app.patch("/v1/contract/obligations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = obligationIdParam.parse(req.params);
    const body = updateObligationBody.parse(req.body);

    const existing = await repo.getObligationById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "obligation not found");
    }

    // Validate status transition if status is being changed (pre-publish read-only check)
    if (body.status && body.status !== existing.status) {
      if (!validateStatusTransition(existing.status as ObligationStatus, body.status)) {
        throw new HttpError(422, "INVALID_TRANSITION", `cannot transition from ${existing.status} to ${body.status}`);
      }
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.updateObligation(ctx, id, body.version, body));
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
