import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createInstanceBody, instancesListSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as historyRepo from "../history/repo.js";

const ROLES = ["workflow_user", "workflow_admin", "super_admin"];
const ADMIN_ROLES = ["workflow_admin", "super_admin", "tenant_admin"];

const lifecycleBody = z.object({ reason: z.string().max(512).optional() });

// P1-4 — in-flight version migration body.
const migrateBody = z.object({
  toVersion: z.number().int().positive(),
  nodeRemap: z.record(z.string().max(64), z.string().max(64)).optional(),
});

export async function instanceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/workflow/instances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createInstanceBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createInstance(ctx, body));
  });

  app.get("/v1/workflow/instances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, instancesListSchema, await queries.listInstances(ctx.tenantId, q.limit, q.offset));
  });

  // Rich instance search with filtering
  app.get("/v1/workflow/instances/search", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = z.object({
      status: z.enum(["active", "completed", "cancelled", "suspended"]).optional(),
      refType: z.string().max(64).optional(),
      refId: z.string().uuid().optional(),
      definitionCode: z.string().max(64).optional(),
      sla: z.enum(["breached", "at_risk", "on_track"]).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      assignee: z.string().uuid().optional(),
      q: z.string().max(200).optional(), // text search on name
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const results = await queries.searchInstances(ctx.tenantId, q);
    return reply.send(results);
  });

  app.get("/v1/workflow/instances/:id/history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await historyRepo.listForInstance(id, ctx.tenantId);
    return reply.send({ data: rows });
  });

  // P0-2 — instance lifecycle: cancel / suspend / resume. Tenant-scoped +
  // admin-authorized. Each validates the transition synchronously then enqueues
  // a command that applies the status change + writes a transition_history row.
  app.post("/v1/workflow/instances/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = lifecycleBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.cancelInstance(ctx, id, body.reason));
  });

  app.post("/v1/workflow/instances/:id/suspend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = lifecycleBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.suspendInstance(ctx, id, body.reason));
  });

  app.post("/v1/workflow/instances/:id/resume", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = lifecycleBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.resumeInstance(ctx, id, body.reason));
  });

  // P1-4 — in-flight version migration. Admin-only. Rebinds a running instance
  // to another version of the same definition code (with node-key remap
  // validation + a transition_history entry). Synchronous (immediate result).
  app.post("/v1/workflow/instances/:id/migrate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = migrateBody.parse(req.body ?? {});
    const result = await commands.migrateInstanceVersion(ctx, id, body.toVersion, body.nodeRemap);
    return reply.send({ data: result });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
