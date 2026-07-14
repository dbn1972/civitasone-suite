/**
 * Board-decision legal intake — human-triage inbox for `meeting.decision.legal`.
 *
 *  GET  /v1/legal/board-intake                 list intake items (default: pending_review)
 *  GET  /v1/legal/board-intake/:id             read one
 *  POST /v1/legal/board-intake/:id/accept      mark reviewed=accepted (NO auto-execution)
 *  POST /v1/legal/board-intake/:id/reject      mark reviewed=rejected (note required)
 *
 * Accepting an item ONLY records that a legal officer reviewed it. It
 * deliberately does NOT create a legal matter — a board decision is free text
 * and must be actioned through the service's own controlled flow. See the TODO
 * hook in the accept handler.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import * as repo from "./repo.js";

const LEGAL_ROLES  = ["legal_officer", "legal_admin", "super_admin"];
const READER_ROLES = [...LEGAL_ROLES, "audit_officer"];
const idParam = z.object({ id: z.string().uuid() });
const STATUSES = ["pending_review", "accepted", "rejected"] as const;

export async function boardIntakeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/legal/board-intake", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { status } = z.object({
      status: z.enum(STATUSES).default("pending_review"),
    }).parse(req.query ?? {});
    const rows = await repo.listByStatus(ctx.tenantId, status);
    return reply.send({ data: rows });
  });

  app.get("/v1/legal/board-intake/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "intake item not found");
    return reply.send(row);
  });

  app.post("/v1/legal/board-intake/:id/accept", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ note: z.string().max(2000).optional() }).parse(req.body ?? {});
    const row = await repo.findById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "intake item not found");
    if (row.status !== "pending_review") {
      throw new HttpError(409, "NOT_PENDING", `intake item is '${row.status}', not pending_review`);
    }

    await db.transaction(async (tx) => {
      await repo.review(tx, ctx.tenantId, id, "accepted", ctx.actorId, body.note ?? null, row.version);
      // TODO(choreography): controlled hand-off point. A competent legal officer
      // has accepted the board decision for action — invoke the normal create-flow
      // here (e.g. open a case / issue a notice via the module's own command).
      // Intentionally NOT auto-executed.
    });

    return reply.send({ id, status: "accepted", reviewedBy: ctx.actorId });
  });

  app.post("/v1/legal/board-intake/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LEGAL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ note: z.string().min(1).max(2000) }).parse(req.body ?? {});
    const row = await repo.findById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "intake item not found");
    if (row.status !== "pending_review") {
      throw new HttpError(409, "NOT_PENDING", `intake item is '${row.status}', not pending_review`);
    }

    await db.transaction(async (tx) => {
      await repo.review(tx, ctx.tenantId, id, "rejected", ctx.actorId, body.note, row.version);
    });

    return reply.send({ id, status: "rejected", reviewedBy: ctx.actorId });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
