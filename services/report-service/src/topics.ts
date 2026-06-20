/** Topic + event names owned by report-service. {service}.{entity}.{action} */
export const COMMANDS = {
  createJob: "reports.job.create",
} as const;

export const EVENTS = {
  jobCreated: "reports.job.created",
} as const;

export const SERVICE = "reports";
export const RESOURCE = "job";
