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
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { and, eq } from "drizzle-orm";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { buildSeniority } from "./engine.js";
import { hrmsSeniorityLists } from "./schema.js";

const READER_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager"];
// Generate/approve are write actions that create an auditable, persisted
// snapshot — gated to HR admin/officer (+ super_admin), not the broader
// read-only "manager" role that can see the live GET views above.
const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];

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
    const filter: { departmentId?: string; designationId?: string } = {};
    if (q.departmentId) filter.departmentId = q.departmentId;
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
    const filter: { departmentId?: string; designationId?: string } = {};
    if (q.departmentId) filter.departmentId = q.departmentId;
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
