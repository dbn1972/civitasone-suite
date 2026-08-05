/**
 * CR-MKT-05 — A/B experiments + engagement heatmaps.
 *
 * POST /v1/notification/experiments                       — define variants (202)
 * GET  /v1/notification/experiments                       — list
 * POST /v1/notification/experiments/:id/events            — record open/click (202)
 * GET  /v1/notification/experiments/:id/results           — per-variant results + winner
 * GET  /v1/notification/experiments/:id/heatmap           — clicks by link position
 * POST /v1/notification/experiments/:id/conclude          — freeze the winner (202)
 * GET  /v1/notification/experiments/:id/allocation        — deterministic variant for a subject
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  validateVariants,
  summariseVariants,
  determineWinner,
  buildHeatmap,
  allocateVariant,
  assertCanRequestConclusion,
  assertCanApproveWinner,
  type VariantDef,
  type EngagementEvent,
} from "./domain.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const WRITE_ROLES = ["notification_admin", "super_admin", "tenant_admin", "platform_admin", "marketing_admin"];
const READ_ROLES = [...WRITE_ROLES, "audit_officer"];

const createBody = z.object({
  name: z.string().min(1).max(200),
  variants: z.array(z.object({
    key: z.string().min(1).max(64),
    allocationPct: z.number().int().min(1).max(100),
    templateId: z.string().uuid().optional(),
  })).min(2).max(10),
});

const eventBody = z.object({
  variantId: z.string().uuid(),
  eventType: z.enum(["open", "click"]),
  deliveryId: z.string().uuid().optional(),
  linkPosition: z.number().int().min(1).max(500).optional(),
  linkUrl: z.string().url().max(2048).optional(),
  occurredAt: z.string().datetime().optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200),
  offset: z.coerce.number().int().min(0).default(0),
});

const heatmapQuery = z.object({ variantId: z.string().uuid().optional() });
const allocationQuery = z.object({ subject: z.string().min(1).max(200) });
const idParam = z.object({ id: z.string().uuid() });

export async function experimentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/notification/experiments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createBody.parse(req.body);
    // 422: allocations that do not sum to 100 would leave recipients unassigned.
    // Validated at the boundary as well as in the consumer so the caller gets a
    // synchronous, actionable error instead of a silent dead-letter.
    const invalid = validateVariants(body.variants.map((v, i) => ({
      id: String(i), key: v.key, allocationPct: v.allocationPct,
    })));
    if (invalid) throw new HttpError(422, invalid.code, invalid.message);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createExperiment(ctx, body));
  });

  app.get("/v1/notification/experiments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listExperiments(ctx.tenantId, q.limit, q.offset);
    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        winnerVariantId: r.winnerVariantId,
        winnerMarginPct: r.winnerMarginPct,
        concludedAt: r.concludedAt ? r.concludedAt.toISOString() : null,
      })),
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  app.post("/v1/notification/experiments/:id/events", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = eventBody.parse(req.body);
    const experiment = await repo.findExperimentById(ctx.tenantId, id);
    if (!experiment) throw new HttpError(404, "NOT_FOUND", "experiment not found");
    // 422: a click without a link position carries no heatmap signal. Reject it
    // rather than storing a row that silently never appears in the heatmap.
    if (body.eventType === "click" && body.linkPosition === undefined) {
      throw new HttpError(422, "MISSING_LINK_POSITION", "linkPosition is required for click events");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordEngagement(ctx, {
      experimentId: id,
      variantId: body.variantId,
      eventType: body.eventType,
      ...(body.deliveryId !== undefined ? { deliveryId: body.deliveryId } : {}),
      ...(body.linkPosition !== undefined ? { linkPosition: body.linkPosition } : {}),
      ...(body.linkUrl !== undefined ? { linkUrl: body.linkUrl } : {}),
      ...(body.occurredAt !== undefined ? { occurredAt: body.occurredAt } : {}),
    }));
  });

  app.get("/v1/notification/experiments/:id/results", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const experiment = await repo.findExperimentById(ctx.tenantId, id);
    if (!experiment) throw new HttpError(404, "NOT_FOUND", "experiment not found");
    const { defs, sentByVariant, events } = await loadForAnalysis(ctx.tenantId, id);
    const results = summariseVariants(defs, sentByVariant, events);
    return reply.send({
      data: {
        experimentId: id,
        status: experiment.status,
        results,
        winner: determineWinner(results),
      },
    });
  });

  app.get("/v1/notification/experiments/:id/heatmap", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const q = heatmapQuery.parse(req.query);
    const experiment = await repo.findExperimentById(ctx.tenantId, id);
    if (!experiment) throw new HttpError(404, "NOT_FOUND", "experiment not found");
    const { events } = await loadForAnalysis(ctx.tenantId, id);
    return reply.send({
      data: {
        experimentId: id,
        ...(q.variantId !== undefined ? { variantId: q.variantId } : {}),
        cells: buildHeatmap(events, q.variantId),
      },
    });
  });

  app.get("/v1/notification/experiments/:id/allocation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const q = allocationQuery.parse(req.query);
    const experiment = await repo.findExperimentById(ctx.tenantId, id);
    if (!experiment) throw new HttpError(404, "NOT_FOUND", "experiment not found");
    const variants = await repo.listVariants(ctx.tenantId, id);
    const defs: VariantDef[] = variants.map((v) => ({
      id: v.id, key: v.variantKey, allocationPct: v.allocationPct,
    }));
    const chosen = allocateVariant(id, q.subject, defs);
    if (!chosen) throw new HttpError(422, "NO_VARIANTS", "experiment has no variants to allocate");
    return reply.send({ data: { experimentId: id, variantId: chosen.id, variantKey: chosen.key } });
  });

  app.post("/v1/notification/experiments/:id/conclude", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const experiment = await repo.findExperimentById(ctx.tenantId, id);
    if (!experiment) throw new HttpError(404, "NOT_FOUND", "experiment not found");
    const blocked = assertCanRequestConclusion(experiment.status);
    if (blocked === "ALREADY_CONCLUDED") {
      throw new HttpError(409, "ALREADY_CONCLUDED", "experiment is already concluded");
    }
    if (blocked === "ALREADY_PENDING_APPROVAL") {
      throw new HttpError(409, "ALREADY_PENDING_APPROVAL", "winner promotion is awaiting approval");
    }
    if (blocked) throw new HttpError(409, blocked, "experiment cannot request conclusion");
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestWinnerApproval(ctx, id));
  });

  /** P2-9: approval gate — promotes the proposed winner to concluded. */
  app.post("/v1/notification/experiments/:id/approve-winner", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const experiment = await repo.findExperimentById(ctx.tenantId, id);
    if (!experiment) throw new HttpError(404, "NOT_FOUND", "experiment not found");
    const blocked = assertCanApproveWinner(experiment.status);
    if (blocked === "ALREADY_CONCLUDED") {
      throw new HttpError(409, "ALREADY_CONCLUDED", "experiment is already concluded");
    }
    if (blocked) throw new HttpError(409, "NOT_PENDING_APPROVAL", "conclude the experiment before approving a winner");
    return sendAccepted(reply, acceptedResponseSchema, await commands.approveWinner(ctx, id));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}

async function loadForAnalysis(tenantId: string, experimentId: string): Promise<{
  defs: VariantDef[];
  sentByVariant: Record<string, number>;
  events: EngagementEvent[];
}> {
  const variants = await repo.listVariants(tenantId, experimentId);
  const rows = await repo.listEvents(tenantId, experimentId);
  const sentByVariant: Record<string, number> = {};
  for (const v of variants) sentByVariant[v.id] = v.sentCount;
  return {
    defs: variants.map((v) => ({ id: v.id, key: v.variantKey, allocationPct: v.allocationPct })),
    sentByVariant,
    events: rows.map((e) => ({
      variantId: e.variantId,
      eventType: e.eventType === "click" ? "click" : "open",
      linkPosition: e.linkPosition,
    })),
  };
}
