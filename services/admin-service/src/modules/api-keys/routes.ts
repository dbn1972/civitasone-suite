import type { FastifyInstance } from "fastify";
import { scryptSync, randomBytes, timingSafeEqual, createHash, randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { z } from "zod";
import { APIKeySummaryListSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { listQuerySchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { disallowedScopes } from "./scopes.js";

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
  // SEC REM-05: memory-hard KDF replacing fast SHA-256. Format: "scrypt:<hex-salt>:<hex-hash>".
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(secret, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyKey(secret: string, stored: string): boolean {
  // Backward compat: legacy SHA-256 hashes (no "scrypt:" prefix) during rotation window.
  if (!stored.startsWith("scrypt:")) {
    const legacy = createHash("sha256").update(secret).digest("hex");
    return timingSafeEqual(Buffer.from(stored, "hex"), Buffer.from(legacy, "hex"));
  }
  const parts = stored.split(":");
  if (parts.length !== 3 || !parts[1] || !parts[2]) return false;
  const [, salt, storedHash] = parts;
  const candidate = scryptSync(secret, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS).toString("hex");
  return timingSafeEqual(Buffer.from(storedHash, "hex"), Buffer.from(candidate, "hex"));
}

function newRawKey(): { raw: string; keyPrefix: string } {
  const raw = `civ_${randomBytes(24).toString("base64url")}`;
  return { raw, keyPrefix: raw.slice(0, 12) };
}

function auditKey(actorId: string, tenantId: string, correlationId: string, action: string, resourceId: string) {
  return {
    topic: "audit.event.record",
    eventType: "audit.event.record",
    tenantId,
    actorId,
    correlationId,
    payload: { service: "admin", action, resourceType: "api_key", resourceId, outcome: "success" },
  };
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
    // P1-5: reject any requested scope the caller's role is not allowed to grant.
    const denied = disallowedScopes(ctx, body.scopes);
    if (denied.length > 0) {
      throw new HttpError(403, "SCOPE_FORBIDDEN", `cannot grant scopes: ${denied.join(", ")}`);
    }
    const { raw, keyPrefix } = newRawKey();
    const id = randomUUID();
    await db.transaction(async (tx) => {
      const row = {
        id,
        tenantId: ctx.tenantId,
        keyName: body.keyName,
        keyPrefix,
        keyHash: hashKey(raw),
        scopes: body.scopes,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
        ...(body.expiresAt ? { expiresAt: new Date(body.expiresAt) } : {}),
      };
      await repo.insertKey(tx, row);
      await enqueue(tx, auditKey(ctx.actorId, ctx.tenantId, ctx.correlationId, "api_key_create", id));
    });
    await cache.invalidateResource(ctx.tenantId, "api_keys");
    // P1-5: the raw secret is returned exactly once; only its hash is persisted.
    return reply.code(201).send({ id, key: raw, keyPrefix, status: "active" });
  });

  app.patch("/v1/admin/api-keys/:id/rotate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "api key not found");
    if (existing.status === "revoked") throw new HttpError(409, "REVOKED", "cannot rotate a revoked key");
    const { raw, keyPrefix } = newRawKey();
    await db.transaction(async (tx) => {
      await repo.rotateKey(tx, id, ctx.tenantId, keyPrefix, hashKey(raw), ctx.actorId);
      await enqueue(tx, auditKey(ctx.actorId, ctx.tenantId, ctx.correlationId, "api_key_rotate", id));
    });
    await cache.invalidateResource(ctx.tenantId, "api_keys");
    // P1-5: rotation returns the new raw secret once; the previous key stops working.
    return reply.send({ id, key: raw, keyPrefix, status: "active" });
  });

  app.patch("/v1/admin/api-keys/:id/revoke", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "api key not found");
    await repo.revokeKey(id, ctx.tenantId, ctx.actorId);
    await cache.invalidateResource(ctx.tenantId, "api_keys");
    return reply.send({ id, status: "revoked" });
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
