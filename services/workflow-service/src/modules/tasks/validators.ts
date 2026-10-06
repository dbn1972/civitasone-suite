import { z } from "zod";

export const idParam = z.object({ id: z.string().uuid() });

export const taskViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  instanceId: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  roleRef: z.string().nullable().optional(),
  nodeKey: z.string().nullable().optional(),
  refType: z.string().nullable().optional(),
  refId: z.string().uuid().nullable().optional(),
  decision: z.string().nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  // COMP-008 mytasks-cleanup — ISO string (matches the plain z.string()
  // convention used for createdAt/updatedAt elsewhere, e.g.
  // crm-service/modules/custom-fields/validators.ts), not z.date(): the
  // value crossing this boundary is repo.ts's toView() output, which already
  // calls dueAt?.toISOString() before this schema ever sees it.
  dueAt: z.string().nullable().optional(),
  // GAP-WORKFLOW-MY-TASKS-05 — task age (ISO string); see repo.ts toView.
  createdAt: z.string().nullable().optional(),
  version: z.number().int(),
});

export const completeTaskBody = z.object({
  decision: z.enum(["approve", "reject", "return"]).default("approve"),
  // GAP-HR-LEAVE-APPROVALS-03: optional approver remark / rejection reason,
  // persisted atomically with the decision (task history detail) and, for a
  // rejected leave_app, carried to the applicant-facing rejection notice.
  reason: z.string().trim().min(1).max(1000).optional(),
});

// GAP-HR-LEAVE-APPROVALS-04 — internal (service-account only) lookup: which of
// these record ids does `actorId` (holding `roles`) have an open task on?
export const openTaskRefsBody = z.object({
  actorId: z.string().uuid(),
  roles: z.array(z.string().min(1).max(128)).max(50),
  refType: z.string().min(1).max(64),
  refIds: z.array(z.string().uuid()).min(1).max(50),
});

// P1-1 — assign a task to a specific user.
export const assignTaskBody = z.object({
  assigneeId: z.string().uuid(),
  // SECURITY M-1 — overwriting an already-assigned task requires an explicit
  // reassign acknowledgement, so a silent reassignment can't happen by default.
  reassign: z.boolean().optional(),
});

// P1-3 — bulk-complete a set of tasks; each runs the per-task complete command.
export const bulkCompleteBody = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(200),
  decision: z.enum(["approve", "reject", "return"]).default("approve"),
});
