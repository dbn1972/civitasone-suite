export const COMMANDS = {
  createInstance: "workflow.instance.create",
  completeTask: "workflow.task.complete",
  cancelInstance: "workflow.instance.cancel",
  suspendInstance: "workflow.instance.suspend",
  resumeInstance: "workflow.instance.resume",
  deliverMessage: "workflow.message.deliver",
  correlateMessage: "workflow.message.correlate",
  broadcastSignal: "workflow.signal.broadcast",
} as const;

export const EVENTS = {
  instanceCreated: "workflow.instance.created",
  taskCompleted: "workflow.task.completed",
  taskAssigned: "workflow.task.assigned",
  instanceCancelled: "workflow.instance.cancelled",
  instanceRejected: "workflow.instance.rejected",
  instanceSuspended: "workflow.instance.suspended",
  instanceResumed: "workflow.instance.resumed",
  messageDelivered: "workflow.message.delivered",
  messageReceived: "workflow.message.received",
  signalDelivered: "workflow.signal.delivered",
  signalReceived: "workflow.signal.received",
  messageTimeout: "workflow.message.timeout",
  // CAP-026 — a committee/quorum decision settled.
  committeeDecided: "workflow.committee.decided",
  // CAP-025 — a request exceeded the actor's authority and was escalated.
  authorityEscalated: "workflow.authority.escalated",
  // CAP-029 — instance finalization / reversal.
  instanceFinalized: "workflow.instance.finalized",
  instanceReversed: "workflow.instance.reversed",
} as const;

/** Cross-service commands dispatched when a workflow task completes. */
export const DISPATCH = {
  leaveApprove: "hrms.leave.approve",
  payrollRunApprove: "payroll.run.approve",
  indentApprove: "procurement.indent.approve",
  poApprove: "procurement.po.approve",
  fileApprove: "estab.file.approve",
  fileReject: "estab.file.reject",
  fileLevelApproved: "estab.file.level_approved",
  assetDisposeApprove: "asset.dispose.approve",
} as const;

export const SERVICE = "workflow";
export const INSTANCE_RESOURCE = "instance";
export const TASK_RESOURCE = "task";

/** Events consumed from other services. */
export const CONSUMED_EVENTS = {
  tenantCreated: "tenant.tenant.created",
} as const;
