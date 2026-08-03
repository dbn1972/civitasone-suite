import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Manpower Planning & Recruitment Requisition — SVC-003.
 *
 * Turns workforce-planning from read-only analytics into a PERSISTED plan
 * lifecycle:
 *   draft → (submit) → pending_approval → (approve, maker-checker) → approved
 * On approval, a recruitment requisition is generated FROM the plan and emitted
 * to the existing recruitment flow via the transactional outbox (hrms.job.create).
 * A hire against that requisition's job opening closes the loop by bumping the
 * plan's filled_strength (see modules/manpower-planning/consumer.ts).
 *
 * Endpoints:
 *  POST   /v1/hrms/manpower/plans                     create a draft plan
 *  GET    /v1/hrms/manpower/plans                     list plans (+ computed vacancy)
 *  GET    /v1/hrms/manpower/plans/:id                 plan detail (+ roster + requisitions)
 *  PATCH  /v1/hrms/manpower/plans/:id                 update a draft plan's strengths
 *  PUT    /v1/hrms/manpower/plans/:id/roster          set category-wise roster inputs
 *  POST   /v1/hrms/manpower/plans/:id/submit          draft → pending_approval
 *  POST   /v1/hrms/manpower/plans/:id/approve         maker-checker approve + emit requisition
 *  POST   /v1/hrms/manpower/plans/:id/reject          maker-checker reject
 *  GET    /v1/hrms/manpower/requisitions              list generated requisitions
 *  POST   /v1/hrms/manpower/requisitions/:id/advertise  advertisement linkage
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { computeVacancy, allocateRoster, canApprove } from "./domain.js";
import {
  createPlanBody, updatePlanBody, setRosterBody, approvePlanBody,
  advertiseRequisitionBody, idParam,
} from "./validators.js";

const HR_ROLES  = ["hr_admin", "hr_officer", "super_admin"];
const READ_ROLES = [...HR_ROLES, "manager", "finance_officer"];
const AUDIT = "audit.event.record";

function withVacancy(plan: {
  requiredStrength: number; sanctionedStrength: number; filledStrength: number;
}) {
  return computeVacancy({
    requiredStrength: plan.requiredStrength,
    sanctionedStrength: plan.sanctionedStrength,
    filledStrength: plan.filledStrength,
  });
}

export async function manpowerPlanningRoutes(app: FastifyInstance): Promise<void> {
  // ── Create a draft plan ─────────────────────────────────────────
  app.post("/v1/hrms/manpower/plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createPlanBody.parse(req.body);
    const id = randomUUID();
    try {
      await publishF3Write(ctx, "manpower_planning_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (err) {
      if (String((err as { code?: string }).code) === "23505") {
        throw new HttpError(409, "DUPLICATE_PLAN", "a plan already exists for this unit, cadre and year");
      }
      throw err;
    }
    return reply.code(201).send({ id, status: "draft" });
  });

  // ── List plans (with computed vacancy) ──────────────────────────
  app.get("/v1/hrms/manpower/plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const plans = await repo.listPlans(ctx.tenantId);
    return reply.send({ data: plans.map((p) => ({ ...p, ...withVacancy(p) })) });
  });

  // ── Plan detail ─────────────────────────────────────────────────
  app.get("/v1/hrms/manpower/plans/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const plan = await repo.getPlan(ctx.tenantId, id);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "manpower plan not found");
    const [roster, requisitions] = await Promise.all([
      repo.listRoster(ctx.tenantId, id),
      repo.listRequisitions(ctx.tenantId, id),
    ]);
    return reply.send({ data: { ...plan, ...withVacancy(plan), roster, requisitions } });
  });

  // ── Update a draft plan's strengths ─────────────────────────────
  app.patch("/v1/hrms/manpower/plans/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updatePlanBody.parse(req.body);
    const plan = await repo.getPlan(ctx.tenantId, id);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "manpower plan not found");
    const row = await publishF3Write(ctx, "manpower_planning_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    if (!row) throw new HttpError(409, "INVALID_STATE", "only a draft plan can be edited");
    return reply.send({ data: { ...row, ...withVacancy(row) } });
  });

  // ── Set category-wise roster inputs ─────────────────────────────
  app.put("/v1/hrms/manpower/plans/:id/roster", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = setRosterBody.parse(req.body);
    const plan = await repo.getPlan(ctx.tenantId, id);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "manpower plan not found");
    if (plan.status !== "draft" && plan.status !== "pending_approval") {
      throw new HttpError(409, "INVALID_STATE", "roster can only be set before approval");
    }
    await publishF3Write(ctx, "manpower_planning_routes__2", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ data: await repo.listRoster(ctx.tenantId, id) });
  });

  // ── Submit for approval ─────────────────────────────────────────
  app.post("/v1/hrms/manpower/plans/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const plan = await repo.getPlan(ctx.tenantId, id);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "manpower plan not found");
    const row = await publishF3Write(ctx, "manpower_planning_routes__3", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    if (!row) throw new HttpError(409, "INVALID_STATE", "only a draft plan can be submitted for approval");
    return reply.send({ id, status: row.status });
  });

  // ── Approve (maker-checker) + generate & emit requisition ───────
  app.post("/v1/hrms/manpower/plans/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = approvePlanBody.parse(req.body ?? {});
    const plan = await repo.getPlan(ctx.tenantId, id);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "manpower plan not found");

    // Maker-checker: approver MUST differ from the creator (pure guard).
    const guard = canApprove(plan, ctx.actorId);
    if (!guard.ok) throw new HttpError(guard.code === "MAKER_CHECKER" ? 409 : 409, guard.code, guard.message);

    const vac = withVacancy(plan);

    const result = await publishF3Write(ctx, "manpower_planning_routes__4", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    if (!result) throw new HttpError(409, "INVALID_STATE", "only a plan pending approval can be approved");
    return reply.send({
      id, status: result.approved.status, approvedBy: result.approved.approvedBy,
      requisition: result.requisition, vacancy: vac.vacancy,
    });
  });

  // ── Reject (maker-checker) ──────────────────────────────────────
  app.post("/v1/hrms/manpower/plans/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const plan = await repo.getPlan(ctx.tenantId, id);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "manpower plan not found");
    if (plan.createdBy === ctx.actorId) {
      throw new HttpError(409, "MAKER_CHECKER", "plan rejection requires a checker different from the plan creator");
    }
    const row = await publishF3Write(ctx, "manpower_planning_routes__5", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    if (!row) throw new HttpError(409, "INVALID_STATE", "only a plan pending approval can be rejected");
    return reply.send({ id, status: row.status });
  });

  // ── Requisitions list ───────────────────────────────────────────
  app.get("/v1/hrms/manpower/requisitions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = req.query as { planId?: string };
    return reply.send({ data: await repo.listRequisitions(ctx.tenantId, q.planId) });
  });

  // ── Advertisement linkage ───────────────────────────────────────
  app.post("/v1/hrms/manpower/requisitions/:id/advertise", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = advertiseRequisitionBody.parse(req.body);
    const existing = await repo.getRequisition(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "requisition not found");
    const row = await publishF3Write(ctx, "manpower_planning_routes__6", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    if (!row) throw new HttpError(409, "INVALID_STATE", "could not attach advertisement");
    return reply.send({ id, status: row.status, advertisementRef: row.advertisementRef });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
