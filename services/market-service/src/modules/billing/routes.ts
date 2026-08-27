import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as allotmentsRepo from "../allotments/repo.js";
import { LIFECYCLE_ACTIONABLE_STATUSES } from "../allotments/domain.js";
import * as commands from "./commands.js";
import { canTransition } from "./domain.js";

const USER_ROLES = ["market_user", "market_admin", "super_admin"];
const ADMIN_ROLES = ["market_admin", "super_admin"];

// amountMinor/lateFeeMinor deliberately NOT accepted from the client anymore —
// see the POST handler below for why (this was the headline money bug: the
// amount had zero relationship to the allotment's actual monthlyRentMinor,
// and could be billed even for an allotment with no active agreement).
const generateBody = z.object({
  allotmentId: z.string().uuid(),
  demandMonth: z.string().regex(/^\d{4}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const payBody = z.object({
  paymentRef: z.string().min(1),
});

const allotmentParam = z.object({ allotmentId: z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/market/demands", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = generateBody.parse(req.body);
    // CRITICAL fix, the money bug: amountMinor was previously taken verbatim
    // from the request with ZERO cross-check against the allotment's actual
    // monthlyRentMinor — any market_admin could bill any amount for any
    // allotment. Derive it server-side from the real, contracted rent instead.
    const allotment = await allotmentsRepo.findById(body.allotmentId, ctx.tenantId);
    if (!allotment) throw new HttpError(404, "ALLOTMENT_NOT_FOUND", "Allotment not found");
    // Also answers "can billing be generated for an allotment with no active
    // agreement?" — previously yes (no check existed at all).
    if (!LIFECYCLE_ACTIONABLE_STATUSES.includes(allotment.status)) {
      throw new HttpError(422, "ALLOTMENT_NOT_ACTIVE", `Allotment is in status '${allotment.status}', not eligible for billing`);
    }
    if (allotment.monthlyRentMinor == null) {
      throw new HttpError(422, "RENT_NOT_CONFIGURED", "Allotment has no monthlyRentMinor configured");
    }
    // Prevents double-billing the same allotment for the same month (via admin
    // error, client retry with a fresh idempotency key, or a race) — nothing
    // in the schema or the old consumer prevented this.
    const existingDemand = await repo.findByAllotmentAndMonth(body.allotmentId, ctx.tenantId, body.demandMonth);
    if (existingDemand) {
      throw new HttpError(409, "DEMAND_ALREADY_EXISTS", `A demand for ${body.demandMonth} already exists on this allotment`);
    }
    return reply.code(202).send(await commands.generateDemand(ctx, {
      ...body,
      amountMinor: allotment.monthlyRentMinor.toString(),
      // lateFeeMinor is no longer client-settable at generation time — it
      // never made semantic sense before the due date has even passed. A real
      // "mark demand overdue and apply late fee" job is a separate, unbuilt
      // feature (flagged in the PR description), not something to fake here.
    }));
  });

  app.get("/v1/market/allotments/:allotmentId/demands", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { allotmentId } = allotmentParam.parse(req.params);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listByAllotment(allotmentId, ctx.tenantId, q);
    return reply.send({
      data: rows,
      meta: { page: q.page ?? 1, pageSize: q.pageSize ?? 20, total },
    });
  });

  app.post("/v1/market/demands/:id/pay", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = payBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "DEMAND_NOT_FOUND", "Demand not found");
    if (!canTransition(existing.status, "paid")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot pay demand in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.recordPayment(ctx, id, body.paymentRef));
  });

  app.post("/v1/market/demands/:id/waive", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "DEMAND_NOT_FOUND", "Demand not found");
    // Re-review fix: this checked canTransition(status, "paid") — the WRONG
    // target status for a waive action (copy-paste from the /pay handler
    // above). Masked today only because "paid" and "waived" happen to share
    // the exact same valid-from set in every current entry of VALID_TRANSITIONS
    // (domain.ts) — this would silently diverge the moment that table stops
    // being symmetric between the two target statuses.
    if (!canTransition(existing.status, "waived")) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot waive demand in status '${existing.status}'`);
    }
    return reply.code(202).send(await commands.waiveDemand(ctx, id));
  });
}
