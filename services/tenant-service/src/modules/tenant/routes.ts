import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
/**
 * tenant module HTTP routes (Fastify plugin).
 * Middleware order: correlationId → auth → authz → zod validate → handler.
 * Writes return 202 (command accepted, applied async). Reads return 200 from cache.
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  resolveContext,
  requireRole,
  HttpError,
} from "../../shared/context.js";
import {
  createTenantBody,
  updateTenantBody,
  suspendTenantBody,
  tenantIdParam,
  onboardTenantBody,
  setIsolationBody,
  updateQuotasBody,
  msmeOnboardBody,
} from "./validators.js";
import { randomUUID } from "node:crypto";
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

  // READ — the current actor's own tenant (resolved from the session).
  // Static path registered before the parametric :tenantId route. Powers the
  // setup wizard's org-profile completion check.
  app.get("/v1/tenants/current", async (req, reply) => {
    const ctx = resolveContext(req);
    if (!ctx.tenantId)
      throw new HttpError(401, "UNAUTHENTICATED", "no tenant in context");
    const view = await queries.getTenant(ctx.tenantId);
    if (!view) throw new HttpError(404, "NOT_FOUND", "tenant not found");
    return reply.send(view);
  });

  // READ — any authenticated actor in the tenant (cache-first)
  app.get("/v1/tenants/:tenantId", async (req, reply) => {
    const ctx = resolveContext(req);
    const { tenantId } = tenantIdParam.parse(req.params);
    const view = await queries.getTenant(tenantId);
    if (!view) throw new HttpError(404, "NOT_FOUND", "tenant not found");
    // cross-tenant read guard (break-glass excluded for brevity)
    if (
      ctx.tenantId !== tenantId &&
      !ctx.roles.some((r) => PLATFORM_ADMIN.includes(r))
    ) {
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
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.updateTenant(ctx, tenantId, body),
    );
  });

  // SET ISOLATION TIER — provider/superadmin only (pool ↔ silo)
  app.patch("/v1/tenants/:tenantId/isolation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const { tenantId } = tenantIdParam.parse(req.params);
    const body = setIsolationBody.parse(req.body);
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.setIsolation(ctx, tenantId, body),
    );
  });

  // SUSPEND — provider/superadmin only
  app.post("/v1/tenants/:tenantId/suspend", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const { tenantId } = tenantIdParam.parse(req.params);
    const body = suspendTenantBody.parse(req.body);
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.suspendTenant(ctx, tenantId, body),
    );
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

  // ── Tenant Quotas ──────────────────────────────────────────────────

  /** GET /v1/tenant/:tenantId/quotas — returns current quotas (any authenticated user in tenant). */
  app.get("/v1/tenant/:tenantId/quotas", async (req, reply) => {
    const ctx = resolveContext(req);
    const { tenantId } = tenantIdParam.parse(req.params);
    // Cross-tenant guard
    if (
      ctx.tenantId !== tenantId &&
      !ctx.roles.some((r) => PLATFORM_ADMIN.includes(r))
    ) {
      throw new HttpError(403, "FORBIDDEN", "cross-tenant access denied");
    }
    const quotas = await queries.getQuotas(tenantId);
    return reply.send(quotas);
  });

  /** PATCH /v1/tenant/:tenantId/quotas — updates quotas (super_admin only). */
  app.patch("/v1/tenant/:tenantId/quotas", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["super_admin"]);
    const { tenantId } = tenantIdParam.parse(req.params);
    const body = updateQuotasBody.parse(req.body);
    const res = await commands.upsertTenantQuotas(ctx, tenantId, body);
    return sendAccepted(reply, acceptedResponseSchema, res);
  });

  /**
   * POST /v1/tenant/msme-onboard — MSME self-signup (public, no auth required).
   *
   * Accepts Udyam number + basic info, creates a tenant with:
   * - edition: "small_office"
   * - settings.msme: { udyamNumber, category, sector, nicCode, gstin }
   * - Default quotas applied
   * - Sector-based modules auto-configured
   *
   * In production, this would validate the Udyam number against the MSME portal API.
   * For now, it accepts the self-declared classification.
   */
  // SEC/FUNC fix: this route is documented as public self-signup (see doc
  // comment above) but was never marked public in Fastify's route options.
  // The global auth plugin (packages/auth/src/plugin.ts) requires a Bearer
  // token on every route that is not in PUBLIC_PATHS or does not carry
  // `config.public === true` — so every real MSME self-signup request (which
  // by definition has no token yet) was silently rejected with 401 before
  // ever reaching this handler. The handler itself never reads req.ctx (it
  // builds its own local ctx for the onboarding pipeline below), so marking
  // this route public is safe and changes no authorization behavior.
  // SEC (deep-verification, 2026-08-27): this is the one route in the service
  // reachable without authentication. It is covered by the service-wide rate
  // limit registered in app.ts (300/min, keyed by actor-or-IP) -- real
  // protection, but not tuned for this specific endpoint. A much stricter
  // per-route override was attempted here but @fastify/rate-limit's per-route
  // config shape produced 500s under test instead of clean 429s, and this
  // pass didn't have doc access to safely resolve the exact expected shape --
  // reverted to the working service-wide limit rather than ship something
  // broken. Follow-up (flagged, not built here): a properly-tested, much
  // stricter per-route budget for this endpoint specifically, plus real
  // abuse-prevention (CAPTCHA / Udyam-number verification against the
  // government registry).
  app.post(
    "/v1/tenant/msme-onboard",
    { config: { public: true } },
    async (req, reply) => {
      const body = msmeOnboardBody.parse(req.body);

      // In production: validate udyamNumber against https://udyamregistration.gov.in/
      // For now: trust the self-declaration (Udyam format: UDYAM-XX-XX-XXXXXXX)

      const tenantId = randomUUID();
      const domain =
        body.businessName
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .slice(0, 30) + ".civitasone.in";

      // Create tenant via the same pipeline as admin onboarding (queue-first).
      const ctx = {
        tenantId,
        actorId: tenantId,
        correlationId: randomUUID(),
        roles: ["owner"],
      } as unknown as import("@civitasone/types").RequestContext;
      const result = await createTenantPipeline(ctx, {
        name: body.businessName,
        domain,
        edition: "small_office",
        region: body.state ?? "IN",
        residency: "IN",
        adminEmail: body.email,
        adminName: body.ownerName,
        settings: {
          msme: {
            udyamNumber: body.udyamNumber,
            category: body.category,
            sector: body.sector,
            nicCode: body.nicCode ?? null,
            gstin: body.gstin ?? null,
          },
        },
      });

      return reply.code(202).send({
        tenantId: result.tenantId,
        domain,
        edition: "small_office",
        sector: body.sector,
        status: "accepted",
        message:
          "MSME tenant accepted. Login with the email provided once provisioning completes.",
      });
    },
  );

  // uniform error envelope (CLAUDE.md / ARCHITECTURE §6)
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({
        code: err.code,
        message: err.message,
        correlationId,
        retryable: false,
      });
    }
    // FIX (independent review, PR #780): this handler previously only
    // recognized ZodError/HttpError and demoted anything else -- including a
    // real, correctly-triggered 429 from @fastify/rate-limit (registered
    // service-wide in app.ts) -- to a generic 500. The limiter itself works
    // (verified: the 301st request in a 1-minute window is genuinely
    // rejected), but callers got an opaque 500 instead of a proper 429 with
    // Retry-After, which breaks well-behaved retry logic and misreports a
    // client-rate-limit condition as a server fault. @fastify/rate-limit
    // (and Fastify's own built-in errors) set a numeric `statusCode` on the
    // thrown error; pass those through as-is instead of falling through to
    // the generic branch below.
    const statusCode = (err as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      const body = (err as { code?: string; error?: string; message?: string; retryAfter?: number });
      return reply.code(statusCode).send({
        code: body.code ?? body.error ?? "CLIENT_ERROR",
        message: body.message ?? err.message ?? "request rejected",
        correlationId,
        retryable: statusCode === 429,
        ...(typeof body.retryAfter === "number" ? { retryAfter: body.retryAfter } : {}),
      });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({
      code: "INTERNAL",
      message: "internal error",
      correlationId,
      retryable: true,
    });
  });
}
