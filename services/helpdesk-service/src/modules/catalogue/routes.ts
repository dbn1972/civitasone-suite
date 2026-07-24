/**
 * Service Catalogue (SVC-129) — HTTP routes.
 *
 * Admin: manage catalogue offerings + OLA/underpinning contracts.
 * Users: browse the catalogue, raise self-service requests, track their requests.
 * Fulfilment: approve (maker-checker), advance fulfilment stages, mark fulfilled.
 * Reporting: SLA-breach report over service requests.
 *
 * Admin writes wrap in db.transaction() so createTenantDb's wrapWithTenantGuc
 * sets app.tenant_id (from the request's tenant hook) before the write — RLS
 * WITH CHECK then enforces tenant isolation on insert/update.
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";
import { db } from "../../shared/db.js";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { isAtRisk, isBreached } from "../sla/domain.js";
import * as repo from "./repo.js";
import * as service from "./service.js";
import {
  createOfferingBody,
  updateOfferingBody,
  createOlaBody,
  raiseRequestBody,
  approvalBody,
  advanceStageBody,
  fulfilRequestBody,
  idParam,
} from "./validators.js";
import type { OfferingRow, OfferingInsert, ServiceRequestRow } from "./schema.js";
import type { FormField, FulfilmentStage } from "./domain.js";

const ADMIN_ROLES = ["helpdesk_admin", "super_admin"];
const USER_ROLES = ["helpdesk_user", "helpdesk_agent", "helpdesk_admin", "super_admin"];
const APPROVER_ROLES = ["helpdesk_admin", "super_admin"];
const FULFILLER_ROLES = ["helpdesk_agent", "helpdesk_admin", "super_admin"];

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

function offeringView(o: OfferingRow) {
  return {
    id: o.id,
    name: o.name,
    category: o.category,
    description: o.description,
    status: o.status,
    slaPolicyId: o.slaPolicyId,
    approvalRequired: o.approvalRequired,
    requestFormSchema: o.requestFormSchema,
    fulfilmentStages: o.fulfilmentStages,
    defaultPriority: o.defaultPriority,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

/** Live SLA status of a request from its resolution deadline (freshest view). */
function liveSlaStatus(r: ServiceRequestRow, now: Date): "within_sla" | "at_risk" | "breached" {
  if (["fulfilled", "rejected", "cancelled"].includes(r.status)) return r.slaStatus as "within_sla";
  const deadline = r.resolutionDeadline;
  if (!deadline) return "within_sla";
  if (isBreached(now, deadline)) return "breached";
  if (isAtRisk(now, r.createdAt, deadline)) return "at_risk";
  return "within_sla";
}

function requestView(r: ServiceRequestRow, now: Date) {
  return {
    id: r.id,
    offeringId: r.offeringId,
    ticketId: r.ticketId,
    requestedBy: r.requestedBy,
    status: r.status,
    currentStage: r.currentStage,
    slaStatus: liveSlaStatus(r, now),
    responseDeadline: r.responseDeadline,
    resolutionDeadline: r.resolutionDeadline,
    breachEscalatedAt: r.breachEscalatedAt,
    formData: r.formData,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function catalogueRoutes(app: FastifyInstance): Promise<void> {
  // ── Offerings: admin management + browse ───────────────────────────────────
  app.post("/v1/helpdesk/catalogue/offerings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createOfferingBody.parse(req.body);
    try {
      const row = await db.transaction((tx) =>
        repo.insertOffering(tx as repo.Writer, {
          tenantId: ctx.tenantId,
          name: body.name,
          category: body.category ?? "general",
          description: body.description ?? null,
          status: "active",
          slaPolicyId: body.slaPolicyId ?? null,
          approvalRequired: body.approvalRequired ?? false,
          requestFormSchema: (body.requestFormSchema ?? []) as FormField[],
          fulfilmentStages: (body.fulfilmentStages ?? []) as FulfilmentStage[],
          defaultPriority: body.defaultPriority ?? "Medium",
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId,
        }),
      );
      return reply.code(201).send({ data: offeringView(row) });
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, "DUPLICATE_OFFERING", "an offering with this name already exists");
      throw err;
    }
  });

  app.get("/v1/helpdesk/catalogue/offerings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rq = req.query as Record<string, unknown>;
    const status = typeof rq.status === "string" ? String(rq.status) : "active";
    const category = typeof rq.category === "string" ? String(rq.category) : undefined;
    const rows = await repo.listOfferings(ctx.tenantId, { status, category, limit: q.limit, offset: q.offset });
    return reply.send({
      data: rows.map(offeringView),
      pagination: { hasMore: rows.length === q.limit, pageSize: q.limit },
    });
  });

  app.get("/v1/helpdesk/catalogue/offerings/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const offering = await repo.findOffering(id, ctx.tenantId);
    if (!offering) throw new HttpError(404, "NOT_FOUND", "offering not found");
    const olas = await repo.listOlas(ctx.tenantId, id);
    return reply.send({ data: { ...offeringView(offering), olas } });
  });

  app.patch("/v1/helpdesk/catalogue/offerings/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateOfferingBody.parse(req.body);
    const updated = await db.transaction((tx) =>
      repo.updateOffering(tx as repo.Writer, id, ctx.tenantId, { ...body, updatedBy: ctx.actorId } as Partial<OfferingInsert>),
    );
    if (!updated) throw new HttpError(404, "NOT_FOUND", "offering not found");
    return reply.send({ data: offeringView(updated) });
  });

  // ── OLAs / underpinning contracts ──────────────────────────────────────────
  app.post("/v1/helpdesk/catalogue/offerings/:id/olas", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const offering = await repo.findOffering(id, ctx.tenantId);
    if (!offering) throw new HttpError(404, "NOT_FOUND", "offering not found");
    const body = createOlaBody.parse(req.body);
    const row = await db.transaction((tx) =>
      repo.insertOla(tx as repo.Writer, {
        tenantId: ctx.tenantId,
        offeringId: id,
        name: body.name,
        kind: body.kind ?? "ola",
        provider: body.provider,
        targetMinutes: body.targetMinutes,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      }),
    );
    return reply.code(201).send({ data: row });
  });

  app.get("/v1/helpdesk/catalogue/offerings/:id/olas", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await repo.listOlas(ctx.tenantId, id);
    return reply.send({ data: rows });
  });

  // ── Self-service portal: raise a request ───────────────────────────────────
  app.post("/v1/helpdesk/catalogue/offerings/:id/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = raiseRequestBody.parse(req.body);
    const result = await service.raiseRequest(ctx, id, body);
    return reply.code(201).send({ data: result });
  });

  // ── Requests: breach report (static path — must precede :id) ───────────────
  app.get("/v1/helpdesk/catalogue/requests/breaches", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const now = new Date();
    const rows = await repo.listBreachedRequests(ctx.tenantId);
    const views = rows.map((r) => requestView(r, now));
    const breached = views.filter((v) => v.slaStatus === "breached");
    const atRisk = views.filter((v) => v.slaStatus === "at_risk");
    const escalated = rows.filter((r) => r.breachEscalatedAt !== null).length;
    return reply.send({
      data: breached,
      summary: { breached: breached.length, atRisk: atRisk.length, escalated, total: rows.length },
    });
  });

  // ── Requests: my requests / list ───────────────────────────────────────────
  app.get("/v1/helpdesk/catalogue/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const rq = req.query as Record<string, unknown>;
    const mine = rq.mine === "true" || rq.mine === "1";
    const status = typeof rq.status === "string" ? String(rq.status) : undefined;
    const rows = await repo.listRequests(ctx.tenantId, {
      requestedBy: mine ? ctx.actorId : undefined,
      status,
      limit: q.limit,
      offset: q.offset,
    });
    const now = new Date();
    return reply.send({
      data: rows.map((r) => requestView(r, now)),
      pagination: { hasMore: rows.length === q.limit, pageSize: q.limit },
    });
  });

  app.get("/v1/helpdesk/catalogue/requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, USER_ROLES);
    const { id } = idParam.parse(req.params);
    const request = await repo.findRequest(id, ctx.tenantId);
    if (!request) throw new HttpError(404, "NOT_FOUND", "service request not found");
    const [approvals, stageEvents] = await Promise.all([
      repo.listApprovals(ctx.tenantId, id),
      repo.listStageEvents(ctx.tenantId, id),
    ]);
    return reply.send({ data: { ...requestView(request, new Date()), approvals, stageEvents } });
  });

  // ── Fulfilment lifecycle ───────────────────────────────────────────────────
  app.post("/v1/helpdesk/catalogue/requests/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = approvalBody.parse(req.body);
    return reply.send({ data: await service.decideApproval(ctx, id, body) });
  });

  app.post("/v1/helpdesk/catalogue/requests/:id/advance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FULFILLER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = advanceStageBody.parse(req.body);
    return reply.send({ data: await service.advanceStage(ctx, id, body) });
  });

  app.post("/v1/helpdesk/catalogue/requests/:id/fulfil", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FULFILLER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = fulfilRequestBody.parse(req.body);
    return reply.send({ data: await service.fulfilRequest(ctx, id, body) });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
