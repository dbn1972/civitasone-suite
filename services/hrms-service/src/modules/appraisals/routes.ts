import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import type { RequestContext } from "@civitasone/types";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { AppraisalSummaryListSchema } from "@civitasone/schemas/web";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import * as employeeRepo from "../employee/repo.js";
import { resolveEmployeeForActor } from "../employee/actor-link.js";
import type { AppraisalRow } from "./schema.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const READER_ROLES = [...HR_ROLES, "manager"];

// This module's OWN stage vocabulary -- five stages, in order. NOT the same
// enum as apar/routes.ts's APAR_STAGES (that one has seven: self_pending,
// reporting_officer, reviewing_officer, accepting_authority, disclosed,
// representation, finalised). Both modules write hrms_appraisals.status on
// the SAME shared table (appraisals/schema.ts's hrmsAppraisals, imported
// as-is by apar/repo.ts), so don't conflate the two vocabularies when
// reading history/audit rows that could have come from either route file.
const APPRAISAL_STAGES = ["self_pending", "reporting_officer", "reviewing_officer", "accepting_authority", "completed"] as const;

/**
 * Returns the hrms_employees.id (NOT an actor id -- see
 * resolveAppraisalReadScope below, same identity-space caveat as
 * apar/routes.ts's stageOwner) authorised to perform the NEXT transition
 * out of `a`'s CURRENT stage. super_admin does not appear here -- it is
 * handled as an explicit, audited override in assertAppraisalStageOwner,
 * exactly like apar/routes.ts's stageOwner/assertStageOwner split.
 *
 * NOTE: reportingOfficerId/reviewingOfficerId/acceptingAuthorityId are only
 * ever populated on rows created through APAR's own create endpoint (POST
 * /v1/hrms/apar collects all three); THIS module's own POST
 * /v1/hrms/appraisals does not collect them, so a row created here will
 * have all three NULL and -- correctly, fail-closed -- nobody but
 * super_admin can advance it past self_pending. That gap is in the create
 * endpoint, not here; see the PR description for why it's out of scope for
 * this fix.
 */
function appraisalStageOwner(a: AppraisalRow): string | null {
  switch (a.status) {
    case "self_pending":        return a.employeeId;
    case "reporting_officer":   return a.reportingOfficerId;
    case "reviewing_officer":   return a.reviewingOfficerId;
    case "accepting_authority": return a.acceptingAuthorityId;
    default:                    return null; // "completed" (terminal) or an unrecognised status
  }
}

/**
 * Separation-of-duties + stage-order guard for PATCH .../stage, mirroring
 * apar/routes.ts's assertStageOwner (the reference implementation this
 * module's fix is modelled on -- see that function's comments for the full
 * rationale). Enforced HERE, synchronously, before the command is
 * published: appraisalAdvanceStage has exactly one publisher (this route)
 * and its consumer (consumer.ts) is a trusted-internal executor that never
 * receives a message that didn't already pass this gate -- the same trust
 * boundary apar/f3-consumer.ts relies on for apar/routes.ts's writes.
 *
 * Rules (identical to APAR's, not a looser variant):
 *  - Default authorisation is identity-based: the acting actor MUST BE the
 *    officer (or employee, for self_pending) assigned to the CURRENT stage.
 *  - hr_admin/hr_officer get NO bypass -- holding an HR role is not by
 *    itself sufficient to move someone else's appraisal forward; that would
 *    collapse the four-eyes chain exactly as it would for APAR.
 *  - Only super_admin may act as an explicit, audited override when not the
 *    assigned owner (returned as `override: true` so the caller can record
 *    it -- see consumer.ts's audit() call).
 *  - The appraisee can NEVER act as the officer for an officer stage, even
 *    as a would-be super_admin override -- checked BEFORE the override
 *    branch, so self-dealing is not overridable.
 *  - `stage` must be the SINGLE next stage after the row's current status
 *    (APPRAISAL_STAGES order) -- closes the "any enum value regardless of
 *    current status" gap; a caller can no longer jump straight to
 *    "completed" or replay an earlier stage.
 */
async function assertAppraisalStageOwner(
  ctx: RequestContext,
  req: FastifyRequest,
  a: AppraisalRow,
  targetStage: string,
): Promise<{ override: boolean }> {
  const currentIndex = APPRAISAL_STAGES.indexOf(a.status as (typeof APPRAISAL_STAGES)[number]);
  const isLastStage = currentIndex === APPRAISAL_STAGES.length - 1;
  const expectedNext = currentIndex >= 0 && !isLastStage ? APPRAISAL_STAGES[currentIndex + 1] : undefined;
  if (currentIndex === -1 || isLastStage || targetStage !== expectedNext) {
    throw new HttpError(409, "WRONG_STAGE",
      `appraisal is at stage '${a.status}'; cannot advance to '${targetStage}'`);
  }

  const ownerId = appraisalStageOwner(a);
  const actingEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  const actingEmployeeId = actingEmp?.id ?? null;
  const isOwner = ownerId !== null && actingEmployeeId !== null && actingEmployeeId === ownerId;
  if (isOwner) return { override: false };

  const OFFICER_STAGES = new Set(["reporting_officer", "reviewing_officer", "accepting_authority"]);
  if (OFFICER_STAGES.has(a.status) && actingEmployeeId !== null && actingEmployeeId === a.employeeId) {
    throw new HttpError(403, "SELF_REVIEW_FORBIDDEN",
      `the appraisee cannot act as the officer for stage '${a.status}'`);
  }
  if (ctx.roles.includes("super_admin")) {
    return { override: true }; // explicit, audited privileged override
  }
  throw new HttpError(403, "NOT_STAGE_OWNER",
    `actor is not the assigned owner of stage '${a.status}'`);
}

/**
 * Read-scope for GET /v1/hrms/appraisals, mirroring apar/routes.ts's
 * resolveAparReadScope exactly (see that function for the full rationale).
 *
 * Returns:
 *  - null      caller holds an HR_ROLES role -- unrestricted, tenant-wide.
 *  - string[]  caller is "employee" and/or "manager" -- the set of
 *              `employeeId` values (hrms_employees.id) this caller may
 *              read: their own resolved employee id, unioned with direct
 *              reports' employee ids for a manager (via
 *              hrms_employees.managerId, reusing employee/repo.ts's
 *              listByTenant(managerId) filter rather than duplicating
 *              apar/repo.ts's own copy of this lookup). An empty array
 *              means "sees nothing" -- fails CLOSED (e.g. no resolvable
 *              hrms_employees link), never falls back to "see everyone".
 */
async function resolveAppraisalReadScope(ctx: RequestContext, req: FastifyRequest): Promise<string[] | null> {
  if (HR_ROLES.some((r) => ctx.roles.includes(r))) return null;

  const allowed = new Set<string>();
  const needsOwnEmployee = ctx.roles.includes("employee") || ctx.roles.includes("manager");
  const ownEmp = needsOwnEmployee
    ? await resolveEmployeeForActor(ctx.tenantId, ctx.actorId)
    : undefined;

  if (ctx.roles.includes("employee") && ownEmp) {
    allowed.add(ownEmp.id);
  }
  if (ctx.roles.includes("manager") && ownEmp) {
    const reports = await employeeRepo.listByTenant(ctx.tenantId, 500, 0, undefined, ownEmp.id);
    for (const report of reports) allowed.add(report.id);
  }
  return [...allowed];
}

export async function appraisalRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/appraisals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const scope = await resolveAppraisalReadScope(ctx, req);
    sendValidated(reply, AppraisalSummaryListSchema, await queries.listAppraisals(ctx.tenantId, q.limit, scope));
  });

  app.post("/v1/hrms/appraisals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = z.object({
      employeeId: z.string().uuid(),
      appraisalPeriod: z.string().min(4).max(16),
      reviewerId: z.string().uuid().optional(),
    }).parse(req.body);
    const id = randomUUID();
    await queue.publish(COMMANDS.appraisalCreate, {
      messageId: id, type: COMMANDS.appraisalCreate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, employeeId: body.employeeId, appraisalPeriod: body.appraisalPeriod, reviewerId: body.reviewerId ?? null, status: "self_pending" },
    });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.patch("/v1/hrms/appraisals/:id/stage", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, [...HR_ROLES, "manager"]);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      stage: z.enum(APPRAISAL_STAGES),
      rating: z.string().optional(),
    }).parse(req.body);
    // Verify the appraisal exists before publishing the command
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "appraisal not found");
    // SoD + stage-order guard (C2/IDOR fix) -- see assertAppraisalStageOwner.
    // Enforced synchronously here, before publish: this is the only
    // publisher of appraisalAdvanceStage (confirmed via repo-wide grep), so
    // gating here closes the gap for every real caller.
    const { override } = await assertAppraisalStageOwner(ctx, req, existing, body.stage);
    const messageId = randomUUID();
    await queue.publish(COMMANDS.appraisalAdvanceStage, {
      messageId, type: COMMANDS.appraisalAdvanceStage,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, stage: body.stage, rating: body.rating ?? null, override },
    });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
