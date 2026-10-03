import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateLeaveTypeBody, AllocateLeaveBody, ApplyLeaveBody, LeaveTenantConfigBody } from "./validators.js";
import * as repo from "./repo.js";
import { HttpError } from "../../shared/context.js";
import { assertLeaveAppStatusTransition, DomainError } from "./domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createLeaveType(ctx: RequestContext, body: CreateLeaveTypeBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.leaveTypeCreate, {
    messageId: id, type: COMMANDS.leaveTypeCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function allocateLeave(ctx: RequestContext, body: AllocateLeaveBody): Promise<Accepted> {
  // GAP-HR-LEAVE-ALLOCATE-02: synchronous pre-check ahead of the queue
  // publish, same pattern as approveLeave/rejectLeave's own pre-checks
  // above -- without it, a duplicate allocation only ever failed (if at
  // all) deep inside the async consumer, after the caller already got a
  // 202. Recommended default (no clear existing precedent either way):
  // reject, don't silently top up -- a top-up would need its own explicit
  // arithmetic (add to totalDays/balanceDays vs replace) that nothing here
  // defines. Real races (two concurrent requests both passing this check)
  // are still closed by the unique index + onConflictDoNothing in
  // repo.insertLeaveAlloc (migration 0163) -- this check alone cannot.
  const existing = await repo.findAllocByEmpAndType(ctx.tenantId, body.employeeId, body.leaveTypeId, body.fy);
  if (existing) {
    throw new HttpError(409, "ALLOCATION_EXISTS", `an allocation already exists for this employee, leave type and financial year (${body.fy})`);
  }
  // GAP-HR-LEAVE-ALLOCATE-03: server-side policy cap. Default policy
  // (conservative, overridable): totalDays above the type's configured
  // maxDays (leave-types.max_days; 0 == no cap) is refused (422) unless the
  // caller sets exceedMax with a reason -- so a typo (40 for 4) cannot slip
  // through, while a pro-rated/special grant stays possible and audited.
  const leaveType = await repo.findLeaveTypeById(body.leaveTypeId, ctx.tenantId);
  // 422 (not 404): the REQUEST references a leave type that does not exist; the route itself exists.
  if (!leaveType) throw new HttpError(422, "UNKNOWN_LEAVE_TYPE", "leave type not found");
  const exceedsMax = leaveType.maxDays > 0 && body.totalDays > leaveType.maxDays;
  // Overriding the policy maximum is an entitlement decision: only an admin
  // may do it (an hr_officer who needs more must ask an hr_admin).
  if (body.exceedMax && !["hr_admin", "super_admin"].some((r) => ctx.roles.includes(r))) {
    throw new HttpError(403, "FORBIDDEN", "only an hr_admin or super_admin may allocate above a leave type's maximum");
  }
  if (exceedsMax && !body.exceedMax) {
    throw new HttpError(422, "EXCEEDS_TYPE_MAX", `${body.totalDays} days is above the ${leaveType.maxDays}-day maximum for ${leaveType.name}; confirm the override with a reason to allocate more`);
  }
  if (exceedsMax && !body.reason) {
    throw new HttpError(422, "REASON_REQUIRED", "a reason is required to allocate above the leave type's maximum");
  }
  const { exceedMax: _override, ...rest } = body;
  const id = randomUUID();
  await queue.publish(COMMANDS.leaveAllocate, {
    messageId: id, type: COMMANDS.leaveAllocate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...rest, balanceDays: body.totalDays, exceededTypeMax: exceedsMax },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function applyLeave(ctx: RequestContext, body: ApplyLeaveBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.leaveApply, {
    messageId: id, type: COMMANDS.leaveApply,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body, status: "pending" },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function setLeaveTenantConfig(ctx: RequestContext, body: LeaveTenantConfigBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.leaveTenantConfigSet, {
    messageId: id, type: COMMANDS.leaveTenantConfigSet,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveLeave(ctx: RequestContext, id: string): Promise<Accepted> {
  const leaveApp = await repo.findLeaveAppById(id, ctx.tenantId);
  if (!leaveApp) throw new HttpError(404, "NOT_FOUND", "leave application not found");
  if (leaveApp.createdBy === ctx.actorId) {
    throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "Maker-checker: you cannot approve your own leave application.");
  }
  // HIGH fix: mirror rejectLeave's BUG-5 synchronous pre-check below — it was
  // missing here entirely. Without it, a stale/duplicate approve call (e.g.
  // an already-approved, already-rejected, or already-cancelled application)
  // gets a false 202 while the write silently fails deep in the async
  // consumer: the consumer's catch block only special-cases
  // LEAVE_ALREADY_PROCESSED (H2's race-safe "WHERE status='pending'" guard),
  // so a DomainError thrown by assertLeaveAppStatusTransition there is NOT
  // caught by that special case and instead propagates as an unhandled
  // consumer failure with no clear signal back to the caller. Assert the
  // transition is legal *before* returning 202, using the same leaveApp row
  // already fetched above for the self-approval check.
  try {
    assertLeaveAppStatusTransition(leaveApp.status, "approved");
  } catch (err) {
    if (err instanceof DomainError) throw new HttpError(409, err.code, err.message);
    throw err;
  }
  const messageId = randomUUID();
  await queue.publish(COMMANDS.leaveApprove, {
    messageId, type: COMMANDS.leaveApprove,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, approvedBy: ctx.actorId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "leave_app", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function rejectLeave(ctx: RequestContext, id: string, reason: string): Promise<Accepted> {
  const leaveApp = await repo.findLeaveAppById(id, ctx.tenantId);
  if (!leaveApp) throw new HttpError(404, "NOT_FOUND", "leave application not found");
  // BUG-3 fix: mirror approveLeave's maker-checker self-check — it was missing
  // here entirely, letting an applicant reject their own application.
  if (leaveApp.createdBy === ctx.actorId) {
    throw new HttpError(403, "SELF_APPROVAL_FORBIDDEN", "Maker-checker: you cannot reject your own leave application.");
  }
  // BUG-5 fix: synchronous pre-check mirroring the payroll duplicate-run guard
  // pattern (commands.ts fast-path ahead of the queue publish) — assert the
  // transition is legal *before* returning 202, instead of letting an
  // approved->rejected request accept and then silently no-op inside the async
  // consumer (assertLeaveAppStatusTransition already enforces this there).
  try {
    assertLeaveAppStatusTransition(leaveApp.status, "rejected");
  } catch (err) {
    if (err instanceof DomainError) throw new HttpError(409, err.code, err.message);
    throw err;
  }
  const messageId = randomUUID();
  await queue.publish(COMMANDS.leaveReject, {
    messageId, type: COMMANDS.leaveReject,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, rejectedBy: ctx.actorId, reason },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "leave_app", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
