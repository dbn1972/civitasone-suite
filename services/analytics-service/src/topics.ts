/** Topic + event names owned by analytics-service. {service}.{entity}.{action} */
export const COMMANDS = {
  // queries
  runQuery: "analytics.query.run",
  scheduleQuery: "analytics.scheduled.create",
  createExport: "analytics.export.create",
  // dashboards
  createDashboard: "analytics.dashboard.create",
  updateDashboard: "analytics.dashboard.update",
  shareDashboard: "analytics.dashboard.share",
  addWidget: "analytics.widget.add",
  // metrics (tenant-scoped saved definitions)
  saveMetric: "analytics.metric.save",
} as const;

export const EVENTS = {
  queryRun: "analytics.query.run.completed",
  queryFailed: "analytics.query.run.failed",
  scheduledCreated: "analytics.scheduled.created",
  exportCreated: "analytics.export.created",
  dashboardCreated: "analytics.dashboard.created",
  dashboardUpdated: "analytics.dashboard.updated",
  dashboardShared: "analytics.dashboard.shared",
  widgetAdded: "analytics.widget.added",
  metricSaved: "analytics.metric.saved",
} as const;

/**
 * Inbound domain events analytics consumes into its OWN projection
 * (analytics.fact_events). This is how cross-domain data enters analytics
 * without ever reading another service's database.
 */
export const INBOUND = {
  financePaymentReleased: "finance.payment.released",
  grantReleaseProcessed: "grants.release.processed",
  procurementPoApproved: "procurement.po.approved",
} as const;

/** Audit sink consumed by audit-service. */
export const AUDIT_TOPIC = "audit.event.record";

export const SERVICE = "analytics";

// cache resource namespaces ({service}:{tenant}:{resource}:{id})
export const DASHBOARD_RESOURCE = "dashboard";
export const WIDGET_RESOURCE = "widget";
export const QUERY_RESOURCE = "query_run";
export const SCHEDULED_RESOURCE = "scheduled_query";
export const EXPORT_RESOURCE = "export_job";
export const METRIC_RESOURCE = "saved_metric";
export const FACT_RESOURCE = "fact_metric";
