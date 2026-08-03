import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Board-decision HR intake — human-triage inbox for `meeting.decision.hr`.
 *
 *  GET  /v1/hrms/board-intake                 list intake items (default: pending_review)
 *  GET  /v1/hrms/board-intake/:id             read one
 *  POST /v1/hrms/board-intake/:id/accept      mark reviewed=accepted (NO auto-execution)
 *  POST /v1/hrms/board-intake/:id/reject      mark reviewed=rejected (note required)
 *
 * Accepting an item ONLY records that an HR officer reviewed it. It deliberately
 * does NOT create an HR order — a board decision is free text and must be
 * actioned through the service's own controlled flow (transfer / promotion /
 * disciplinary). See the TODO hook in the accept handler.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import * as repo from "./repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const STATUSES = ["pending_review", "accepted", "rejected"] as const;

export async function boardIntakeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/board-intake", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { status } = z.object({
      status: z.enum(STATUSES).default("pending_review"),
    }).parse(req.query ?? {});
    const rows = await repo.listByStatus(ctx.tenantId, status);
    return reply.send({ data: rows });
  });

  app.get("/v1/hrms/board-intake/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "intake item not found");
    return reply.send(row);
  });

  app.post("/v1/hrms/board-intake/:id/accept", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ note: z.string().max(2000).optional() }).parse(req.body ?? {});
    const row = await repo.findById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "intake item not found");
    if (row.status !== "pending_review") {
      throw new HttpError(409, "NOT_PENDING", `intake item is '${row.status}', not pending_review`);
    }

    await publishF3Write(ctx, "board_intake_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.send({ id, status: "accepted", reviewedBy: ctx.actorId });
  });

  app.post("/v1/hrms/board-intake/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ note: z.string().min(1).max(2000) }).parse(req.body ?? {});
    const row = await repo.findById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "intake item not found");
    if (row.status !== "pending_review") {
      throw new HttpError(409, "NOT_PENDING", `intake item is '${row.status}', not pending_review`);
    }

    await publishF3Write(ctx, "board_intake_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

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
