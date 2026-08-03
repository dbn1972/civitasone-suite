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
import * as commands from "./commands.js";
import { computeValueSize, wouldExceedQuota, getQuotaBytes } from "./domain.js";

const ROLES = ["plugin_admin", "super_admin"];

export async function storeRoutes(app: FastifyInstance): Promise<void> {
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

  app.put("/v1/plugins/:pluginId/store/:key", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { pluginId, key } = storeKeyParams.parse(req.params);
    const { value } = storeValueBody.parse(req.body);

    const newValueBytes = computeValueSize(value);

    const [currentUsage, existingEntry] = await Promise.all([
      repo.getTotalUsageBytes(ctx.tenantId, pluginId),
      repo.getEntry(ctx.tenantId, pluginId, key),
    ]);

    const existingKeyBytes = existingEntry?.sizeBytes ?? 0;

    if (wouldExceedQuota(currentUsage, existingKeyBytes, newValueBytes)) {
      throw new HttpError(
        422,
        "QUOTA_EXCEEDED",
        `Store quota exceeded. Limit: ${getQuotaBytes()} bytes. Current usage: ${currentUsage} bytes. Requested write: ${newValueBytes} bytes.`,
      );
    }

    const accepted = await commands.storePut(ctx, pluginId, key, value, newValueBytes);

    return reply.code(202).send({
      data: {
        key,
        value,
        sizeBytes: newValueBytes,
        status: accepted.status,
        correlationId: accepted.correlationId,
      },
    });
  });

  app.delete("/v1/plugins/:pluginId/store/:key", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { pluginId, key } = storeKeyParams.parse(req.params);

    const entry = await repo.getEntry(ctx.tenantId, pluginId, key);
    if (!entry) {
      throw new HttpError(404, "NOT_FOUND", `store key "${key}" not found`);
    }

    const accepted = await commands.storeDelete(ctx, pluginId, key);

    return reply.code(202).send({
      data: { key, status: accepted.status, correlationId: accepted.correlationId },
    });
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
