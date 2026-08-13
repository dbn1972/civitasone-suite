/** Topic + event names owned by report-service. {service}.{entity}.{action} */
export const COMMANDS = {
  createJob: "reports.job.create",
  shareJob: "reports.job.share",
  renderJob: "reports.job.render",
  createTemplate: "reports.template.create",
  updateTemplate: "reports.template.update",
  deleteTemplate: "reports.template.delete",
  executeTemplate: "reports.template.execute",
  createScheduled: "reports.scheduled.create",
  updateScheduled: "reports.scheduled.update",
  disableScheduled: "reports.scheduled.disable",
  runScheduled: "reports.scheduled.run",
  scheduledGenerate: "reports.scheduled.generate",
} as const;

export const EVENTS = {
  jobCreated: "reports.job.created",
  jobCompleted: "reports.job.completed",
  jobFailed: "reports.job.failed",
  templateCreated: "reports.template.created",
  templateUpdated: "reports.template.updated",
  templateDeleted: "reports.template.deleted",
  templateExecuted: "reports.template.executed",
  scheduledCreated: "reports.scheduled.created",
  scheduledUpdated: "reports.scheduled.updated",
  scheduledDisabled: "reports.scheduled.disabled",
  scheduledGenerated: "reports.scheduled.generated",
  scheduledDelivered: "reports.scheduled.delivered",
  scheduledFailed: "reports.scheduled.failed",
} as const;

export const SERVICE = "reports";
export const RESOURCE = "job";
