import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const GRANT_ROLES = ["grant_officer", "grant_admin", "finance_admin", "super_admin"];

interface UcValidation {
  id: string;
  tenantId: string;
  ucId: string;
  status: "pending" | "validated" | "rejected";
  validatedBy: string | null;
  validatedAt: string | null;
  remarks: string | null;
  createdAt: string;
}

const store: UcValidation[] = [];

const validateBody = z.object({
  status: z.enum(["validated", "rejected"]),
  remarks: z.string().max(1000).optional(),
});

export async function ucValidationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/grants/utilization-certs/:id/validate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRANT_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = validateBody.parse(req.body);

    const existing = store.find((r) => r.ucId === id && r.tenantId === ctx.tenantId);
    if (existing) {
      existing.status = body.status;
      existing.validatedBy = ctx.actorId;
      existing.validatedAt = new Date().toISOString();
      existing.remarks = body.remarks ?? null;
      return reply.code(200).send({ data: existing });
    }

    const record: UcValidation = {
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      ucId: id,
      status: body.status,
      validatedBy: ctx.actorId,
      validatedAt: new Date().toISOString(),
      remarks: body.remarks ?? null,
      createdAt: new Date().toISOString(),
    };
    store.push(record);
    return reply.code(201).send({ data: record });
  });

  app.get("/v1/grants/utilization-certs/:id/validation-status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GRANT_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const record = store.find((r) => r.ucId === id && r.tenantId === ctx.tenantId);
    if (!record) {
      return reply.send({ data: { ucId: id, status: "pending", validatedBy: null, validatedAt: null } });
    }
    return reply.send({ data: record });
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
