import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import * as repo from "./repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const READER_ROLES = [...HR_ROLES, "manager"];

export async function serviceBookRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/employees/:id/service-book", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await repo.listServiceBookEntries(ctx.tenantId, id);
    return reply.send({ data: rows });
  });

  app.post("/v1/hrms/employees/:id/service-book", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id: employeeId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      entryType: z.string().min(1),
      effectiveDate: z.string(),
      description: z.string().min(1),
      documentRef: z.string().optional(),
    }).parse(req.body);
    const entryId = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertServiceBookEntry(tx, {
        id: entryId, tenantId: ctx.tenantId, employeeId,
        recordedBy: ctx.actorId,
        entryType: body.entryType,
        effectiveDate: body.effectiveDate,
        description: body.description,
        documentRef: body.documentRef ?? null,
      });
    });
    return reply.code(201).send({ id: entryId });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
