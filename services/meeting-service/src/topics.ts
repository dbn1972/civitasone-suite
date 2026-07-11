/**
 * Topic + event names owned by meeting-service. Naming: {service}.{entity}.{action}
 *
 * This file is the single source of truth for the meeting-service message contract.
 * - COMMANDS         — write intents published by routes (route → zod → queue.publish → 202)
 * - EVENTS           — domain facts published via the transactional outbox after a DB write
 * - CONSUMED_EVENTS  — events owned by OTHER services that meeting-service subscribes to
 *
 * Each entry carries a JSDoc payload contract describing the message body. All payloads are
 * wrapped in the standard CivitasOne CommandEnvelope (`{ messageId, tenantId, actorId,
 * correlationId, occurredAt, payload }`); the JSDoc below documents the `payload` shape only.
 *
 * Cross-service contract note (per steering docs): when a CONSUMED_EVENT contract changes, the
 * publisher's topics.ts and this file must be updated together. Consumers MUST tolerate unknown
 * additional fields (forward-compatible) and treat new optional fields as additive.
 *
 * _Requirements: 25.3, 22.6, 22.7_
 */

/**
 * Commands — write intents. Published by HTTP routes after zod validation; handled by consumers
 * which call markProcessed(tx, messageId) first, then write, then enqueue EVENTS.
 */
export const COMMANDS = {
  // ── Meeting Core ─────────────────────────────────────────────────────────
  /** payload: { title, type, scheduledAt, durationMinutes, committeeId?, chairpersonId, secretaryId, convenerId?, venue?, vcEnabled?, confidentialityLevel? } */
  meetingCreate:              "meeting.meeting.create",
  /** payload: { meetingId, version, patch: Partial<MeetingEditableFields> } — optimistic lock via version */
  meetingUpdate:              "meeting.meeting.update",
  /** payload: { meetingId, version, to: MeetingState, reason?, nextMeetingDate? } */
  meetingTransition:          "meeting.meeting.transition",
  /** payload: { meetingId, version, reason } */
  meetingCancel:              "meeting.meeting.cancel",
  /** payload: { committeeId, pattern, startDate, endDate?, dayOfWeek?, dayOfMonth?, timeOfDay?, durationMinutes? } */
  meetingSeriesCreate:        "meeting.series.create",
  /** payload: { seriesId, version, patch: Partial<SeriesEditableFields> } — optimistic lock via version */
  meetingSeriesUpdate:        "meeting.series.update",
  /** payload: { seriesId, upToDate } — materialize concrete meeting instances from a series */
  meetingSeriesGenerate:      "meeting.series.generate",
  /** payload: { code, name, description?, templateConfig?, isStatutory?, frequency? } — create a meeting-type template */
  meetingTypeCreate:          "meeting.meeting_type.create",
  /** payload: { meetingTypeId, version, patch: Partial<MeetingTypeEditableFields> } */
  meetingTypeUpdate:          "meeting.meeting_type.update",

  // ── Committee ────────────────────────────────────────────────────────────
  /** payload: { name, type, termsOfReference?, constitutionDate, tenureEnd?, parentBodyId?, constitutingAuthority?, quorumRule, votingRule?, meetingFrequency?, statutoryBasis? } */
  committeeCreate:            "meeting.committee.create",
  /** payload: { committeeId, version, patch: Partial<CommitteeEditableFields> } */
  committeeUpdate:            "meeting.committee.update",
  /** payload: { committeeId, memberId, role, appointmentDate, tenureEnd?, appointingAuthority?, votingRight? } */
  committeeMemberAdd:         "meeting.committee.member_add",
  /** payload: { committeeId, membershipId, version, patch: { role?, tenureEnd?, votingRight?, status? } } */
  committeeMemberUpdate:      "meeting.committee.member_update",
  /** payload: { committeeId, membershipId, version, reason? } */
  committeeMemberRemove:      "meeting.committee.member_remove",

  // ── Agenda ───────────────────────────────────────────────────────────────
  /** payload: { meetingId, title, description?, outcomeType, durationMinutes?, presenterId?, category?, supportingDocumentIds?, linkedDecisionIds? } */
  agendaItemSubmit:           "meeting.agenda.submit",
  /** payload: { meetingId, agendaItemId, version, patch: Partial<AgendaItemEditableFields> } */
  agendaItemUpdate:           "meeting.agenda.update",
  /** payload: { meetingId, agendaItemId, version, reason? } */
  agendaItemWithdraw:         "meeting.agenda.withdraw",
  /** payload: { meetingId, order: Array<{ agendaItemId, sequence }> } — sequence must be a 1..n bijection */
  agendaReorder:              "meeting.agenda.reorder",
  /** payload: { meetingId, version, locked: boolean } — lock/unlock the agenda (unlock is chairperson-only) */
  agendaLock:                 "meeting.agenda.lock",
  /** payload: { meetingId, templateId?, includeAtr? } */
  agendaBookGenerate:         "meeting.agenda_book.generate",
  /** payload: { meetingId, agendaBookId, recipientIds? } */
  agendaBookCirculate:        "meeting.agenda_book.circulate",

  // ── Participant ──────────────────────────────────────────────────────────
  /** payload: { meetingId, participants: Array<{ employeeId, role, isMandatory?, agendaItemIds? }> } */
  participantAdd:             "meeting.participant.add",
  /** payload: { meetingId, participantId, version, patch: Partial<ParticipantEditableFields> } — optimistic lock via version */
  participantUpdate:          "meeting.participant.update",
  /** payload: { meetingId, participantId, version, reason? } — remove a participant association */
  participantRemove:          "meeting.participant.remove",
  /** payload: { meetingId, participantId, response: "accept" | "tentative" | "decline", declineReason? } */
  participantRespond:         "meeting.participant.respond",
  /** payload: { meetingId, participantId, nomineeId } — nominee validated against approved nominee list */
  participantNominate:        "meeting.participant.nominate",
  /** payload: { meetingId, participantIds?, channels? } — send invitations (email/SMS/push + ICS) */
  invitationsSend:            "meeting.invitations.send",

  // ── Attendance ───────────────────────────────────────────────────────────
  /** payload: { meetingId, participantId, method: "qr" | "biometric" | "geo" | "vc", checkInAt, geoLatitude?, geoLongitude?, deviceId? } */
  attendanceCheckIn:          "meeting.attendance.check_in",
  /** payload: { meetingId, participantId, checkOutAt } */
  attendanceCheckOut:         "meeting.attendance.check_out",
  /** payload: { meetingId, participantId, status, mode?, checkInAt? } — secretary manual marking */
  attendanceManualMark:       "meeting.attendance.manual_mark",

  // ── Minutes ──────────────────────────────────────────────────────────────
  /** payload: { meetingId, templateType?: "verbatim" | "summary" | "resolution_only" } */
  minutesCreate:              "meeting.minutes.create",
  /** payload: { minutesId, version, content, changeNote? } */
  minutesUpdate:              "meeting.minutes.update",
  /** payload: { minutesId, version } — submit draft into the Workflow_Service approval chain */
  minutesSubmit:              "meeting.minutes.submit",
  /** payload: { minutesId, version, approverId } */
  minutesApprove:             "meeting.minutes.approve",
  /** payload: { minutesId, version, rejectionComments } — returns draft to secretary, bumps version */
  minutesReject:              "meeting.minutes.reject",
  /** payload: { minutesId, signerId } — apply PKCS#7 DSC via @civitasone/render */
  minutesSign:                "meeting.minutes.sign",
  /** payload: { minutesId, recipientIds? } */
  minutesCirculate:           "meeting.minutes.circulate",

  // ── Decision & Resolution ────────────────────────────────────────────────
  /** payload: { meetingId, agendaItemId?, text, type, authority?, effectiveDate?, responsibleOfficer?, deadline?, financialImplication?: bigint, currency?, linkedDecisionIds? } */
  decisionRecord:             "meeting.decision.record",
  /** payload: { decisionId, version, patch: Partial<DecisionEditableFields> } */
  decisionUpdate:             "meeting.decision.update",
  /** payload: { meetingId, decisionId?, text, voteType, majorityRule, votesFor, votesAgainst, votesAbstain, effectiveDate? } */
  resolutionRecord:           "meeting.resolution.record",
  /** payload: { resolutionId, signerId } — chairperson DSC on passed resolution */
  resolutionSign:             "meeting.resolution.sign",
  /** payload: { committeeId, text, supportingDocumentIds?, deadline, requiredResponseRate? } — resolution by circulation */
  resolutionCirculationInit:  "meeting.resolution.circulation_init",
  /** payload: { resolutionId, memberId, note } — attach a recorded dissent note */
  dissentRecord:              "meeting.dissent.record",

  // ── Action Items ─────────────────────────────────────────────────────────
  /** payload: { meetingId, decisionId?, agendaItemId?, description, assigneeId, deadline, priority?, expectedEvidence? } */
  actionItemAssign:           "meeting.action_item.assign",
  /** payload: { actionItemId, version, patch: Partial<ActionItemEditableFields> } */
  actionItemUpdate:           "meeting.action_item.update",
  /** payload: { actionItemId, version } */
  actionItemAcknowledge:      "meeting.action_item.acknowledge",
  /** payload: { actionItemId, updateText, percentage } */
  actionItemProgress:         "meeting.action_item.progress",
  /** payload: { actionItemId, evidenceUrl?, evidenceNote } */
  actionItemEvidence:         "meeting.action_item.evidence",
  /** payload: { actionItemId, verifierId, verified: boolean, note? } */
  actionItemVerify:           "meeting.action_item.verify",
  /** payload: { actionItemId, toLevel: 1 | 2 | 3 } — escalation triggered by SLA breach */
  actionItemEscalate:         "meeting.action_item.escalate",

  // ── Voting ───────────────────────────────────────────────────────────────
  /** payload: { meetingId, agendaItemId?, voteType, majorityRule, text } — quorum re-verified before open */
  voteInitiate:               "meeting.vote.initiate",
  /** payload: { meetingId, resolutionId, memberId, position: "for" | "against" | "abstain" } */
  voteCast:                   "meeting.vote.cast",
  /** payload: { meetingId, resolutionId } — tally + compute result per majority rule */
  voteConclude:               "meeting.vote.conclude",
  /** payload: { resolutionId, memberId, position: "approve" | "reject" | "abstain", comment? } */
  voteCirculationRespond:     "meeting.vote.circulation_respond",

  // ── VC Integration ───────────────────────────────────────────────────────
  /** payload: { meetingId, platform?, recordingEnabled? } — creates VC room via VC_Adapter (with fallback) */
  vcSessionCreate:            "meeting.vc.create_session",
  /** payload: { meetingId, vcSessionId } */
  vcSessionEnd:               "meeting.vc.end_session",
  /** payload: { meetingId, vcSessionId } */
  vcRecordingStart:           "meeting.vc.recording_start",
  /** payload: { meetingId, vcSessionId } — stops recording; artifact stored in S3/MinIO */
  vcRecordingStop:            "meeting.vc.recording_stop",
  /** payload: { meetingId, vcSessionId?, participantId, joinedAt?, externalUserId?, displayName? } — provider webhook: a participant joined the VC session; recorded as VC-presence attendance (Req 13.3) */
  vcWebhook:                  "meeting.vc.webhook",

  // ── Calendar ─────────────────────────────────────────────────────────────
  /** payload: { roomId, name, capacity, location?, floor?, building?, equipment?, accessibility?, status? } — register a room in the booking registry */
  roomCreate:                 "meeting.room.create",
  /** payload: { roomId, version, patch: Partial<RoomEditableFields> } — optimistic lock via version */
  roomUpdate:                 "meeting.room.update",
  /** payload: { bookingId, meetingId, roomId, startAt, endAt } — bookingId minted by the route (also messageId) for end-to-end idempotency */
  roomBook:                   "meeting.room.book",
  /** payload: { bookingId, version, reason? } */
  roomBookCancel:             "meeting.room.book_cancel",

  // ── Document ─────────────────────────────────────────────────────────────
  /** payload: { meetingId, agendaItemId?, filename, mimeType, sizeBytes, storageKey, accessScope?, retentionClass? } */
  documentUpload:             "meeting.document.upload",
  /** payload: { meetingId, documentId, version, reason? } */
  documentRemove:             "meeting.document.remove",

  // ── AI Assist ────────────────────────────────────────────────────────────
  /** payload: { meetingId, recordingRef } — async transcription (confidence-gated) */
  aiTranscribe:               "meeting.ai.transcribe",
  /** payload: { meetingId, transcriptRef? } — draft minutes marked ai_generated; never auto-approved */
  aiDraftMinutes:             "meeting.ai.draft_minutes",
  /** payload: { meetingId, transcriptRef? } — extract candidate action items for human review */
  aiExtractActions:           "meeting.ai.extract_actions",

  // ── Config Registry (tenant config engine) ──
  /** payload: { id, namespace, configKey, value, label?, description?, sortOrder?, effectiveFrom?, effectiveTo?, expectedVersion? } */
  setConfig:                  "meeting.config.set",
  /** payload: { configId, expectedVersion } */
  deactivateConfig:           "meeting.config.deactivate",
} as const;

/**
 * Events — domain facts emitted via the transactional outbox after a successful DB write.
 * Consumed by Audit_Service, Analytics_Service, Notification_Service, and ERP services (Req 22.7).
 * All event payloads include at minimum: { meetingId?, tenantId, occurredAt } plus the fields below.
 */
export const EVENTS = {
  // ── Meeting lifecycle ──────────────────────────────────────────────────────
  /** payload: { meetingId, type, committeeId?, status: "draft" } */
  meetingCreated:             "meeting.meeting.created",
  /** payload: { meetingId, scheduledAt } — triggers invitation dispatch */
  meetingScheduled:           "meeting.meeting.scheduled",
  /** payload: { meetingId } */
  meetingAgendaLocked:        "meeting.meeting.agenda_locked",
  /** payload: { meetingId, actualStartAt, quorumEstablished: true } */
  meetingStarted:             "meeting.meeting.started",
  /** payload: { meetingId, adjournmentReason, nextMeetingDate?, carriedForwardItemIds } */
  meetingAdjourned:           "meeting.meeting.adjourned",
  /** payload: { meetingId, actualEndAt } — meeting ended, minutes_pending */
  meetingCompleted:           "meeting.meeting.completed",
  /** payload: { meetingId } */
  meetingClosed:              "meeting.meeting.closed",
  /** payload: { meetingId, reason } */
  meetingCancelled:           "meeting.meeting.cancelled",
  /** payload: { meetingId } */
  meetingArchived:            "meeting.meeting.archived",

  // ── Meeting series & types (config) ────────────────────────────────────────
  /** payload: { seriesId, committeeId, pattern, startDate } */
  meetingSeriesCreated:       "meeting.series.created",
  /** payload: { seriesId } */
  meetingSeriesUpdated:       "meeting.series.updated",
  /** payload: { seriesId, committeeId, generatedMeetingIds, upToDate } */
  meetingSeriesGenerated:     "meeting.series.generated",
  /** payload: { meetingTypeId, code, name } */
  meetingTypeCreated:         "meeting.meeting_type.created",
  /** payload: { meetingTypeId } */
  meetingTypeUpdated:         "meeting.meeting_type.updated",

  // ── Committee ────────────────────────────────────────────────────────────
  /** payload: { committeeId, name, type } */
  committeeCreated:           "meeting.committee.created",
  /** payload: { committeeId } */
  committeeUpdated:           "meeting.committee.updated",
  /** payload: { committeeId, memberId, role } */
  committeeMemberAdded:       "meeting.committee.member_added",
  /** payload: { committeeId, membershipId, memberId, expiredOn } */
  committeeMemberExpired:     "meeting.committee.member_expired",
  /** payload: { committeeId, membershipId, memberId, tenureEnd } — 30-day advance alert */
  committeeTenureExpiring:    "meeting.committee.tenure_expiring",
  /** payload: { committeeId, expectedBy, lastMeetingDate? } — statutory frequency missed */
  committeeOverdue:           "meeting.committee.meeting_overdue",

  // ── Agenda ───────────────────────────────────────────────────────────────
  /** payload: { meetingId, agendaItemId, outcomeType } */
  agendaItemSubmitted:        "meeting.agenda.item_submitted",
  /** payload: { meetingId } */
  agendaLocked:               "meeting.agenda.locked",
  /** payload: { meetingId, agendaBookId, storageKey } */
  agendaBookGenerated:        "meeting.agenda_book.generated",
  /** payload: { meetingId, agendaBookId, recipientIds } */
  agendaBookCirculated:       "meeting.agenda_book.circulated",

  // ── Participant & Attendance ───────────────────────────────────────────────
  /** payload: { meetingId, participantId, channels } */
  participantInvited:         "meeting.participant.invited",
  /** payload: { meetingId, participantId } */
  participantUpdated:         "meeting.participant.updated",
  /** payload: { meetingId, participantId } */
  participantRemoved:         "meeting.participant.removed",
  /** payload: { meetingId, participantId, response, declineReason? } */
  participantResponded:       "meeting.participant.responded",
  /** payload: { meetingId, establishedAt, presentMemberIds } */
  quorumEstablished:          "meeting.attendance.quorum_established",
  /** payload: { meetingId, lostAt, presentCount, requiredCount } */
  quorumLost:                 "meeting.attendance.quorum_lost",
  /** payload: { meetingId, participantId, method, status } */
  attendanceMarked:           "meeting.attendance.marked",

  // ── Minutes ──────────────────────────────────────────────────────────────
  /** payload: { minutesId, meetingId, version } — routed to Workflow_Service */
  minutesSubmitted:           "meeting.minutes.submitted",
  /** payload: { minutesId, meetingId, approvedBy, approvedAt } — consumed by Estab_Service (Req 23.2) */
  minutesApproved:            "meeting.minutes.approved",
  /** payload: { minutesId, meetingId, rejectionComments, newVersion } */
  minutesRejected:            "meeting.minutes.rejected",
  /** payload: { minutesId, meetingId, dscSignerName, hashCurrent } */
  minutesSigned:              "meeting.minutes.signed",
  /** payload: { minutesId, meetingId, recipientIds } */
  minutesCirculated:          "meeting.minutes.circulated",

  // ── Decision & Resolution ──────────────────────────────────────────────────
  /** payload: { decisionId, meetingId, type, financialImplication?, currency? } — generic audit/analytics fact */
  decisionRecorded:           "meeting.decision.recorded",
  /** payload: { decisionId, meetingId, text, authority?, effectiveDate? } — consumed by Procurement_Service (Req 22.1) */
  decisionProcurement:        "meeting.decision.procurement",
  /** payload: { decisionId, meetingId, text, financialImplication: bigint, currency, authority? } — consumed by Finance_Service (Req 22.2) */
  decisionFinancial:          "meeting.decision.financial",
  /** payload: { decisionId, meetingId, text, authority? } — consumed by HRMS_Service (Req 22.3) */
  decisionHr:                 "meeting.decision.hr",
  /** payload: { decisionId, meetingId, text, projectRef? } — consumed by Project_Service (Req 22.4) */
  decisionProject:            "meeting.decision.project",
  /** payload: { decisionId, meetingId, text, authority? } — consumed by Legal_Service (Req 22.5) */
  decisionLegal:              "meeting.decision.legal",
  /** payload: { resolutionId, meetingId, resolutionNumber, votesFor, votesAgainst, votesAbstain } */
  resolutionPassed:           "meeting.resolution.passed",
  /** payload: { resolutionId, meetingId, resolutionNumber, votesFor, votesAgainst, votesAbstain } */
  resolutionRejected:         "meeting.resolution.rejected",
  /** payload: { resolutionId, meetingId, dscSignerName, hashCurrent } */
  resolutionSigned:           "meeting.resolution.signed",
  /** payload: { resolutionId, committeeId, result, responseRate } */
  circulationResolutionCompleted: "meeting.resolution.circulation_completed",

  // ── Action Items ─────────────────────────────────────────────────────────
  /** payload: { actionItemId, meetingId, assigneeId, deadline, priority } */
  actionItemAssigned:         "meeting.action_item.assigned",
  /** payload: { actionItemId, meetingId, assigneeId, deadline, escalationLevel } */
  actionItemOverdue:          "meeting.action_item.overdue",
  /** payload: { actionItemId, meetingId, assigneeId, toLevel, notifyIds } */
  actionItemEscalated:        "meeting.action_item.escalated",
  /** payload: { actionItemId, meetingId, completedAt } */
  actionItemCompleted:        "meeting.action_item.completed",
  /** payload: { actionItemId, meetingId, evidenceUrl? } */
  actionItemEvidenceSubmitted: "meeting.action_item.evidence_submitted",

  // ── Voting ───────────────────────────────────────────────────────────────
  /** payload: { meetingId, resolutionId, voteType } */
  voteInitiated:              "meeting.vote.initiated",
  /** payload: { meetingId, resolutionId, result } */
  voteConcluded:              "meeting.vote.concluded",

  // ── Calendar / Rooms ───────────────────────────────────────────────────────
  /** payload: { roomId, name, capacity } */
  roomCreated:                "meeting.room.created",
  /** payload: { roomId } */
  roomUpdated:                "meeting.room.updated",
  /** payload: { bookingId, roomId, meetingId, startAt, endAt } — a room reservation was confirmed */
  roomBooked:                 "meeting.room.booked",
  /** payload: { bookingId, roomId, meetingId, reason? } — a room reservation was cancelled (participants notified) */
  roomBookingCancelled:       "meeting.room.booking_cancelled",

  // ── VC ───────────────────────────────────────────────────────────────────
  /** payload: { meetingId, vcSessionId, platform, joinUrl } */
  vcSessionCreated:           "meeting.vc.session_created",
  /** payload: { meetingId, vcSessionId, recordingStorageKey? } */
  vcSessionEnded:             "meeting.vc.session_ended",
  /** payload: { meetingId, vcSessionId, participantId, joinedAt } — feeds attendance capture */
  vcParticipantJoined:        "meeting.vc.participant_joined",

  // ── AI ───────────────────────────────────────────────────────────────────
  /** payload: { meetingId, transcriptRef, confidence } */
  aiTranscriptReady:          "meeting.ai.transcript_ready",
  /** payload: { meetingId, minutesId, version, confidence } — draft only; requires human approval */
  aiMinutesDraftReady:        "meeting.ai.minutes_draft_ready",

  // ── Compliance ───────────────────────────────────────────────────────────
  /** payload: { meetingId?, committeeId?, alertType, detail } */
  complianceAlert:            "meeting.compliance.alert",
  /** payload: { committeeId, expectedBy, statutoryBasis } */
  statutoryMeetingOverdue:    "meeting.compliance.statutory_overdue",

  // ── Config Registry ──
  /** payload: { id, namespace, configKey } */
  configSet:                  "meeting.config.set_done",
  /** payload: { id, namespace } */
  configDeactivated:          "meeting.config.deactivated",
} as const;

/**
 * Consumed events — owned by other services. meeting-service subscribes to these to stitch
 * cross-service behavior. Consumers MUST be idempotent and tolerate unknown extra fields.
 *
 * Cross-service contracts (payload shapes as guaranteed by the publishing service):
 */
export const CONSUMED_EVENTS = {
  /**
   * Owner: tenant-service. Fires when a new tenant is provisioned.
   * payload: { tenantId, name, orgType, residency? }
   * Action: auto-create default configs (meeting types, minutes template, escalation rules). Req 21.5
   */
  tenantCreated:              "tenant.tenant.created",
  /**
   * Owner: workflow-service. Fires when a workflow task (e.g., minutes approval) completes.
   * payload: { taskId, workflowInstanceId, tenantId, entityType, entityId, outcome, actorId, completedAt }
   * Action: advance minutes/resolution approval state. Req 25.3, 7.3
   */
  workflowTaskCompleted:      "workflow.task.completed",
  /**
   * Owner: workflow-service. Fires when a workflow task is assigned to a user.
   * payload: { taskId, workflowInstanceId, tenantId, assigneeId, entityType, entityId, dueAt? }
   * Action: surface pending approvals in the participant dashboard. Req 22.6
   */
  workflowTaskAssigned:       "workflow.task.assigned",
  /**
   * Owner: hrms-service. Fires when an employee record changes.
   * payload: { employeeId, tenantId, changedFields: string[], designation?, reportingOfficerId? }
   * Action: refresh committee membership / participant directory caches. Req 25.3
   */
  hrmsEmployeeUpdated:        "hrms.employee.updated",
  /**
   * Owner: hrms-service. Fires when an employee separates (retires/resigns/transfers out).
   * payload: { employeeId, tenantId, separationDate, reason? }
   * Action: expire committee memberships and reassign open action items. Req 2.4, 9.x
   */
  hrmsEmployeeSeparated:      "hrms.employee.separated",
} as const;

/** Service identifier — first segment of every owned topic name. */
export const SERVICE = "meeting";
