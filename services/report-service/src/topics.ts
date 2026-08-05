/** Topic + event names owned by report-service. {service}.{entity}.{action} */
export const COMMANDS = {
  createJob: "reports.job.create",
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

  // ── G4: metric (KPI) definition catalogue ────────────────────────────────
  /**
   * Create a metric definition as a `draft`.
   * Payload: the full MetricDefinitionView projection
   * `{ id, tenantId, metricKey, displayName, description, module, unit, aggregation,
   *    numeratorSource, denominatorSource, dimensions, period, targetValue,
   *    higherIsBetter, governance, versionNumber, status: "draft", version: 1 }`.
   * Fires when POST /v1/reports/metrics passes zod + domain validation.
   */
  createMetricDefinition: "reports.metric_definition.create",
  /**
   * Patch a definition's mutable fields under an optimistic lock.
   * Payload: `{ id, version, patch: Record<string, unknown> }` where `patch` only
   * contains fields the governance gate (domain.checkPatchAllowed) allowed.
   * Fires on PATCH /v1/reports/metrics/:id.
   */
  updateMetricDefinition: "reports.metric_definition.update",
  /**
   * Move a definition `draft → published` and stamp `publishedAt`.
   * Payload: `{ id, version, metricKey }`.
   * Fires on POST /v1/reports/metrics/:id/publish.
   */
  publishMetricDefinition: "reports.metric_definition.publish",
  /**
   * Move a definition `published → deprecated` and stamp `deprecatedAt`.
   * Payload: `{ id, version, metricKey }`.
   * Fires on POST /v1/reports/metrics/:id/deprecate.
   */
  deprecateMetricDefinition: "reports.metric_definition.deprecate",
  /**
   * Insert the next `versionNumber` of a definition as a new draft row, copied
   * from the source row. The source row is NOT modified.
   * Payload: the full projected draft `{ id, sourceId, tenantId, ...definition,
   * versionNumber, status: "draft", version: 1 }`.
   * Fires on POST /v1/reports/metrics/:id/versions.
   */
  versionMetricDefinition: "reports.metric_definition.version",
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

  // ── G4: metric (KPI) definition catalogue ────────────────────────────────
  /**
   * A metric definition draft was persisted.
   * Payload: `{ id, metricKey, versionNumber, governance }`. Consumers (analytics,
   * ai-agent) use it to learn that a new measurement point exists but is not yet
   * authoritative — only `published` definitions should be computed against.
   */
  metricDefinitionCreated: "reports.metric_definition.created",
  /** A definition's mutable fields changed. Payload: `{ id, metricKey, patch }`. */
  metricDefinitionUpdated: "reports.metric_definition.updated",
  /**
   * A definition became authoritative for its `metricKey`.
   * Payload: `{ id, metricKey, versionNumber, publishedAt }`. This is the event
   * downstream computation should key off: it means "start measuring this".
   */
  metricDefinitionPublished: "reports.metric_definition.published",
  /**
   * A definition was retired. Payload: `{ id, metricKey, versionNumber, deprecatedAt }`.
   * Historical values stay valid; no new values should be computed for it.
   */
  metricDefinitionDeprecated: "reports.metric_definition.deprecated",
  /**
   * A new `versionNumber` draft was forked from an existing definition.
   * Payload: `{ id, sourceId, metricKey, versionNumber }`.
   */
  metricDefinitionVersioned: "reports.metric_definition.versioned",
} as const;

export const SERVICE = "reports";
export const RESOURCE = "job";
