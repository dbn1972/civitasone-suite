/**
 * PC-002 — product lifecycle states. Mutations publish commands and return 202.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as productRepo from "./repo.js";
import * as repo from "./governance-repo.js";
import {
  PRODUCT_LIFECYCLE_STATES,
  validateLifecycleTransition,
  nextLifecycleStates,
} from "./lifecycle-domain.js";
import * as commands from "./commands.js";

const READ_ROLES = ["catalogue_user", "catalogue_admin", "catalogue_approver", "super_admin"];
const WRITE_ROLES = ["catalogue_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const transitionBody = z.object({
  state: z.enum(PRODUCT_LIFECYCLE_STATES),
  reason: z.string().max(2000).optional(),
  effectiveFrom: z.string().datetime().optional(),
});

export async function productLifecycleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/catalogue/products/:id/lifecycle", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const product = await productRepo.findById(id, ctx.tenantId);
    if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");
    const history = await repo.listLifecycleHistory(id, ctx.tenantId);
    const current = history[0] ?? null;
    return reply.send({
      data: {
        productId: id,
        currentState: current?.state ?? null,
        effectiveFrom: current?.effectiveFrom ?? null,
        allowedNextStates: nextLifecycleStates(current?.state ?? ""),
        history,
      },
    });
  });

  app.post("/v1/catalogue/products/:id/lifecycle", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transitionBody.parse(req.body);
    const product = await productRepo.findById(id, ctx.tenantId);
    if (!product) throw new HttpError(404, "NOT_FOUND", "Product not found");
    const current = await repo.findCurrentLifecycle(id, ctx.tenantId);
    const check = validateLifecycleTransition(current?.state ?? null, body.state);
    if (!check.valid) {
      throw new HttpError(422, "INVALID_LIFECYCLE_TRANSITION", check.reason ?? "Invalid lifecycle transition");
    }
    const lifecycleId = randomUUID();
    const effectiveFrom = body.effectiveFrom !== undefined ? new Date(body.effectiveFrom) : new Date();
    return reply.code(202).send(
      await commands.transitionProductLifecycle(ctx, id, {
        lifecycleId,
        fromState: current?.state ?? null,
        toState: body.state,
        effectiveFrom: effectiveFrom.toISOString(),
        reason: body.reason ?? null,
      }),
    );
  });
}
