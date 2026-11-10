/**
 * S8-G3 -- leave-type admin: edit, deactivate (maker-checker, ends allocations), reactivate,
 * end one allocation, retire unused types, and the per-tenant switch for the row-based resolver.
 *
 * Every write: HR-admin role guard, tenant-scoped reads (RLS), 202 + queue (the existing leave
 * convention), an audit event written by the consumer in the same transaction as the change.
 * The routes pre-check what they can so a doomed request answers 4xx instead of a false 202.
 */
import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { istToday } from "@civitasone/schemas/validators";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { idParam } from "./validators.js";
import {
  updateLeaveTypeBody, deactivateLeaveTypeBody, decideLeaveTypeChangeBody, rejectLeaveTypeChangeBody,
  endAllocationBody, retireUnusedBody, customRulesBody, leaveTypeAdminQuery, changeListQuery,
} from "./type-admin-validators.js";
import * as admin from "./type-admin-repo.js";
import * as cmd from "./type-admin-commands.js";
import { hrmsLeaveAllocs } from "./schema.js";
import { and, eq } from "drizzle-orm";

// Same set as policy-admin-routes.ts (leave-entitlement policy is an HR-admin call; hr_officer is read-only here).
const ADMIN_ROLES = ["hr_admin", "super_admin", "tenant_admin", "platform_admin"];
const READ_ROLES = [...ADMIN_ROLES, "hr_officer"];
const MAX_RETIRE_BATCH = 100;

export async function leaveTypeAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/admin/leave-types", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = leaveTypeAdminQuery.parse(req.query);
    const data = await scopedRead((tx) => admin.listLeaveTypesWithCounts(tx, ctx.tenantId, q.includeInactive !== "false", istToday()));
    return reply.send({ data });
  });

  app.patch("/v1/hrms/leave-types/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateLeaveTypeBody.parse(req.body);
    const lt = await scopedRead((tx) => admin.findLeaveType(tx, ctx.tenantId, id));
    if (!lt) throw new HttpError(404, "NOT_FOUND", "leave type not found");
    if (!lt.isActive) throw new HttpError(409, "LEAVE_TYPE_INACTIVE", "reactivate the leave type before editing it");
    if (body.expectedVersion !== undefined && body.expectedVersion !== lt.version) {
      throw new HttpError(409, "VERSION_CONFLICT", "this leave type was changed by someone else; reload and retry");
    }
    return sendAccepted(reply, acceptedResponseSchema, await cmd.updateLeaveType(ctx, id, body));
  });

  // Maker: ask to deactivate. dryRun reports the impact and writes nothing.
  app.post("/v1/hrms/leave-types/:id/deactivate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = deactivateLeaveTypeBody.parse(req.body);
    const { lt, impact, pending } = await scopedRead(async (tx) => {
      const lt = await admin.findLeaveType(tx, ctx.tenantId, id);
      if (!lt) return { lt: null, impact: null, pending: null };
      return { lt, impact: await admin.leaveTypeImpact(tx, ctx.tenantId, id, istToday()), pending: await admin.findPendingChangeForType(tx, ctx.tenantId, id) };
    });
    if (!lt || !impact) throw new HttpError(404, "NOT_FOUND", "leave type not found");
    if (!lt.isActive) throw new HttpError(409, "ALREADY_INACTIVE", "this leave type is already deactivated");
    const blockers = impact.openApplications > 0
      ? [{ code: "OPEN_APPLICATIONS", message: `${impact.openApplications} leave application(s) on this type are pending or approved and not yet over; finish or cancel them first` }]
      : [];
    if (body.dryRun) return reply.send({ leaveTypeId: id, code: lt.code, name: lt.name, impact, blockers, wouldEndAllocations: impact.activeAllocations });
    if (blockers.length > 0) throw new HttpError(409, blockers[0]!.code, blockers[0]!.message);
    if (pending) throw new HttpError(409, "CHANGE_ALREADY_PENDING", `a deactivation request for this leave type is already awaiting approval (${pending.id})`);
    return sendAccepted(reply, acceptedResponseSchema, await cmd.requestLeaveTypeDeactivation(ctx, id, body.reason, impact));
  });

  app.get("/v1/hrms/leave-type-changes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = changeListQuery.parse(req.query);
    return reply.send({ data: await scopedRead((tx) => admin.listChanges(tx, ctx.tenantId, q.status)) });
  });

  // Checker: approve / reject. The requester can never decide their own request.
  for (const decision of ["approve", "reject"] as const) {
    app.post(`/v1/hrms/leave-type-changes/:id/${decision}`, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, ADMIN_ROLES);
      const { id } = idParam.parse(req.params);
      const body = (decision === "reject" ? rejectLeaveTypeChangeBody : decideLeaveTypeChangeBody).parse(req.body ?? {});
      const change = await scopedRead((tx) => admin.findChange(tx, ctx.tenantId, id));
      if (!change) throw new HttpError(404, "NOT_FOUND", "change request not found");
      if (change.status !== "pending") throw new HttpError(409, "NOT_PENDING", `this request is already ${change.status}`);
      if (change.requestedBy === ctx.actorId) {
        throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "Maker-checker: you cannot decide your own request.");
      }
      return sendAccepted(reply, acceptedResponseSchema, await cmd.decideLeaveTypeChange(ctx, id, decision, body.note ?? null));
    });
  }

  app.post("/v1/hrms/leave-types/:id/reactivate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const lt = await scopedRead((tx) => admin.findLeaveType(tx, ctx.tenantId, id));
    if (!lt) throw new HttpError(404, "NOT_FOUND", "leave type not found");
    if (lt.isActive) throw new HttpError(409, "ALREADY_ACTIVE", "this leave type is already active");
    return sendAccepted(reply, acceptedResponseSchema, await cmd.reactivateLeaveType(ctx, id));
  });

  app.post("/v1/hrms/leave-allocations/:id/end", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = endAllocationBody.parse(req.body);
    const { alloc, open } = await scopedRead(async (tx) => {
      const rows = await tx.select().from(hrmsLeaveAllocs).where(and(eq(hrmsLeaveAllocs.tenantId, ctx.tenantId), eq(hrmsLeaveAllocs.id, id))).limit(1);
      const alloc = rows[0] ?? null;
      return { alloc, open: alloc ? await admin.countOpenApplicationsOnAllocation(tx, ctx.tenantId, id, istToday()) : 0 };
    });
    if (!alloc) throw new HttpError(404, "NOT_FOUND", "leave allocation not found");
    if (alloc.status === "ended") throw new HttpError(409, "ALREADY_ENDED", "this allocation is already ended");
    if (open > 0) throw new HttpError(409, "OPEN_APPLICATIONS", `${open} leave application(s) draw on this allocation; finish or cancel them first`);
    return sendAccepted(reply, acceptedResponseSchema, await cmd.endAllocation(ctx, id, body.reason));
  });

  // Types nobody has used. Dry run (default) lists them; otherwise one maker-checker deactivation request per type.
  app.post("/v1/hrms/leave-types/retire-unused", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = retireUnusedBody.parse(req.body ?? {});
    const candidates = await scopedRead((tx) => admin.listUnusedLeaveTypes(tx, ctx.tenantId));
    if (body.dryRun) return reply.send({ dryRun: true, candidates });
    if (!body.reason) throw new HttpError(422, "REASON_REQUIRED", "a reason is required to raise deactivation requests");
    if (candidates.length > MAX_RETIRE_BATCH) throw new HttpError(422, "TOO_MANY", `more than ${MAX_RETIRE_BATCH} candidates; retire them in smaller sets`);
    const empty = { activeAllocations: 0, employeesWithAllocations: 0, balanceDaysOnLiveAllocations: 0, openApplications: 0, totalApplications: 0 };
    const requests: Array<{ leaveTypeId: string; code: string; requestId: string }> = [];
    for (const c of candidates) {
      const accepted = await cmd.requestLeaveTypeDeactivation(ctx, c.id, body.reason, empty);
      requests.push({ leaveTypeId: c.id, code: c.code, requestId: accepted.id });
    }
    return reply.code(202).send({ dryRun: false, status: "accepted", correlationId: ctx.correlationId, requests });
  });

  // Per-tenant switch for the row-based resolver. Default OFF == the unchanged engine.
  app.get("/v1/hrms/leave-config/custom-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    return reply.send({ enabled: await scopedRead((tx) => admin.getCustomLeaveRulesEnabled(tx, ctx.tenantId)) });
  });

  app.put("/v1/hrms/leave-config/custom-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = customRulesBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await cmd.setCustomLeaveRules(ctx, body.enabled));
  });
}
