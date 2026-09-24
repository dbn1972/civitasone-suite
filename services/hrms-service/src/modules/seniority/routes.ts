/**
 * Seniority + DPC (Departmental Promotion Committee) eligibility lists.
 *
 *  GET /v1/hrms/seniority?departmentId=&designationId=
 *      Ranked seniority list. Order: date_of_joining ASC (earlier = senior),
 *      tie-break date_of_birth ASC (older = senior), then merit (overall APAR
 *      grade) DESC as final tie-break.
 *
 *  GET /v1/hrms/dpc/eligibility?designationId=&minQualifyingYears=&asOf=
 *      Eligibility list for promotion: filters the seniority list to officers
 *      with at least `minQualifyingYears` of qualifying service in the grade
 *      (measured from date_of_joining, or confirmation_date if present) as of
 *      `asOf` (default today). Returns eligible + ineligible buckets.
 *
 *  POST /v1/hrms/seniority/generate
 *      DOM-019: publishes `hrms.seniority.generate` so `seniority/consumer.ts`
 *      persists a point-in-time snapshot (hrms_seniority_lists +
 *      hrms_seniority_list_entries). Before this route existed, that consumer
 *      (and DOM-004's real-persistence fix to it) was unreachable — nothing
 *      in the fleet ever published the command.
 *
 *  POST /v1/hrms/seniority/:id/approve
 *      DOM-019: publishes `hrms.seniority.approve` for the generated list
 *      `:id`. Same unreachable-consumer gap as generate above.
 *
 *      DOM-023 fix: the consumer's status-guarded UPDATE silently no-ops
 *      (log warning only, no error surfaced anywhere) when `:id` doesn't
 *      exist for this tenant or is no longer in "generated" status -- e.g. a
 *      double-approve, approving a stale/already-approved id, or a race with
 *      the generate consumer. A bare 202 can't tell the caller which of
 *      those happened, so this route now pre-checks the list's current state
 *      synchronously before publishing and rejects with a real 404/422 for
 *      the two common cases, mirroring the read-check-then-publish idiom CRM
 *      uses for its own pending-state approvals
 *      (campaign-approval-routes.ts: getPendingCampaign + status check
 *      before publish). The actual mutation still happens asynchronously in
 *      the consumer -- this closes the two known silent-no-op cases, not
 *      every possible race -- so the frontend still treats the 202 as
 *      "submitted", not "confirmed done" (see SeniorityListActions.tsx).
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RequestContext } from "@civitasone/types";
import { z, ZodError } from "zod";
import { and, eq } from "drizzle-orm";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { resolveEmployeeForActor, extractActorEmail } from "../employee/actor-link.js";
import { buildSeniority } from "./engine.js";
import { hrmsSeniorityLists } from "./schema.js";

const READER_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager"];
// Generate/approve are write actions that create an auditable, persisted
// snapshot — gated to HR admin/officer (+ super_admin), not the broader
// read-only "manager" role that can see the live GET views above.
const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];

/**
 * SEC finding (HRMS role review, seniority/DPC reads): READER_ROLES lets a
 * bare "manager" read the live seniority ranking / DPC-eligibility list for
 * ANY department, tenant-wide — filter.departmentId below is entirely
 * caller-supplied and optional, so a manager who simply omits it (or passes
 * a department that isn't their own) gets every department's ranking, not
 * just their own.
 *
 * This is a DIFFERENT scoping dimension from employee/routes.ts's
 * resolveManagerScope (which restricts a manager to their direct reports,
 * via hrmsEmployees.managerId, for the employee directory/detail routes):
 * DPC seniority is inherently a departmental comparison — officers are
 * ranked and judged eligible against their own department's peers in the
 * same cadre, not against "people who report to this specific manager".
 * Keyed on departmentId here for that reason, not managerId; the two
 * helpers are intentionally not unified.
 *
 * Does NOT touch computeSeniority/buildSeniority (engine.ts) at all —
 * engine.ts already accepts and correctly applies filter.departmentId; this
 * only decides, at the route layer, WHAT departmentId value a manager-only
 * caller is allowed to supply. engine.ts's ranking/eligibility computation
 * itself (including the separate, deliberately-unaddressed sealed-cover-for-
 * suspended-employees gap around its own status filter) is unrelated and
 * unchanged.
 *
 * Returns:
 *  - `requested` unchanged (string | undefined) — HR_ROLES caller: any
 *    department, or none = every department (unrestricted, unchanged).
 *  - a departmentId string — manager-only caller, forced onto their OWN
 *    hrms_employees.departmentId regardless of what (if anything) they
 *    requested.
 *  - null — manager-only caller with NO resolvable employee link. Callers
 *    MUST treat this as "nothing to show" (fails CLOSED), never fall
 *    through to an unscoped query.
 */
async function resolveManagerDepartmentScope(
  ctx: RequestContext,
  req: FastifyRequest,
  requested: string | undefined,
): Promise<string | undefined | null> {
  const isHrActor = HR_ROLES.some((r) => ctx.roles.includes(r));
  if (isHrActor) return requested;
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId, extractActorEmail(req));
  return actorEmp ? actorEmp.departmentId : null;
}

export async function seniorityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/seniority", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({
      departmentId: z.string().uuid().optional(),
      designationId: z.string().uuid().optional(),
      asOf: z.string().optional(),
    }).parse(req.query);
    const asOf = q.asOf ?? new Date().toISOString().slice(0, 10);
    // Dept-scoping: a manager-only caller is always forced onto their own
    // department, regardless of what (if anything) they requested.
    const departmentScope = await resolveManagerDepartmentScope(ctx, req, q.departmentId);
    if (departmentScope === null) return reply.send({ asOf, count: 0, data: [] });
    const filter: { departmentId?: string; designationId?: string } = {};
    if (departmentScope) filter.departmentId = departmentScope;
    if (q.designationId) filter.designationId = q.designationId;
    const list = await buildSeniority(ctx.tenantId, filter, asOf);
    return reply.send({ asOf, count: list.length, data: list });
  });

  app.get("/v1/hrms/dpc/eligibility", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({
      departmentId: z.string().uuid().optional(),
      designationId: z.string().uuid().optional(),
      minQualifyingYears: z.coerce.number().min(0).max(40).default(5),
      asOf: z.string().optional(),
    }).parse(req.query);
    const asOf = q.asOf ?? new Date().toISOString().slice(0, 10);
    const departmentScope = await resolveManagerDepartmentScope(ctx, req, q.departmentId);
    if (departmentScope === null) {
      return reply.send({
        asOf, minQualifyingYears: q.minQualifyingYears,
        eligibleCount: 0, ineligibleCount: 0, eligible: [], ineligible: [],
      });
    }
    const filter: { departmentId?: string; designationId?: string } = {};
    if (departmentScope) filter.departmentId = departmentScope;
    if (q.designationId) filter.designationId = q.designationId;
    const list = await buildSeniority(ctx.tenantId, filter, asOf);
    const eligible = list.filter((r) => r.qualifyingYears >= q.minQualifyingYears)
      .map((r, i) => ({ ...r, eligibilityRank: i + 1 }));
    const ineligible = list.filter((r) => r.qualifyingYears < q.minQualifyingYears);
    return reply.send({
      asOf, minQualifyingYears: q.minQualifyingYears,
      eligibleCount: eligible.length, ineligibleCount: ineligible.length,
      eligible, ineligible,
    });
  });

  app.post("/v1/hrms/seniority/generate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = z.object({
      departmentId: z.string().uuid().optional(),
      designationId: z.string().uuid().optional(),
      asOf: z.string().optional(),
    }).parse(req.body ?? {});
    const id = randomUUID();
    const asOf = body.asOf ?? new Date().toISOString().slice(0, 10);
    await queue.publish(COMMANDS.seniorityGenerate, {
      messageId: id, type: COMMANDS.seniorityGenerate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: {
        id, tenantId: ctx.tenantId,
        departmentId: body.departmentId, designationId: body.designationId,
        asOf, requestedBy: ctx.actorId,
      },
    });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/hrms/seniority/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      remarks: z.string().max(2000).optional(),
    }).parse(req.body ?? {});

    const [existing] = await scopedRead((tx) => tx.select().from(hrmsSeniorityLists)
      .where(and(
        eq(hrmsSeniorityLists.tenantId, ctx.tenantId),
        eq(hrmsSeniorityLists.id, id),
      ))
      .limit(1));
    if (!existing) {
      throw new HttpError(404, "SENIORITY_LIST_NOT_FOUND", "seniority list not found");
    }
    if (existing.status !== "generated") {
      throw new HttpError(422, "INVALID_STATUS", `seniority list is already ${existing.status}`);
    }

    const messageId = randomUUID();
    await queue.publish(COMMANDS.seniorityApprove, {
      messageId, type: COMMANDS.seniorityApprove,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: {
        id: messageId, tenantId: ctx.tenantId,
        seniorityListId: id, approvedBy: ctx.actorId, remarks: body.remarks,
      },
    });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
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
