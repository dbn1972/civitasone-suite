export const COMMANDS = {
  createInstance: "workflow.instance.create",
  completeTask: "workflow.task.complete",
} as const;

export const EVENTS = {
  instanceCreated: "workflow.instance.created",
  taskCompleted: "workflow.task.completed",
} as const;

export const SERVICE = "workflow";
export const INSTANCE_RESOURCE = "instance";
export const TASK_RESOURCE = "task";
