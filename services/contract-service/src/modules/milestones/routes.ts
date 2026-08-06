/**
 * G15 — MoU milestone governance HTTP routes.
 *
 * Strictly CQRS: every mutation validates with zod, publishes a command and
 * returns 202. No route writes to Postgres. Reads are synchronous and go
 * through the read-through cache in queries.ts.
 *
 * Prefix convention matches the rest of this service: /v1/contract/...
 * (the gateway maps /api/v1/contract → contract-service:3009).
 */
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createMilestoneBody,
  transitionMilestoneBody,
  milestoneListQuery,
  createPenaltyTermBody,
  applyPenaltyBody,
  penaltyTermListQuery,
  createReviewScheduleBody,
  completeReviewBody,
  reviewListQuery,
  idParam,
} from "./validators.js";
import { canTransition, assertTermRepresentation, MilestoneDomainError } from "./domain.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import type { PenaltyTermRow, ReviewScheduleRow } from "./schema.js";
import type { MilestoneRow } from "./repo.js";

const WRITE_ROLES = ["procurement_admin", "finance_admin", "super_admin", "legal_officer", "contract_admin"];
const READ_ROLES = [...WRITE_ROLES, "audit_officer", "procurement_officer", "finance_officer"];
/** Waiving a milestone excuses a breach — a narrower authority than routine edits. */
const WAIVE_ROLES = ["super_admin", "contract_admin", "legal_officer"];

/** Money leaves the service as a decimal STRING of minor units. */
function money(v: bigint | null): string | null {
  return v === null ? null : v.toString();
}

function meta(offset: number, limit: number, total: number) {
  return { page: Math.floor(offset / limit) + 1, pageSize: limit, total };
}

function milestoneDto(row: MilestoneRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    contractId: row.contractId,
    milestoneCode: row.milestoneCode,
    name: row.title,
    description: row.description,
    dueDate: row.dueDate,
    ordinal: row.ordinal,
    status: row.status,
    completedAt: row.completedAt,
    amountMinor: money(row.amountMinor),
    currency: row.currency,
    penaltyMinor: money(row.penaltyMinor),
    netPayableMinor: money(row.netPayableMinor),
    waivedBy: row.waivedBy,
    waivedAt: row.waivedAt,
    waiverReason: row.waiverReason,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function penaltyTermDto(row: PenaltyTermRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    contractId: row.contractId,
    termCode: row.termCode,
    description: row.description,
    triggerType: row.triggerType,
    thresholdValue: row.thresholdValue,
    penaltyKind: row.penaltyKind,
    penaltyAmountMinor: money(row.penaltyAmountMinor),
    penaltyRateBps: row.penaltyRateBps,
    maxPenaltyBps: row.maxPenaltyBps,
    currency: row.currency,
    active: row.active,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function reviewDto(row: ReviewScheduleRow) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    contractId: row.contractId,
    reviewCode: row.reviewCode,
    cadence: row.cadence,
    nextReviewDate: row.nextReviewDate,
    lastReviewedAt: row.lastReviewedAt,
    reviewerRole: row.reviewerRole,
    status: row.status,
    notes: row.notes,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function mouMilestoneRoutes(app: FastifyInstance): Promise<void> {
  // ══ Milestones ═══════════════════════════════════════════════════════════

  app.post("/v1/contract/mou/milestones", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createMilestoneBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.registerMilestone(ctx, body));
  });

  app.get("/v1/contract/mou/milestones", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = milestoneListQuery.parse(req.query);
    const { data, total } = await queries.listMilestones(ctx.tenantId, {
      ...(q.contractId !== undefined && { contractId: q.contractId }),
      ...(q.status !== undefined && { status: q.status }),
      limit: q.limit,
      offset: q.offset,
    });
    return reply.send({ data: data.map(milestoneDto), meta: meta(q.offset, q.limit, total) });
  });

  app.get("/v1/contract/mou/milestones/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getMilestone(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "milestone not found");
    return reply.send({ data: milestoneDto(row) });
  });

  app.patch("/v1/contract/mou/milestones/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = idParam.parse(req.params);
    const body = transitionMilestoneBody.parse(req.body);
    // Waiving a breach needs the narrower authority; other transitions do not.
    requireRole(ctx, body.toStatus === "waived" ? WAIVE_ROLES : WRITE_ROLES);

    const existing = await queries.getMilestone(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "milestone not found");

    // Read-only pre-flight so an obviously illegal transition fails fast with a
    // 422 rather than being silently dropped by the consumer.
    if (!canTransition(existing.status, body.toStatus)) {
      throw new HttpError(
        422,
        "INVALID_TRANSITION",
        `cannot transition milestone from ${existing.status} to ${body.toStatus}`,
      );
    }
    if (existing.version !== body.version) {
      throw new HttpError(409, "VERSION_CONFLICT", `milestone version is ${existing.version}, not ${body.version}`);
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.transitionMilestone(ctx, id, existing.contractId, body),
    );
  });

  // ══ Penalty / SLA terms ══════════════════════════════════════════════════

  app.post("/v1/contract/mou/penalty-terms", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createPenaltyTermBody.parse(req.body);
    // Mirrors the penalty_terms_representation_check CHECK constraint so a
    // malformed term is a 422, not a leaked Postgres error from the consumer.
    assertTermRepresentation({
      penaltyKind: body.penaltyKind,
      penaltyAmountMinor: body.penaltyAmountMinor ?? undefined,
      penaltyRateBps: body.penaltyRateBps ?? undefined,
      maxPenaltyBps: body.maxPenaltyBps,
      thresholdValue: body.thresholdValue,
    });
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPenaltyTerm(ctx, body));
  });

  app.get("/v1/contract/mou/penalty-terms", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = penaltyTermListQuery.parse(req.query);
    const { data, total } = await queries.listPenaltyTerms(ctx.tenantId, {
      ...(q.contractId !== undefined && { contractId: q.contractId }),
      ...(q.triggerType !== undefined && { triggerType: q.triggerType }),
      limit: q.limit,
      offset: q.offset,
    });
    return reply.send({ data: data.map(penaltyTermDto), meta: meta(q.offset, q.limit, total) });
  });

  app.get("/v1/contract/mou/penalty-terms/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getPenaltyTerm(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "penalty term not found");
    return reply.send({ data: penaltyTermDto(row) });
  });

  app.post("/v1/contract/mou/penalty-applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = applyPenaltyBody.parse(req.body);
    const term = await queries.getPenaltyTerm(body.penaltyTermId, ctx.tenantId);
    if (!term) throw new HttpError(404, "NOT_FOUND", "penalty term not found");
    if (!term.active) throw new HttpError(422, "TERM_INACTIVE", "penalty term is not active");
    return sendAccepted(reply, acceptedResponseSchema, await commands.applyPenalty(ctx, body));
  });

  app.get("/v1/contract/mou/penalty-applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = penaltyTermListQuery.parse(req.query);
    const { data, total } = await queries.listPenaltyApplications(ctx.tenantId, {
      ...(q.contractId !== undefined && { contractId: q.contractId }),
      limit: q.limit,
      offset: q.offset,
    });
    return reply.send({
      data: data.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        contractId: r.contractId,
        penaltyTermId: r.penaltyTermId,
        milestoneId: r.milestoneId,
        occurrenceKey: r.occurrenceKey,
        computedAmountMinor: r.computedAmountMinor.toString(),
        currency: r.currency,
        basis: r.basis,
        appliedAt: r.appliedAt,
        version: r.version,
      })),
      meta: meta(q.offset, q.limit, total),
    });
  });

  // ══ Review schedules ═════════════════════════════════════════════════════

  app.post("/v1/contract/mou/review-schedules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createReviewScheduleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.scheduleReview(ctx, body));
  });

  app.get("/v1/contract/mou/review-schedules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = reviewListQuery.parse(req.query);
    const { data, total } = await queries.listReviewSchedules(ctx.tenantId, {
      ...(q.contractId !== undefined && { contractId: q.contractId }),
      ...(q.status !== undefined && { status: q.status }),
      limit: q.limit,
      offset: q.offset,
    });
    return reply.send({ data: data.map(reviewDto), meta: meta(q.offset, q.limit, total) });
  });

  app.get("/v1/contract/mou/review-schedules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getReviewSchedule(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "review schedule not found");
    return reply.send({ data: reviewDto(row) });
  });

  app.patch("/v1/contract/mou/review-schedules/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeReviewBody.parse(req.body);

    const existing = await queries.getReviewSchedule(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "review schedule not found");
    if (existing.status !== "scheduled") {
      throw new HttpError(422, "INVALID_TRANSITION", `only a scheduled review can be completed, got ${existing.status}`);
    }
    if (existing.version !== body.version) {
      throw new HttpError(409, "VERSION_CONFLICT", `review version is ${existing.version}, not ${body.version}`);
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.completeReview(ctx, id, body));
  });

  // ── Error handler ─────────────────────────────────────────────────────────
  app.setErrorHandler((err: unknown, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      void reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    if (err instanceof HttpError) {
      void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
      return;
    }
    if (err instanceof MilestoneDomainError) {
      void reply.code(422).send({ code: err.code, message: err.message, correlationId, retryable: false });
      return;
    }
    req.log.error({ err }, "unhandled error");
    void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
