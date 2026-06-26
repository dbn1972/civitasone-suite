import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
/**
 * tenant module HTTP routes (Fastify plugin).
 * Middleware order: correlationId → auth → authz → zod validate → handler.
 * Writes return 202 (command accepted, applied async). Reads return 200 from cache.
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createTenantBody, updateTenantBody, suspendTenantBody, tenantIdParam, onboardTenantBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { createTenantPipeline } from "./onboard.js";

const PLATFORM_ADMIN = ["platform_admin", "super_admin"];

export async function tenantRoutes(app: FastifyInstance): Promise<void> {
  // CREATE — provider/superadmin only
  app.post("/v1/tenants", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const body = createTenantBody.parse(req.body);
    const res = await commands.createTenant(ctx, body);
    return sendAccepted(reply, acceptedResponseSchema, res);
  });

  // READ — any authenticated actor in the tenant (cache-first)
  app.get("/v1/tenants/:tenantId", async (req, reply) => {
    const ctx = resolveContext(req);
    const { tenantId } = tenantIdParam.parse(req.params);
    const view = await queries.getTenant(tenantId);
    if (!view) throw new HttpError(404, "NOT_FOUND", "tenant not found");
    // cross-tenant read guard (break-glass excluded for brevity)
    if (ctx.tenantId !== tenantId && !ctx.roles.some((r) => PLATFORM_ADMIN.includes(r))) {
      throw new HttpError(403, "FORBIDDEN", "cross-tenant access denied");
    }
    return reply.send(view);
  });

  // UPDATE
  app.patch("/v1/tenants/:tenantId", async (req, reply) => {
    const ctx = resolveContext(req);
    const { tenantId } = tenantIdParam.parse(req.params);
    requireRole(ctx, [...PLATFORM_ADMIN, "tenant_admin"]);
    const body = updateTenantBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateTenant(ctx, tenantId, body));
  });

  // SUSPEND — provider/superadmin only
  app.post("/v1/tenants/:tenantId/suspend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const { tenantId } = tenantIdParam.parse(req.params);
    const body = suspendTenantBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.suspendTenant(ctx, tenantId, body));
  });

  /**
   * ONBOARD — full automated tenant onboarding pipeline (P0 gap fix).
   *
   * Single HTTP call that:
   *   1. Creates the tenant record (draft)
   *   2. Publishes onboard command → activates tenant → emits tenant.tenant.onboarded
   *   3. finance-worker seeds chart-of-accounts (budget.finance_major_heads)
   *   4. identity-worker provisions the first-admin Keycloak user
   *
   * Returns 202 with the tenantId and correlationId. Poll GET /v1/tenants/:tenantId
   * to check when status transitions from draft → active.
   *
   * Platform-admin only (same gate as POST /v1/tenants).
   */
  app.post("/v1/tenant/onboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const body = onboardTenantBody.parse(req.body);
    const result = await createTenantPipeline(ctx, body);
    return reply.code(202).send(result);
  });

  // uniform error envelope (CLAUDE.md / ARCHITECTURE §6)
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
