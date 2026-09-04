import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { zMoneyMinorStringNonNeg } from "@civitasone/schemas";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { validateBookingTransition, type BookingStatus } from "./domain.js";
import * as commands from "./commands.js";

const ROLES = ["sewerage_user", "sewerage_admin", "super_admin"];
const ADMIN_ROLES = ["sewerage_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().optional(),
});

const bookBody = z.object({
  address: z.record(z.unknown()).optional(),
  tankCapacityLitres: z.number().int().positive().optional(),
  requestedDate: z.string().optional(),
  requestedSlot: z.string().max(24).optional(),
  // R7 money codec — see billing/routes.ts's amountMinor comment for the
  // full rationale (same fix, same bug class: the old
  // `z.number().int().nonnegative()` had no `.max()`).
  //
  // The codec itself is bounded only by Postgres bigint range (by design —
  // see shared/cross-events.ts's no-ceiling rationale). Structurally this
  // field stays optional in the body schema for BOTH roles, but the handler
  // below additionally requires ADMIN_ROLES to actually supply a value —
  // see the comment there for why.
  feeMinor: zMoneyMinorStringNonNeg.optional(),
});

const scheduleBody = z.object({ vehicleId: z.string().min(1), version: z.number().int().positive() });
const transitionBody = z.object({ version: z.number().int().positive() });

export async function desludgingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/sewerage/desludging", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = bookBody.parse(req.body);
    // SECURITY: unlike billing/routes.ts's POST /v1/sewerage/bills (already
    // ADMIN_ROLES-only end to end), this route is reachable by a plain
    // citizen (ROLES includes sewerage_user) — and, unlike shop-service's
    // calculateFeeMinor, nothing here derives feeMinor server-side from a
    // bounded input; it is the raw request-body value, checked only by the
    // zMoneyMinorStringNonNeg codec (non-negative, Postgres-bigint-range).
    // Since desludging/consumer.ts's desludgingBook turns a non-null
    // feeMinor straight into a real emitMunicipalFeeChallan → finance GL
    // journal entry, letting a citizen set it would let them dictate their
    // own municipal fee, unbounded, back-linked to their own booking.
    //
    // In real desludging/septage-management practice the fee is fixed by
    // the ULB's tariff (per tanker-load / tank capacity) and confirmed by
    // the inspecting/dispatching officer, never citizen-declared — this
    // service has no tariff schedule anywhere in its schema to validate a
    // citizen-supplied amount against, so the correct fix mirrors billing's
    // own boundary rather than inventing an arbitrary ceiling: a citizen
    // may only REQUEST desludging (feeMinor omitted); only an officer/admin
    // may set it — e.g. a dispatcher pre-quoting the tariff amount when
    // booking on a citizen's behalf, or amending a citizen's own request
    // before it is scheduled.
    if (body.feeMinor !== undefined) requireRole(ctx, ADMIN_ROLES);
    return reply.code(202).send(await commands.bookDesludging(ctx, {
      address: body.address ?? null, tankCapacityLitres: body.tankCapacityLitres ?? null,
      requestedDate: body.requestedDate ?? null, requestedSlot: body.requestedSlot ?? null,
      feeMinor: body.feeMinor ?? null,
    }));
  });

  app.get("/v1/sewerage/desludging", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, q.status);
    return reply.send({ data: rows.map(repo.toView), meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total } });
  });

  app.get("/v1/sewerage/desludging/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const booking = await repo.findById(id, ctx.tenantId);
    if (!booking) throw new HttpError(404, "NOT_FOUND", "booking not found");
    return reply.send({ data: repo.toView(booking) });
  });

  app.post("/v1/sewerage/desludging/:id/schedule", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = scheduleBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "booking not found");
    const err = validateBookingTransition(existing.status as BookingStatus, "scheduled");
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.scheduleDesludging(ctx, id, body.vehicleId, body.version));
  });

  app.post("/v1/sewerage/desludging/:id/dispatch", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transitionBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "booking not found");
    const err = validateBookingTransition(existing.status as BookingStatus, "dispatched");
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.dispatchDesludging(ctx, id, body.version));
  });

  app.post("/v1/sewerage/desludging/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transitionBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "booking not found");
    const err = validateBookingTransition(existing.status as BookingStatus, "completed");
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.completeDesludging(ctx, id, body.version));
  });

  app.post("/v1/sewerage/desludging/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const body = transitionBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "booking not found");
    const err = validateBookingTransition(existing.status as BookingStatus, "cancelled");
    if (err) throw new HttpError(422, "TRANSITION_INVALID", err);
    if (body.version !== existing.version) throw new HttpError(409, "VERSION_CONFLICT", "retry with current version");
    return reply.code(202).send(await commands.cancelDesludging(ctx, id, body.version));
  });
}
