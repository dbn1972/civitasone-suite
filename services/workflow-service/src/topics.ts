export const COMMANDS = {
  createInstance: "workflow.instance.create",
  completeTask: "workflow.task.complete",
} as const;

export const EVENTS = {
  instanceCreated: "workflow.instance.created",
  taskCompleted: "workflow.task.completed",
  taskAssigned: "workflow.task.assigned",
} as const;

/** Cross-service commands dispatched when a workflow task completes. */
export const DISPATCH = {
  leaveApprove: "hrms.leave.approve",
  payrollRunApprove: "payroll.run.approve",
  indentApprove: "procurement.indent.approve",
  poApprove: "procurement.po.approve",
  fileApprove: "estab.file.approve",
  fileReject: "estab.file.reject",
  assetDisposeApprove: "asset.dispose.approve",
} as const;

export const SERVICE = "workflow";
export const INSTANCE_RESOURCE = "instance";
export const TASK_RESOURCE = "task";
