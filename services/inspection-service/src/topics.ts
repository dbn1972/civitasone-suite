/**
 * Topic + event names owned by inspection-service. Naming: {service}.{entity}.{action}
 *
 * This file is the single source of truth for the inspection-service message contract.
 * - COMMANDS         — write intents published by routes (route → zod → queue.publish → 202)
 * - EVENTS           — domain facts published via the transactional outbox after a DB write
 * - CONSUMED_EVENTS  — events owned by OTHER services that inspection-service subscribes to
 *
 * Each entry carries a JSDoc payload contract describing the message body. All payloads are
 * wrapped in the standard CivitasOne CommandEnvelope (`{ messageId, tenantId, actorId,
 * correlationId, occurredAt, payload }`); the JSDoc below documents the `payload` shape only.
 *
 * Cross-service contract note (per steering docs): when a CONSUMED_EVENT contract changes, the
 * publisher's topics.ts and this file must be updated together. Consumers MUST tolerate unknown
 * additional fields (forward-compatible) and treat new optional fields as additive.
 *
 * _Requirements: 1.4, 1.7_
 */

/** Service identifier — first segment of every owned topic name. */
export const SERVICE = "inspection";

/**
 * Commands — write intents. Published by HTTP routes after zod validation; handled by consumers
 * which call markProcessed(tx, messageId) first, then write, then enqueue EVENTS.
 */
export const COMMANDS = {
  // ── Universe ─────────────────────────────────────────────────────────────
  /** payload: { registrationNo, entityType, name, jurisdiction, addressLine1, addressLine2?, city, state, pincode, latitude?, longitude?, riskCategory, metadata? } */
  entityCreate: "inspection.entity.create",
  /** payload: { entityId, version, patch: Partial<EntityEditableFields> } — optimistic lock via version */
  entityUpdate: "inspection.entity.update",
  /** payload: { code, name, applicableEntityTypes, requiredCompetencies, defaultTemplateIds?, regulatoryBasis? } */
  inspectionTypeCreate: "inspection.type.create",
  /** payload: { actReference, sectionNumber, description, penaltyClause?, severityClassification } */
  provisionCreate: "inspection.provision.create",
  /** payload: { category, code, label, description?, sortOrder?, effectiveFrom?, effectiveTo? } — insert or update by category+code */
  vocabularyUpsert: "inspection.vocabulary.upsert",

  // ── Risk ─────────────────────────────────────────────────────────────────
  /** payload: { name, factors: Array<{ factorName, weight, scoringFunction, dataSource }> } — weights must sum to 1.0 (±0.001) */
  riskModelConfigure: "inspection.risk_model.configure",
  /** payload: { entityId, modelId? } — compute and persist composite risk score for a single entity */
  riskScoreCompute: "inspection.risk_score.compute",
  /** payload: { entityIds?: string[], modelId?, riskCategoryFilter? } — batch compute for multiple entities or a filtered set */
  riskScoreBatchCompute: "inspection.risk_score.batch_compute",

  // ── Planning ─────────────────────────────────────────────────────────────
  /** payload: { name, period, riskScoreThreshold?, lastInspectionBefore?, mandatoryFrequencyDays?, entityIds? } */
  planCreate: "inspection.plan.create",
  /** payload: { planId, version, patch: Partial<PlanEditableFields> } — allowed only in draft status */
  planModify: "inspection.plan.modify",
  /** payload: { planId, version } — submit draft plan to workflow-service for multi-level approval */
  planSubmitApproval: "inspection.plan.submit_approval",
  /** payload: { planId, version } — transition approved plan to active status */
  planActivate: "inspection.plan.activate",

  // ── Assignment ───────────────────────────────────────────────────────────
  /** payload: { inspectionId, inspectorId, competencies?, conflictCheckBypass? } — validates competency + conflict-of-interest */
  inspectorAssign: "inspection.inspector.assign",
  /** payload: { inspectorId, periodStart, periodEnd, maxDailyInspections? } — groups inspections by geo proximity, respects leave */
  tourPlanGenerate: "inspection.tour_plan.generate",
  /** payload: { inspectionId, inspectorId, latitude, longitude, deviceId, timestamp } — validated against entity geofence */
  geoAttendanceMark: "inspection.geo_attendance.mark",

  // ── Checklist ────────────────────────────────────────────────────────────
  /** payload: { name, inspectionTypeId?, sections: Array<{ title, questions: Array<{ fieldType, label, validationRules?, helpText?, weight? }> }> } */
  templateCreate: "inspection.template.create",
  /** payload: { templateId, version } — assigns version number and makes template immutable */
  templatePublish: "inspection.template.publish",
  /** payload: { inspectionId, templateId, templateVersion } — deep-copies template structure bound to inspection */
  instanceGenerate: "inspection.instance.generate",
  /** payload: { instanceId, responses: Array<{ questionId, value, capturedAt? }> } — scores computed server-side */
  instanceSubmitResponse: "inspection.instance.submit_response",

  // ── Sync ─────────────────────────────────────────────────────────────────
  /** payload: { inspectorId, inspectionIds?, includeMapTiles? } — generates offline bundle (checklists, entities, maps) */
  syncPackageGenerate: "inspection.sync_package.generate",
  /** payload: { inspectorId, deviceId, sequenceNumber, records: Array<SyncRecord>, sha256Hashes? } — idempotent by sequenceNumber */
  syncUpload: "inspection.sync.upload",

  // ── Evidence ─────────────────────────────────────────────────────────────
  /** payload: { inspectionId, findingId?, fileType, sha256, captureLatitude?, captureLongitude?, captureTimestamp, deviceId, storagePath } */
  evidenceRegister: "inspection.evidence.register",
  /** payload: { evidenceId } — recomputes SHA-256 and compares against stored hash; flags tampered if mismatch */
  evidenceVerifyIntegrity: "inspection.evidence.verify_integrity",

  // ── Execution ────────────────────────────────────────────────────────────
  /** payload: { inspectionId, to: InspectionState, remarks? } — validates allowed transitions per state machine */
  inspectionTransition: "inspection.inspection.transition",
  /** payload: { inspectionId, reviewingOfficerId? } — assigns reviewer and transitions to under_review */
  inspectionSubmitReview: "inspection.inspection.submit_review",
  /** payload: { inspectionId, version } — generates report, locks all data, transitions to finalized */
  inspectionFinalize: "inspection.inspection.finalize",

  // ── Findings ─────────────────────────────────────────────────────────────
  /** payload: { inspectionId, questionId?, provisionId, severity, description, evidenceIds? } — assigns finding number FND-{YYYY}-{SEQ:6} */
  findingCreate: "inspection.finding.create",
  /** payload: { findingId, dueDate, requiredAction, responsibleParty } — creates compliance notice with deadline */
  complianceNoticeCreate: "inspection.compliance_notice.create",
  /** payload: { findingId, verificationEvidenceIds?, verifierNotes? } — transitions finding to closed with verification */
  findingVerifyResolved: "inspection.finding.verify_resolved",
} as const;

/**
 * Events — domain facts emitted via the transactional outbox after a successful DB write.
 * Consumed by audit-service, analytics-service, notification-service, and workflow-service.
 * All event payloads include at minimum: { tenantId, occurredAt } plus the fields below.
 */
export const EVENTS = {
  // ── Universe ─────────────────────────────────────────────────────────────
  /** payload: { entityId, registrationNo, entityType, name, jurisdiction, riskCategory } — fires after entity persisted */
  entityCreated: "inspection.entity.created",
  /** payload: { entityId, version, changedFields: string[] } — fires after entity update committed */
  entityUpdated: "inspection.entity.updated",

  // ── Risk ─────────────────────────────────────────────────────────────────
  /** payload: { entityId, previousScore, newScore, modelId, factorBreakdown: Array<{ factor, score, weight }>, computedAt } */
  riskScoreComputed: "inspection.risk_score.computed",

  // ── Planning ─────────────────────────────────────────────────────────────
  /** payload: { planId, name, period, approvedBy, approvedAt } — fires when plan transitions to active after approval */
  planApproved: "inspection.plan.approved",

  // ── Assignment ───────────────────────────────────────────────────────────
  /** payload: { inspectionId, inspectorId, assignedBy, competencies } — fires after successful assignment (no conflicts) */
  inspectorAssigned: "inspection.inspector.assigned",

  // ── Execution ────────────────────────────────────────────────────────────
  /** payload: { inspectionId, entityId, inspectorId, startedAt, geoLatitude?, geoLongitude? } — fires on scheduled → in_progress */
  inspectionStarted: "inspection.inspection.started",
  /** payload: { inspectionId, entityId, inspectorId, completedAt, checklistScore? } — fires on in_progress → completed */
  inspectionCompleted: "inspection.inspection.completed",
  /** payload: { inspectionId, entityId, finalizedBy, finalizedAt, reportRef? } — fires on under_review → finalized (data locked) */
  inspectionFinalized: "inspection.inspection.finalized",

  // ── Findings ─────────────────────────────────────────────────────────────
  /** payload: { findingId, findingNumber, inspectionId, provisionId, severity, entityId } — fires when finding is recorded */
  findingCreated: "inspection.finding.created",
  /** payload: { findingId, findingNumber, inspectionId, entityId, dueDate, daysOverdue } — fires when compliance notice due date passes without resolution */
  findingOverdue: "inspection.finding.overdue",
  /** payload: { findingId, findingNumber, inspectionId, entityId, closedAt, verifiedBy } — fires when finding verified as resolved */
  findingClosed: "inspection.finding.closed",

  // ── Evidence ─────────────────────────────────────────────────────────────
  /** payload: { evidenceId, inspectionId, fileType, sha256, storagePath } — fires after evidence metadata persisted */
  evidenceRegistered: "inspection.evidence.registered",
  /** payload: { evidenceId, inspectionId, expectedHash, actualHash } — fires when integrity check detects hash mismatch */
  evidenceTampered: "inspection.evidence.tampered",

  // ── Sync ─────────────────────────────────────────────────────────────────
  /** payload: { packageId, inspectorId, inspectionIds, generatedAt, sizeBytes? } — fires when offline package is ready for download */
  syncPackageReady: "inspection.sync_package.ready",
} as const;

/**
 * Consumed events — owned by other services. inspection-service subscribes to these to stitch
 * cross-service behavior. Consumers MUST be idempotent and tolerate unknown extra fields.
 *
 * Cross-service contracts (payload shapes as guaranteed by the publishing service):
 */
export const CONSUMED_EVENTS = {
  /**
   * Owner: workflow-service. Fires when a plan approval workflow reaches a decision.
   * payload: { workflowInstanceId, entityType: "inspection_plan", entityId, outcome: "approved" | "rejected", actorId, decidedAt }
   * Action: transition plan to active (if approved) or back to draft (if rejected). Req 3.5, 3.7
   */
  planApprovalDecided: "inspection.plan.approval_decided",
  /**
   * Owner: hrms-service. Fires when employee leave or availability changes.
   * payload: { employeeId, tenantId, leaveType, startDate, endDate, status }
   * Action: update tour plan scheduling to avoid assigning inspections during leave. Req 4.4
   */
  employeeLeaveUpdated: "hrms.leave.updated",
} as const;
