/** Topic + event names owned by report-service. {service}.{entity}.{action} */
export const COMMANDS = {
  createJob: "reports.job.create",
  renderJob: "reports.job.render",
} as const;

export const EVENTS = {
  jobCreated: "reports.job.created",
  jobCompleted: "reports.job.completed",
  jobFailed: "reports.job.failed",
} as const;

export const SERVICE = "reports";
export const RESOURCE = "job";
