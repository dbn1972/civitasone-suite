/**
 * G26 — slab discount schedule + delegation-limit routes.
 *
 *   POST   /v1/crm/discount-schedules              create an effective-dated rate card
 *   GET    /v1/crm/discount-schedules              list cards (filter by scope)
 *   GET    /v1/crm/discount-schedules/rate-card    the card in force for a scope as at a date,
 *                                                  with each slab's discounted unit price
 *   GET    /v1/crm/discount-schedules/{id}         one card with its slabs
 *   PATCH  /v1/crm/discount-schedules/{id}/close   end-date a card (optimistic lock)
 *   DELETE /v1/crm/discount-schedules/{id}         remove a card
 *   PUT    /v1/crm/delegation-limits               set a role's approval authority
 *   GET    /v1/crm/delegation-limits               the tenant's delegation chain
 *   GET    /v1/crm/delegation-limits/authority     preview the approval routing for a discount
 *   DELETE /v1/crm/delegation-limits/{id}          remove a limit
 *
 * CQRS: every write validates with zod, publishes a command and answers 202. Nothing here
 * touches Postgres for a write. Reads are synchronous and go through the module repo, which
 * reads through Redis.
 *
 * MONEY / RATES: thresholds and prices are decimal STRINGS of integer minor units on the
 * wire and BigInt in the domain. Discounts are integer basis points. No float anywhere.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { commandId } from "../../shared/idempotency.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import {
  SCOPE_TYPES,
  SLAB_BASES,
  MAX_DISCOUNT_BPS,
  buildRateCard,
  isEffectiveOn,
  isIsoDate,
  resolveApprovalAuthority,
  validateSlabs,
  windowsOverlap,
  type Slab,
} from "./domain.js";
import * as repo from "./repo.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

const idParam = z.object({ id: z.string().uuid() });

/**
 * A non-negative integer as a STRING. Thresholds and money never arrive as JSON numbers:
 * a value-basis threshold or a unit price above 2^53 would already be wrong by the time
 * zod saw it, and there is no way to detect that after the fact.
 */
const integerString = z
  .string()
  .regex(/^\d{1,25}$/, "must be a non-negative integer string");

const isoDate = z.string().refine(isIsoDate, "must be a YYYY-MM-DD date");

const slabBody = z.object({
  fromThreshold: integerString,
  toThreshold: integerString.nullable().optional(),
  discountBps: z.number().int().min(0).max(MAX_DISCOUNT_BPS),
});

const createScheduleBody = z.object({
  name: z.string().min(1).max(200),
  scopeType: z.enum(SCOPE_TYPES),
  scopeId: z.string().uuid(),
  basis: z.enum(SLAB_BASES).default("volume"),
  currency: z.string().length(3).default("INR"),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullable().optional(),
  enabled: z.boolean().default(true),
  slabs: z.array(slabBody).min(1).max(200),
});

const closeBody = z.object({
  effectiveTo: isoDate,
  expectedVersion: z.number().int().min(1),
});

const listSchedulesQuery = z.object({
  scopeType: z.enum(SCOPE_TYPES).optional(),
  scopeId: z.string().uuid().optional(),
  enabledOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const rateCardQuery = z.object({
  scopeType: z.enum(SCOPE_TYPES),
  scopeId: z.string().uuid(),
  /** Defaults to today, so a caller asking "what applies now" need not send a date. */
  asAt: isoDate.optional(),
  /** Optional gross unit price (minor units) so the card can show net prices. */
  unitPriceMinor: integerString.optional(),
  /** Optional measure (units, or minor units for a value basis) to pick one slab. */
  measure: integerString.optional(),
});

const limitBody = z.object({
  role: z.string().min(1).max(64),
  level: z.number().int().min(0).max(1000).default(0),
  maxDiscountBps: z.number().int().min(0).max(MAX_DISCOUNT_BPS),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullable().optional(),
  enabled: z.boolean().default(true),
});

const authorityQuery = z.object({
  discountBps: z.coerce.number().int().min(0).max(MAX_DISCOUNT_BPS),
  /** Whose authority to test; defaults to the caller's own roles. */
  role: z.string().min(1).max(64).optional(),
  asAt: isoDate.optional(),
});

/** UTC today as YYYY-MM-DD. The tenant's rate card is a calendar-day document. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function toDomainSlabs(slabs: ReadonlyArray<z.infer<typeof slabBody>>): Slab[] {
  return slabs.map((s) => ({
    fromThreshold: BigInt(s.fromThreshold),
    toThreshold: s.toThreshold === undefined || s.toThreshold === null ? null : BigInt(s.toThreshold),
    discountBps: s.discountBps,
  }));
}

export async function discountRoutes(app: FastifyInstance): Promise<void> {
  // ── schedules ─────────────────────────────────────────────────────────────

  app.post("/v1/crm/discount-schedules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createScheduleBody.parse(req.body);

    if (body.effectiveTo !== undefined && body.effectiveTo !== null && body.effectiveTo < body.effectiveFrom) {
      throw new HttpError(400, "INVALID_WINDOW", "effectiveTo must not precede effectiveFrom");
    }

    // Overlapping slabs are refused here, not resolved by a tie-break: two slabs covering
    // the same volume means the same quotation can price two ways depending on row order.
    const verdict = validateSlabs(toDomainSlabs(body.slabs));
    if (!verdict.ok) throw new HttpError(400, verdict.code, verdict.message);

    // Two cards in force for the same scope on the same day is the same ambiguity one level
    // up, so an overlapping WINDOW is refused too. 409, not 400: the request is well formed
    // and it is the existing state that conflicts with it.
    const proposed = { effectiveFrom: body.effectiveFrom, effectiveTo: body.effectiveTo ?? null };
    const existing = await repo.windowsForScope(ctx.tenantId, body.scopeType, body.scopeId, body.basis, body.currency);
    const clash = existing.find((w) => windowsOverlap(w, proposed));
    if (clash !== undefined) {
      throw new HttpError(
        409,
        "SCHEDULE_WINDOW_OVERLAP",
        `schedule ${clash.id} is already in force for this scope from ${clash.effectiveFrom}`,
      );
    }

    const id = commandId(ctx, `${COMMANDS.createDiscountSchedule}:${body.scopeType}:${body.scopeId}:${body.effectiveFrom}`);
    await queue.publish(COMMANDS.createDiscountSchedule, {
      messageId: id, type: COMMANDS.createDiscountSchedule, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: {
        id, tenantId: ctx.tenantId, name: body.name, scopeType: body.scopeType, scopeId: body.scopeId,
        basis: body.basis, currency: body.currency.toUpperCase(), effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo ?? null, enabled: body.enabled,
        slabs: body.slabs.map((s, i) => ({
          fromThreshold: BigInt(s.fromThreshold).toString(),
          toThreshold: s.toThreshold === undefined || s.toThreshold === null ? null : BigInt(s.toThreshold).toString(),
          discountBps: s.discountBps,
          ordinal: i,
        })),
      },
    });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.get("/v1/crm/discount-schedules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listSchedulesQuery.parse(req.query ?? {});
    const { rows, total } = await repo.list(
      ctx.tenantId,
      { scopeType: q.scopeType, scopeId: q.scopeId, enabledOnly: q.enabledOnly },
      q.limit,
      q.offset,
    );
    return reply.send({ data: rows, meta: { limit: q.limit, offset: q.offset, total } });
  });

  /**
   * The rate card in force for a scope as at a date — spec §25.2 J1/3.
   *
   * Registered before /:id so `rate-card` is not parsed as a uuid. When several cards are in
   * force (which the create route refuses to allow, but historical data may contain) the
   * most recently STARTED one wins, which is what "the current card" means.
   */
  app.get("/v1/crm/discount-schedules/rate-card", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = rateCardQuery.parse(req.query ?? {});
    const asAt = q.asAt ?? today();
    const candidates = await repo.effectiveForScope(ctx.tenantId, q.scopeType, q.scopeId, asAt);
    const schedule = candidates[0];
    if (schedule === undefined) {
      throw new HttpError(404, "NO_EFFECTIVE_SCHEDULE", `no discount schedule is in force for this scope on ${asAt}`);
    }
    const slabs = schedule.slabs.map(repo.toSlab);
    const unitPriceMinor = q.unitPriceMinor === undefined ? 0n : BigInt(q.unitPriceMinor);
    const card = buildRateCard(slabs, unitPriceMinor);
    const measure = q.measure === undefined ? null : BigInt(q.measure);
    const applicable = measure === null ? null : buildRateCard(
      slabs.filter((s) => measure >= s.fromThreshold && (s.toThreshold === null || measure < s.toThreshold)),
      unitPriceMinor,
    )[0] ?? null;
    return reply.send({
      data: {
        scheduleId: schedule.id, name: schedule.name, scopeType: schedule.scopeType,
        scopeId: schedule.scopeId, basis: schedule.basis, currency: schedule.currency,
        effectiveFrom: schedule.effectiveFrom, effectiveTo: schedule.effectiveTo,
        asAt, slabs: card, applicable,
      },
    });
  });

  app.get("/v1/crm/discount-schedules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const schedule = await repo.findById(ctx.tenantId, id);
    if (schedule === null) throw new HttpError(404, "NOT_FOUND", "discount schedule not found");
    return reply.send({ data: schedule });
  });

  app.patch("/v1/crm/discount-schedules/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = closeBody.parse(req.body);
    const schedule = await repo.findById(ctx.tenantId, id);
    if (schedule === null) throw new HttpError(404, "NOT_FOUND", "discount schedule not found");
    if (body.effectiveTo < schedule.effectiveFrom) {
      throw new HttpError(400, "INVALID_WINDOW", "effectiveTo must not precede the schedule's effectiveFrom");
    }
    if (body.expectedVersion !== schedule.version) {
      throw new HttpError(409, "VERSION_CONFLICT", `schedule is at version ${schedule.version}`);
    }
    const msgId = commandId(ctx, `${COMMANDS.closeDiscountSchedule}:${id}`);
    await queue.publish(COMMANDS.closeDiscountSchedule, {
      messageId: msgId, type: COMMANDS.closeDiscountSchedule, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, effectiveTo: body.effectiveTo, expectedVersion: body.expectedVersion },
    });
    return reply.code(202).send({ id: msgId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.delete("/v1/crm/discount-schedules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const schedule = await repo.findById(ctx.tenantId, id);
    if (schedule === null) throw new HttpError(404, "NOT_FOUND", "discount schedule not found");
    const msgId = commandId(ctx, `${COMMANDS.deleteDiscountSchedule}:${id}`);
    await queue.publish(COMMANDS.deleteDiscountSchedule, {
      messageId: msgId, type: COMMANDS.deleteDiscountSchedule, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId },
    });
    return reply.code(202).send({ id: msgId, status: "accepted", correlationId: ctx.correlationId });
  });

  // ── delegation limits ─────────────────────────────────────────────────────

  app.put("/v1/crm/delegation-limits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = limitBody.parse(req.body);
    if (body.effectiveTo !== undefined && body.effectiveTo !== null && body.effectiveTo < body.effectiveFrom) {
      throw new HttpError(400, "INVALID_WINDOW", "effectiveTo must not precede effectiveFrom");
    }
    const id = commandId(ctx, `${COMMANDS.upsertDelegationLimit}:${body.role}:${body.effectiveFrom}`);
    await queue.publish(COMMANDS.upsertDelegationLimit, {
      messageId: id, type: COMMANDS.upsertDelegationLimit, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: {
        id, tenantId: ctx.tenantId, role: body.role, level: body.level,
        maxDiscountBps: body.maxDiscountBps, effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo ?? null, enabled: body.enabled,
      },
    });
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.get("/v1/crm/delegation-limits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = z.object({ asAt: isoDate.optional() }).parse(req.query ?? {});
    const rows = await repo.listLimits(ctx.tenantId);
    const asAt = q.asAt;
    const data = asAt === undefined ? rows : rows.filter((r) => isEffectiveOn(r, asAt));
    return reply.send({ data, meta: { asAt: asAt ?? null, total: data.length } });
  });

  /**
   * Preview the delegation decision for a discount without creating an approval — the same
   * pure resolution the quotation approval path uses, so a rep can see who will have to sign
   * a discount off before they build the quotation around it.
   */
  app.get("/v1/crm/delegation-limits/authority", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = authorityQuery.parse(req.query ?? {});
    const asAt = q.asAt ?? today();
    const chain = await repo.delegationChain(ctx.tenantId);
    const roles = q.role === undefined ? ctx.roles : [q.role];
    const resolution = resolveApprovalAuthority(q.discountBps, { roles }, chain, asAt);
    return reply.send({
      data: {
        asAt,
        requestedBps: resolution.requestedBps,
        outcome: resolution.outcome,
        requesterLimitId: resolution.requesterLimit?.id ?? null,
        requesterMaxDiscountBps: resolution.requesterLimit?.maxDiscountBps ?? null,
        appliedLimitId: resolution.approverLimit?.id ?? null,
        appliedLimitBps: resolution.approverLimit?.maxDiscountBps ?? null,
        requiredApproverRole: resolution.requiredRole,
        requiredApproverLevel: resolution.requiredLevel,
      },
    });
  });

  app.delete("/v1/crm/delegation-limits/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const limit = await repo.findLimit(ctx.tenantId, id);
    if (limit === null) throw new HttpError(404, "NOT_FOUND", "delegation limit not found");
    const msgId = commandId(ctx, `${COMMANDS.deleteDelegationLimit}:${id}`);
    await queue.publish(COMMANDS.deleteDelegationLimit, {
      messageId: msgId, type: COMMANDS.deleteDelegationLimit, tenantId: ctx.tenantId, actorId: ctx.actorId,
      correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId },
    });
    return reply.code(202).send({ id: msgId, status: "accepted", correlationId: ctx.correlationId });
  });
}
