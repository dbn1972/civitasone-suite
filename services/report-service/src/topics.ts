/** Topic + event names owned by report-service. {service}.{entity}.{action} */
export const COMMANDS = {
  createJob: "reports.job.create",
  renderJob: "reports.job.render",
  createTemplate: "reports.template.create",
  updateTemplate: "reports.template.update",
  deleteTemplate: "reports.template.delete",
  executeTemplate: "reports.template.execute",
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
  scheduledGenerated: "reports.scheduled.generated",
  scheduledDelivered: "reports.scheduled.delivered",
  scheduledFailed: "reports.scheduled.failed",
} as const;

export const SERVICE = "reports";
export const RESOURCE = "job";
