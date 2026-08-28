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
  deleteDashboard: "analytics.dashboard.delete",
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
  dashboardDeleted: "analytics.dashboard.deleted",
  widgetAdded: "analytics.widget.added",
  metricSaved: "analytics.metric.saved",
} as const;

/**
 * Inbound domain events analytics consumes into its OWN projection
 * (analytics.fact_events). This is how cross-domain data enters analytics
 * without ever reading another service's database.
 */
export const INBOUND = {
  // finance / grants / procurement (money facts)
  financePaymentMade: "finance.payment.made",
  grantDisbursementCompleted: "grant.disbursement.completed",
  procurementPoApproved: "procurement.po.approved",
  // governance (meeting-service) — attendance / voting / completion facts
  meetingAttendanceMarked: "meeting.attendance.marked",
  meetingVoteConcluded: "meeting.vote.concluded",
  meetingCompleted: "meeting.meeting.completed",
  // judiciary (court-service) — case lifecycle + hearing facts
  courtCaseRegistered: "court.case.registered",
  courtCaseStatusChanged: "court.case.status_changed",
  courtHearingScheduled: "court.hearing.scheduled",
  // premises (visitor-service) — footfall + overstay facts
  visitorCheckedIn: "visitor.checked_in",
  visitorOverstayAlerted: "visitor.overstay.alerted",
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
