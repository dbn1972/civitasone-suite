/**
 * Board-decision project intake — CQRS routes (accept/reject → 202).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const PROJ_ROLES   = ["project_manager", "project_officer", "super_admin"];
const READER_ROLES = [...PROJ_ROLES, "audit_officer", "finance_officer"];
const idParam = z.object({ id: z.string().uuid() });
const STATUSES = ["pending_review", "accepted", "rejected"] as const;

export async function boardIntakeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/project/board-intake", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { status } = z.object({
      status: z.enum(STATUSES).default("pending_review"),
    }).parse(req.query ?? {});
    const rows = await repo.listByStatus(ctx.tenantId, status);
    return reply.send({ data: rows });
  });

  app.get("/v1/project/board-intake/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "intake item not found");
    return reply.send(row);
  });

  app.post("/v1/project/board-intake/:id/accept", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ note: z.string().max(2000).optional() }).parse(req.body ?? {});
    const row = await repo.findById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "intake item not found");
    if (row.status !== "pending_review") {
      throw new HttpError(409, "NOT_PENDING", `intake item is '${row.status}', not pending_review`);
    }
    return reply.code(202).send(await commands.acceptIntake(ctx, id, body.note));
  });

  app.post("/v1/project/board-intake/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROJ_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ note: z.string().min(1).max(2000) }).parse(req.body ?? {});
    const row = await repo.findById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "intake item not found");
    if (row.status !== "pending_review") {
      throw new HttpError(409, "NOT_PENDING", `intake item is '${row.status}', not pending_review`);
    }
    return reply.code(202).send(await commands.rejectIntake(ctx, id, body.note));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
