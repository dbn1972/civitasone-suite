/**
 * Plugin Store Routes
 *
 * REST routes for per-tenant per-plugin key-value store.
 * Routes: GET/PUT/DELETE /v1/plugins/:pluginId/store/:key
 *
 * 100MB quota enforced per plugin per tenant.
 */

import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { storeKeyParams, storeValueBody } from "./validators.js";
import * as repo from "./repo.js";
import { computeValueSize, wouldExceedQuota, getQuotaBytes } from "./domain.js";

const ROLES = ["plugin_admin", "super_admin"];

export async function storeRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/plugins/:pluginId/store/:key — retrieve a stored value
  app.get("/v1/plugins/:pluginId/store/:key", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { pluginId, key } = storeKeyParams.parse(req.params);

    const entry = await repo.getEntry(ctx.tenantId, pluginId, key);
    if (!entry) {
      throw new HttpError(404, "NOT_FOUND", `store key "${key}" not found`);
    }

    return reply.send({
      data: {
        key: entry.key,
        value: entry.value,
        sizeBytes: entry.sizeBytes,
        updatedAt: entry.updatedAt.toISOString(),
      },
    });
  });

  // PUT /v1/plugins/:pluginId/store/:key — set a stored value
  app.put("/v1/plugins/:pluginId/store/:key", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { pluginId, key } = storeKeyParams.parse(req.params);
    const { value } = storeValueBody.parse(req.body);

    // Compute size of the new value
    const newValueBytes = computeValueSize(value);

    // Get current usage and existing key size
    const [currentUsage, existingEntry] = await Promise.all([
      repo.getTotalUsageBytes(ctx.tenantId, pluginId),
      repo.getEntry(ctx.tenantId, pluginId, key),
    ]);

    const existingKeyBytes = existingEntry?.sizeBytes ?? 0;

    // Check quota
    if (wouldExceedQuota(currentUsage, existingKeyBytes, newValueBytes)) {
      throw new HttpError(
        422,
        "QUOTA_EXCEEDED",
        `Store quota exceeded. Limit: ${getQuotaBytes()} bytes. Current usage: ${currentUsage} bytes. Requested write: ${newValueBytes} bytes.`,
      );
    }

    // Upsert the entry
    await repo.upsertEntry(ctx.tenantId, pluginId, key, value, newValueBytes, ctx.actorId);

    return reply.code(200).send({
      data: {
        key,
        value,
        sizeBytes: newValueBytes,
        updatedAt: new Date().toISOString(),
      },
    });
  });

  // DELETE /v1/plugins/:pluginId/store/:key — delete a stored value
  app.delete("/v1/plugins/:pluginId/store/:key", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { pluginId, key } = storeKeyParams.parse(req.params);

    const deleted = await repo.deleteEntry(ctx.tenantId, pluginId, key);
    if (!deleted) {
      throw new HttpError(404, "NOT_FOUND", `store key "${key}" not found`);
    }

    return reply.code(204).send();
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
