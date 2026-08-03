import type { FastifyInstance } from "fastify";
import { scryptSync, randomBytes, randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { z } from "zod";
import { APIKeySummaryListSchema } from "@civitasone/schemas/web";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import { disallowedScopes } from "./scopes.js";
import * as commands from "./commands.js";

const ADMIN_ROLES = ["platform_admin", "super_admin", "tenant_admin"];
const idParam = z.object({ id: z.string().uuid() });
const createBody = z.object({
  keyName: z.string().min(1).max(120),
  scopes: z.array(z.string().min(1).max(80)).default([]),
  expiresAt: z.string().datetime().optional(),
});

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const SCRYPT_KEYLEN = 64;

function hashKey(secret: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(secret, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function newRawKey(): { raw: string; keyPrefix: string } {
  const raw = `civ_${randomBytes(24).toString("base64url")}`;
  return { raw, keyPrefix: raw.slice(0, 12) };
}

export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/api-keys", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, APIKeySummaryListSchema, await queries.listApiKeys(ctx.tenantId, q.limit));
  });

  app.post("/v1/admin/api-keys", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);
    const denied = disallowedScopes(ctx, body.scopes);
    if (denied.length > 0) {
      throw new HttpError(403, "SCOPE_FORBIDDEN", `cannot grant scopes: ${denied.join(", ")}`);
    }
    const { raw, keyPrefix } = newRawKey();
    const id = randomUUID();
    const accepted = await commands.createApiKey(ctx, id, {
      keyName: body.keyName,
      keyPrefix,
      keyHash: hashKey(raw),
      scopes: body.scopes,
      ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
    });
    // Raw secret returned once with 202; only the hash is persisted by the consumer.
    return reply.code(202).send({
      id: accepted.id,
      status: "accepted",
      correlationId: accepted.correlationId,
      key: raw,
      keyPrefix,
    });
  });

  app.patch("/v1/admin/api-keys/:id/rotate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "api key not found");
    if (existing.status === "revoked") throw new HttpError(409, "REVOKED", "cannot rotate a revoked key");
    const { raw, keyPrefix } = newRawKey();
    const accepted = await commands.rotateApiKey(ctx, id, { keyPrefix, keyHash: hashKey(raw) });
    return reply.code(202).send({
      id: accepted.id,
      status: "accepted",
      correlationId: accepted.correlationId,
      key: raw,
      keyPrefix,
    });
  });

  app.patch("/v1/admin/api-keys/:id/revoke", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "api key not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.revokeApiKey(ctx, id));
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
