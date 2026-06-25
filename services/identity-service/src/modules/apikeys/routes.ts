import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  issueApiKeyBody, rotateApiKeyBody, revokeApiKeyBody, verifyApiKeyBody,
  apiKeyIdParam, listQuery,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  // Issue — returns the plaintext key exactly once.
  app.post("/identity/api-keys", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = issueApiKeyBody.parse(req.body);
    const result = await commands.issueApiKey(ctx, body);
    return reply.code(201).send(result);
  });

  app.get("/identity/api-keys", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const q = listQuery.parse(req.query);
    return reply.send(await queries.listApiKeys(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/identity/api-keys/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = apiKeyIdParam.parse(req.params);
    const view = await queries.getApiKey(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "api key not found");
    return reply.send(view);
  });

  // Rotate — new secret for same id; previous secret invalidated immediately.
  app.post("/identity/api-keys/:id/rotate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = apiKeyIdParam.parse(req.params);
    const body = rotateApiKeyBody.parse(req.body ?? {});
    const result = await commands.rotateApiKey(ctx, id, body.reason);
    return reply.code(200).send(result);
  });

  // Revoke — terminal + idempotent.
  app.delete("/identity/api-keys/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = apiKeyIdParam.parse(req.params);
    const body = revokeApiKeyBody.parse(req.body ?? {});
    return reply.send(await commands.revokeApiKey(ctx, id, body.reason));
  });

  // Verify — internal introspection used by other services / gateways to
  // validate a presented key + scope. Admin/internal-gated.
  app.post("/identity/api-keys/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = verifyApiKeyBody.parse(req.body);
    const result = await commands.verifyApiKey(body.key, body.requiredScope);
    // tenant isolation: a verified key from another tenant must not be treated
    // as valid for the caller's tenant.
    if (result.valid && result.tenantId && result.tenantId !== ctx.tenantId) {
      return reply.send({ valid: false, reason: "cross-tenant key" });
    }
    return reply.send(result);
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
