import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const AUDIT_ROLES = ["audit_officer", "audit_admin", "super_admin"];

interface Checklist {
  id: string;
  tenantId: string;
  title: string;
  description: string | null;
  items: string[];
  completed: boolean;
  completedBy: string | null;
  completedAt: string | null;
  createdAt: string;
  createdBy: string;
}

const store: Checklist[] = [];

const createBody = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  items: z.array(z.string().min(1).max(500)).min(1).max(100),
});

export async function checklistRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/audit/compliance/checklists", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const body = createBody.parse(req.body);

    const record: Checklist = {
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      title: body.title,
      description: body.description ?? null,
      items: body.items,
      completed: false,
      completedBy: null,
      completedAt: null,
      createdAt: new Date().toISOString(),
      createdBy: ctx.actorId,
    };
    store.push(record);
    return reply.code(201).send({ data: record });
  });

  app.get("/v1/audit/compliance/checklists", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const q = z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = store.filter((r) => r.tenantId === ctx.tenantId);
    return reply.send({ data: rows.slice(q.offset, q.offset + q.limit), total: rows.length });
  });

  app.patch("/v1/audit/compliance/checklists/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const record = store.find((r) => r.id === id && r.tenantId === ctx.tenantId);
    if (!record) throw new HttpError(404, "NOT_FOUND", "checklist not found");
    if (record.completed) throw new HttpError(409, "ALREADY_COMPLETED", "checklist already completed");

    record.completed = true;
    record.completedBy = ctx.actorId;
    record.completedAt = new Date().toISOString();
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
