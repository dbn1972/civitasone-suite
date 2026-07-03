/**
 * activation routes — ingest + read the golden-path funnel (durable).
 *
 *   POST /v1/analytics/activation/events   — record one milestone for the
 *        caller's office (tenant from the session; never trusted from the body).
 *   GET  /v1/analytics/activation/funnel   — the office's activation events, for
 *        the web to aggregate into TTFRT + drop-off.
 *
 * Any authenticated user may record/read their own office's funnel; tenant
 * isolation is enforced by the session-derived tenantId (and DB RLS).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { registerErrorHandler } from "../../shared/errors.js";
import * as repo from "./repo.js";

const PLATFORM_ADMIN = ["platform_admin", "super_admin"];

const FUNNEL_STEPS = [
  "signin",
  "wizard_opened",
  "org-profile",
  "branches",
  "departments",
  "people",
  "modules",
  "first_transaction",
] as const;

const activationEventSchema = z.object({
  step: z.enum(FUNNEL_STEPS),
}).strict();

export async function activationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/analytics/activation/events", async (req, reply) => {
    const ctx = resolveContext(req);
    if (!ctx.tenantId) throw new HttpError(401, "UNAUTHENTICATED", "no tenant in context");
    const { step } = activationEventSchema.parse(req.body);
    await repo.recordActivation(ctx.tenantId, step);
    return reply.code(202).send({ status: "accepted" });
  });

  app.get("/v1/analytics/activation/funnel", async (req, reply) => {
    const ctx = resolveContext(req);
    if (!ctx.tenantId) throw new HttpError(401, "UNAUTHENTICATED", "no tenant in context");
    const events = await repo.listActivation(ctx.tenantId);
    return reply.send({ tenantId: ctx.tenantId, events });
  });

  // Platform-wide funnel across ALL offices — platform admins only.
  app.get("/v1/analytics/activation/funnel/platform", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const events = await repo.listActivationAllTenants();
    return reply.send({ scope: "platform", events });
  });

  registerErrorHandler(app);
}
