import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { installPluginBody, configurePluginBody, idParam, pluginsListSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const ROLES = ["plugin_admin", "super_admin"];

export async function registryRoutes(app: FastifyInstance): Promise<void> {
  // List plugins
  app.get("/v1/plugins", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const rows = await repo.listByTenant(ctx.tenantId, q.limit, q.offset);
    // pluginsListSchema is paginatedSchema(...) — {data, pagination}, NOT a bare
    // array. repo.listByTenant() returns a bare array, so this endpoint always
    // 400'd with "Expected object, received array" before this fix (sendValidated
    // runs schema.parse() on the way out and throws on mismatch). Matches the
    // wrapping already done correctly in items/queries.ts and tokens/queries.ts.
    sendValidated(reply, pluginsListSchema, {
      data: rows,
      pagination: { hasMore: rows.length === q.limit, pageSize: q.limit, ...(rows.length ? { cursor: String(q.offset + rows.length) } : {}) },
    });
  });

  // Get single plugin
  app.get("/v1/plugins/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "plugin not found");
    return reply.send(row);
  });

  // Install plugin
  app.post("/v1/plugins/install", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = installPluginBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.pluginInstall(ctx, body));
  });

  // Enable plugin
  app.post("/v1/plugins/:id/enable", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    sendAccepted(reply, acceptedResponseSchema, await commands.pluginEnable(ctx, id));
  });

  // Disable plugin
  app.post("/v1/plugins/:id/disable", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    sendAccepted(reply, acceptedResponseSchema, await commands.pluginDisable(ctx, id));
  });

  // Uninstall (DELETE)
  app.delete("/v1/plugins/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    sendAccepted(reply, acceptedResponseSchema, await commands.pluginUninstall(ctx, id));
  });

  // Configure plugin
  app.put("/v1/plugins/:id/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const body = configurePluginBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.pluginConfigure(ctx, id, body));
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
