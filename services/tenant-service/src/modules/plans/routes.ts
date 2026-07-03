/**
 * Plans module HTTP routes (Fastify plugin).
 * Writes return 202. Reads return 200 from cache.
 */
import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createPlanBody, updatePlanBody, planIdParam } from "./validators.js";
import * as commands from "./commands.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

const PLATFORM_ADMIN = ["platform_admin", "super_admin"];
const RESOURCE = "plan";

export async function planRoutes(app: FastifyInstance): Promise<void> {
  // CREATE plan — platform admin only
  app.post("/v1/plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const body = createPlanBody.parse(req.body);
    const res = await commands.planCreate(ctx, body);
    return sendAccepted(reply, acceptedResponseSchema, res);
  });

  // LIST all plans
  app.get("/v1/plans", async (req, reply) => {
    resolveContext(req); // auth required
    const plans = await repo.findAll();
    return reply.send(plans);
  });

  // GET single plan by id (cache-first)
  app.get("/v1/plans/:planId", async (req, reply) => {
    const ctx = resolveContext(req);
    const { planId } = planIdParam.parse(req.params);
    const view = await cache.getOrLoad(
      cache.makeKey(ctx.tenantId, RESOURCE, planId),
      async () => repo.findById(planId),
    );
    if (!view) throw new HttpError(404, "NOT_FOUND", "plan not found");
    return reply.send(view);
  });

  // UPDATE plan — platform admin only
  app.patch("/v1/plans/:planId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const { planId } = planIdParam.parse(req.params);
    const body = updatePlanBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.planUpdate(ctx, planId, body));
  });
}
