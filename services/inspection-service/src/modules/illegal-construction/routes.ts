/**
 * Illegal Construction module — HTTP routes.
 *
 * Endpoints:
 *   POST /v1/inspection/illegal-construction/cases — create case
 *   GET  /v1/inspection/illegal-construction/cases — list cases
 *   GET  /v1/inspection/illegal-construction/cases/:id — get case
 *   POST /v1/inspection/illegal-construction/cases/:id/inspect — record inspection
 *   POST /v1/inspection/illegal-construction/cases/:id/confirm-violation
 *   POST /v1/inspection/illegal-construction/actions — issue action
 *   GET  /v1/inspection/illegal-construction/cases/:id/actions — list actions for case
 *   POST /v1/inspection/illegal-construction/actions/:id/enforce — enforce action
 *   POST /v1/inspection/illegal-construction/cases/:id/regularize — regularize
 *
 * _Requirements: BRD 5.20 ILBLD-001..004_
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  publishCreateCase,
  publishInspectCase,
  publishConfirmViolation,
  publishIssueAction,
  publishEnforceAction,
  publishRegularizeCase,
} from "./commands.js";
import {
  findCases,
  findCaseById,
  findActionsByCaseId,
  findActionById,
} from "./repo.js";

// ─── RBAC ────────────────────────────────────────────────────────────────────

const ADMIN_ROLES = ["inspection_admin", "tenant_admin", "super_admin"];
const WRITE_ROLES = ["inspector", "reviewing_officer", "inspection_admin",
  "tenant_admin", "super_admin"];
const READ_ROLES = ["inspector", "reviewing_officer", "inspection_admin",
  "tenant_admin", "super_admin"];

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const idParam = z.object({ id: z.string().uuid() });

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(15),
  status: z.string().optional(),
  violationType: z.string().optional(),
});

const createCaseSchema = z.object({
  reportedBy: z.string().uuid(),
  location: z.record(z.unknown()),
  buildingPermitRef: z.string().optional(),
  ownerName: z.string().min(1),
  ownerContact: z.string().optional(),
  violationType: z.enum([
    "no_permit", "deviation_from_plan", "unauthorized_floor",
    "setback_violation", "fsi_exceeded", "unauthorized_use_change",
  ]),
  description: z.string().min(1),
  photos: z.array(z.unknown()).optional(),
});

const inspectCaseSchema = z.object({
  inspectionFindings: z.record(z.unknown()),
  violationChecklist: z.unknown(),
});

const issueActionSchema = z.object({
  caseId: z.string().uuid(),
  actionType: z.enum([
    "stop_work_notice", "sealing_order", "demolition_order", "fine", "regularization_order",
  ]),
  details: z.record(z.unknown()).optional(),
  fineAmountMinor: z.string().optional(),
});

const regularizeSchema = z.object({
  regularizationDetails: z.record(z.unknown()),
});

// ─── Route registration ─────────────────────────────────────────────────────

export async function registerIllegalConstructionRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /v1/inspection/illegal-construction/cases ──
  app.post("/v1/inspection/illegal-construction/cases", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createCaseSchema.parse(req.body);
    const result = await publishCreateCase(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/inspection/illegal-construction/cases ──
  app.get("/v1/inspection/illegal-construction/cases", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = listQuerySchema.parse(req.query);
    const result = await findCases(ctx.tenantId, {
      page: query.page,
      pageSize: query.pageSize,
    }, { status: query.status, violationType: query.violationType });
    return reply.send(result);
  });

  // ── GET /v1/inspection/illegal-construction/cases/:id ──
  app.get("/v1/inspection/illegal-construction/cases/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const caseRow = await findCaseById(ctx.tenantId, id);
    if (!caseRow) throw new HttpError(404, "NOT_FOUND", "illegal construction case not found");
    return reply.send({ data: caseRow });
  });

  // ── POST /v1/inspection/illegal-construction/cases/:id/inspect ──
  app.post("/v1/inspection/illegal-construction/cases/:id/inspect", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const caseRow = await findCaseById(ctx.tenantId, id);
    if (!caseRow) throw new HttpError(404, "NOT_FOUND", "illegal construction case not found");
    const body = inspectCaseSchema.parse(req.body);
    const result = await publishInspectCase(
      {
        caseId: id,
        inspectionFindings: body.inspectionFindings,
        violationChecklist: body.violationChecklist,
      },
      ctx,
    );
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/illegal-construction/cases/:id/confirm-violation ──
  app.post("/v1/inspection/illegal-construction/cases/:id/confirm-violation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const caseRow = await findCaseById(ctx.tenantId, id);
    if (!caseRow) throw new HttpError(404, "NOT_FOUND", "illegal construction case not found");
    const result = await publishConfirmViolation({ caseId: id }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/illegal-construction/actions ──
  app.post("/v1/inspection/illegal-construction/actions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = issueActionSchema.parse(req.body);
    const result = await publishIssueAction(body, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── GET /v1/inspection/illegal-construction/cases/:id/actions ──
  app.get("/v1/inspection/illegal-construction/cases/:id/actions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const caseRow = await findCaseById(ctx.tenantId, id);
    if (!caseRow) throw new HttpError(404, "NOT_FOUND", "illegal construction case not found");
    const query = listQuerySchema.parse(req.query);
    const result = await findActionsByCaseId(ctx.tenantId, id, {
      page: query.page,
      pageSize: query.pageSize,
    });
    return reply.send(result);
  });

  // ── POST /v1/inspection/illegal-construction/actions/:id/enforce ──
  app.post("/v1/inspection/illegal-construction/actions/:id/enforce", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const action = await findActionById(ctx.tenantId, id);
    if (!action) throw new HttpError(404, "NOT_FOUND", "illegal construction action not found");
    const result = await publishEnforceAction({ actionId: id }, ctx);
    return reply.code(202).send({ data: result });
  });

  // ── POST /v1/inspection/illegal-construction/cases/:id/regularize ──
  app.post("/v1/inspection/illegal-construction/cases/:id/regularize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const caseRow = await findCaseById(ctx.tenantId, id);
    if (!caseRow) throw new HttpError(404, "NOT_FOUND", "illegal construction case not found");
    const body = regularizeSchema.parse(req.body);
    const result = await publishRegularizeCase({ caseId: id, ...body }, ctx);
    return reply.code(202).send({ data: result });
  });
}
