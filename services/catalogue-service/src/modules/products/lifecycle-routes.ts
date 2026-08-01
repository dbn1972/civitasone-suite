/**
 * PC-002 — product lifecycle states on catalogue.product_lifecycle.
 * Transition legality is decided by the PURE state machine in lifecycle-domain.ts,
 * whose state set is copied verbatim from the migration's CHECK constraint.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as productRepo from "./repo.js";
import * as repo from "./governance-repo.js";
import {
  PRODUCT_LIFECYCLE_STATES,
  validateLifecycleTransition,
  nextLifecycleStates,
} from "./lifecycle-domain.js";

const READ_ROLES = ["catalogue_user", "catalogue_admin", "catalogue_approver", "super_admin"];
const WRITE_ROLES = ["catalogue_admin", "super_admin"];

const idParam = z.object({ id: z.string().uuid() });

const transitionBody = z.object({
  state: z.enum(PRODUCT_LIFECYCLE_STATES),
  reason: z.string().max(2000).optional(),
  effectiveFrom: z.string().datetime().optional(),
});

export async function productLifecycleRoutes(app: FastifyInstance): Promise<void> {
  // ─── Current state + full history ────────────────────────────────────────────
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

  // ─── Transition state ────────────────────────────────────────────────────────
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

    const rowId = randomUUID();
    const effectiveFrom = body.effectiveFrom !== undefined ? new Date(body.effectiveFrom) : new Date();

    await db.transaction(async (tx) => {
      await repo.insertLifecycle(tx, {
        id: rowId,
        tenantId: ctx.tenantId,
        productId: id,
        state: body.state,
        effectiveFrom,
        reason: body.reason ?? null,
        createdBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.productLifecycleChanged,
        eventType: EVENTS.productLifecycleChanged,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          productId: id,
          lifecycleId: rowId,
          fromState: current?.state ?? null,
          toState: body.state,
          effectiveFrom: effectiveFrom.toISOString(),
          ...(body.reason !== undefined ? { reason: body.reason } : {}),
        },
      });
    });

    return reply.code(202).send({
      data: { id: rowId, productId: id, fromState: current?.state ?? null, state: body.state },
    });
  });
}
