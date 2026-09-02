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
      // Must reuse `id` here, not mint a second randomUUID(): op __0 is the
      // ONLY publishF3Write call whose `id` param is actually used as a new
      // row's primary key (repo.insertPlan in the F3 consumer). Passing a
      // different id meant the row the consumer inserted was never the row
      // this handler's 201 response pointed the client at — every immediate
      // follow-up read/write against the returned id 404'd.
      await publishF3Write(ctx, "manpower_planning_routes__0", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (err) {
      if (String((err as { code?: string }).code) === "23505") {
        throw new HttpError(409, "DUPLICATE_PLAN", "a plan already exists for this unit, cadre and year") as any;
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
    // Synchronous pre-check, matching repo.updateDraftPlan's own `status =
    // 'draft'` WHERE clause: publishF3Write is fire-and-forget, so a stale
    // `if (!row) throw 409` after the call could never fire (`row` is always
    // the { id, status, correlationId } placeholder, never the updated row,
    // never falsy) — a patch against a non-draft plan silently no-op'd in the
    // consumer while this route told the caller 200. Mirror the guard here,
    // before publish, matching gpf/routes.ts and cpf/routes.ts.
    if (plan.status !== "draft") {
      throw new HttpError(409, "INVALID_STATE", "only a draft plan can be edited");
    }
    await publishF3Write(ctx, "manpower_planning_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    // The actual update (and its resulting `version`/`updatedAt`) is applied
    // later, asynchronously, by the consumer — this route cannot read it back
    // synchronously. It used to destructure `{ ...row }` off publishF3Write's
    // return value, which never carries the updated row (see f3-publish.ts).
    // Report the merge of the already-known plan and the already-validated
    // patch body instead — the same values the consumer will persist
    // (updatePlanBody's fields are all `.optional()` without `.nullable()`,
    // so a provided value is never `null` and `??` is equivalent to the
    // consumer's `!== undefined` check).
    const merged = {
      ...plan,
      requiredStrength: body.requiredStrength ?? plan.requiredStrength,
      sanctionedStrength: body.sanctionedStrength ?? plan.sanctionedStrength,
      filledStrength: body.filledStrength ?? plan.filledStrength,
      remarks: body.remarks ?? plan.remarks,
    };
    return reply.send({ data: { ...merged, ...withVacancy(merged) } });
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
    await publishF3Write(ctx, "manpower_planning_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ data: await repo.listRoster(ctx.tenantId, id) }) as any;
  });

  // ── Submit for approval ─────────────────────────────────────────
  app.post("/v1/hrms/manpower/plans/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const plan = await repo.getPlan(ctx.tenantId, id);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "manpower plan not found");
    // Synchronous pre-check, matching repo.submitPlan's own `status = 'draft'`
    // WHERE clause — see the __1 patch handler above for why the old
    // `if (!row) throw 409` was always dead code.
    if (plan.status !== "draft") {
      throw new HttpError(409, "INVALID_STATE", "only a draft plan can be submitted for approval");
    }
    await publishF3Write(ctx, "manpower_planning_routes__3", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    // draft → pending_approval is the only transition submitPlan performs, and
    // the pre-check above already guarantees the plan qualifies, so this is a
    // deterministic outcome, not a guess — unlike the placeholder's `.status`
    // ("accepted"), which was never the plan's real status.
    return reply.send({ id, status: "pending_approval" });
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

    // CRASH FIX: this used to be `const result = await publishF3Write(...)`
    // followed by `result.approved.status` / `result.approved.approvedBy` /
    // `result.requisition`. publishF3Write only ever resolves the literal
    // placeholder `{ id, status: "accepted", correlationId }` (see
    // shared/f3-publish.ts) — it never returns the consumer's `{ approved,
    // requisition }` object, because the actual approval + requisition
    // generation happens later, asynchronously, in
    // manpower-planning/f3-consumer.ts (case __4). `result.approved` was
    // therefore always `undefined`, and `.status` on `undefined` threw a
    // TypeError on every single call — this was an unconditional crash on
    // every manpower-plan approval. The `if (!result)` guard just above was
    // also dead: `canApprove(plan, ctx.actorId)` above already performs the
    // real synchronous pre-check (maker-checker separation AND
    // `status === 'pending_approval'`, mirroring repo.approvePlan's own SQL
    // guard), so by the time we reach here the approval is known-valid and
    // the placeholder is always truthy anyway.
    //
    // The consumer still mints its own requisition id / requisition number /
    // job-opening id at write time (see f3-consumer.ts __4) — those genuinely
    // cannot be known synchronously here, so unlike the crash-causing fields
    // above, `requisition` is dropped from the response entirely rather than
    // guessed. Callers that need the generated requisition should read it
    // back via GET /v1/hrms/manpower/requisitions?planId=... once the write
    // has landed.
    await publishF3Write(ctx, "manpower_planning_routes__4", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.code(202).send({
      id, status: "approved", approvedBy: ctx.actorId, vacancy: vac.vacancy,
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
    // Synchronous pre-check, matching repo.rejectPlan's own
    // `status = 'pending_approval'` WHERE clause — see the __1/__3 handlers
    // above for why the old `if (!row) throw 409` was always dead code.
    if (plan.status !== "pending_approval") {
      throw new HttpError(409, "INVALID_STATE", "only a plan pending approval can be rejected");
    }
    await publishF3Write(ctx, "manpower_planning_routes__5", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    // pending_approval → rejected is the only transition rejectPlan performs,
    // and the pre-checks above already guarantee the plan qualifies.
    return reply.send({ id, status: "rejected" });
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
    // No further pre-check needed: repo.markRequisitionAdvertised has no
    // status guard in its WHERE clause (id + tenantId only), so the old
    // `if (!row) throw 409 "could not attach advertisement"` never
    // corresponded to a real failure mode in the consumer — it was dead
    // because `row` (the publishF3Write placeholder) is always truthy.
    await publishF3Write(ctx, "manpower_planning_routes__6", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    // `status: "advertised"` and `advertisementRef` are both deterministic —
    // markRequisitionAdvertised unconditionally sets status to "advertised"
    // and advertisementRef to the caller-supplied (already-validated) value;
    // neither needs the async write to be read back.
    return reply.send({ id, status: "advertised", advertisementRef: body.advertisementRef });
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
