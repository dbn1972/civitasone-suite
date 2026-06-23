import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";

const ROLES = ["workflow_user", "workflow_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];

interface InMemoryDefinition {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  version: number;
  createdBy: string;
  createdAt: string;
}

const inMemoryStore: InMemoryDefinition[] = [];

export async function definitionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/workflow/definitions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = z.object({
      code: z.string().min(1).max(100),
      name: z.string().min(1).max(255),
      description: z.string().max(1000).optional(),
    }).parse(req.body);

    const record: InMemoryDefinition = {
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      code: body.code,
      name: body.name,
      description: body.description ?? null,
      status: "draft",
      version: 1,
      createdBy: ctx.actorId,
      createdAt: new Date().toISOString(),
    };
    inMemoryStore.push(record);
    return reply.code(201).send({ data: record });
  });

  app.get("/v1/workflow/definitions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = z.object({
      limit:  z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const rows = await repo.findByTenant(ctx.tenantId, q.limit, q.offset);
    const memRows = inMemoryStore.filter((r) => r.tenantId === ctx.tenantId);
    return reply.send({ data: [...memRows, ...rows] });
  });

  app.post("/v1/workflow/definitions/:id/deploy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const record = inMemoryStore.find((r) => r.id === id && r.tenantId === ctx.tenantId);
    if (!record) throw new HttpError(404, "NOT_FOUND", "definition not found");
    if (record.status === "active") throw new HttpError(409, "ALREADY_DEPLOYED", "definition already deployed");

    record.status = "active";
    return reply.send({ data: record, message: "definition deployed" });
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
