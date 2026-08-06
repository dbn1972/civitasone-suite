export const COMMANDS = {
  contractCreate:         "contract.contract.create",
  contractApprove:        "contract.contract.approve",
  contractActivate:       "contract.contract.activate",
  contractClose:          "contract.contract.close",
  contractTerminate:      "contract.contract.terminate",
  contractAmend:          "contract.contract.amend",
  contractSubmitApproval: "contract.contract.submit_approval",
  milestoneComplete:      "contract.milestone.complete",
  milestoneMarkLate:      "contract.milestone.mark_late",

  // ── G15 — MoU milestone governance / penalty & SLA terms ─────────────────
  /**
   * Register an MoU milestone against an existing contract.
   * payload: {
   *   id: string (uuid, milestone id),
   *   tenantId: string (uuid),
   *   contractId: string (uuid),
   *   milestoneCode: string,      // business key, unique per contract+tenant
   *   name: string,
   *   description: string,
   *   dueDate: string,            // YYYY-MM-DD
   *   ordinal: number (int >= 1),
   *   amountMinor: string | null, // MONEY: decimal string of minor units, or null
   *   currency: string            // ISO 4217
   * }
   * Fires when an operator registers a milestone via
   * POST /v1/contract/mou/milestones.
   */
  mouMilestoneRegister:   "contract.mou.milestone.register",
  /**
   * Transition an MoU milestone's status.
   * payload: {
   *   id: string (uuid), tenantId: string (uuid), contractId: string (uuid),
   *   version: number (int, optimistic lock),
   *   toStatus: "met" | "missed" | "waived",
   *   completedAt?: string (ISO-8601 instant, only for toStatus="met"),
   *   waiverReason?: string       // REQUIRED when toStatus="waived"
   * }
   * The waiving actor is msg.actorId — a waiver always records who and why.
   */
  mouMilestoneTransition: "contract.mou.milestone.transition",
  /**
   * Create a penalty / SLA term for a contract.
   * payload: {
   *   id, tenantId, contractId: string (uuid),
   *   termCode: string, description: string,
   *   triggerType: "milestone_missed" | "sla_breached",
   *   thresholdValue: number (int >= 0),
   *   penaltyKind: "fixed" | "percentage" | "per_day",
   *   penaltyAmountMinor: string | null, // MONEY: decimal string of minor units
   *   penaltyRateBps: number | null,     // integer basis points, 1 bp = 0.01%
   *   maxPenaltyBps: number (int 0..10000),
   *   currency: string
   * }
   */
  mouPenaltyTermCreate:   "contract.mou.penalty_term.create",
  /**
   * Apply a penalty term to a concrete occurrence.
   * payload: {
   *   tenantId, contractId, penaltyTermId: string (uuid),
   *   milestoneId?: string (uuid),
   *   occurrenceRef: string,      // milestone id, or an SLA period code
   *   overdueDays: number (int >= 0),
   *   milestoneAmountMinor: string // MONEY: decimal string of minor units
   * }
   * Idempotent twice over: consumer inbox on messageId, plus the UNIQUE
   * (tenant_id, penalty_term_id, occurrence_key) constraint in
   * mou.penalty_applications. A penalty can never be applied twice.
   */
  mouPenaltyApply:        "contract.mou.penalty.apply",
  /**
   * Create or re-schedule a periodic MoU review.
   * payload: {
   *   id, tenantId, contractId: string (uuid),
   *   reviewCode: string,
   *   cadence: "monthly" | "quarterly" | "half_yearly" | "annual",
   *   nextReviewDate: string (YYYY-MM-DD),
   *   reviewerRole: string,
   *   notes?: string
   * }
   */
  mouReviewSchedule:      "contract.mou.review.schedule",
  /**
   * Record that a scheduled review happened; advances nextReviewDate by one
   * cadence period and returns the schedule to "scheduled".
   * payload: { id, tenantId: string (uuid), version: number (int), notes?: string }
   */
  mouReviewComplete:      "contract.mou.review.complete",
  bondRegister:           "contract.bond.register",
  bondTransition:         "contract.bond.transition",
  rcCreate:               "contract.rate_contract.create",
  clauseCreate:           "contract.clause.create",
  clauseUpdate:           "contract.clause.update",
  clauseArchive:          "contract.clause.archive",
  templateCreate:         "contract.template.create",
  templateUpdate:         "contract.template.update",
  templateDelete:         "contract.template.delete",
  templateClauseAdd:      "contract.template.clause_add",
  templateClauseUpdate:   "contract.template.clause_update",
  templateClauseRemove:   "contract.template.clause_remove",
  obligationCreate:       "contract.obligation.create",
  obligationUpdate:       "contract.obligation.update",
  renewalCreate:          "contract.renewal.create",
  renewalUpdate:          "contract.renewal.update",
  approvalLevelCreate:    "contract.approval_level.create",
  approvalLevelUpdate:    "contract.approval_level.update",
  approvalLevelDelete:    "contract.approval_level.delete",
  esignCreate:            "contract.esign.create",
  esignSign:              "contract.esign.sign",
  esignCheckDeadline:     "contract.esign.check_deadline",
  versionCreate:          "contract.version.create",
} as const;

export const EVENTS = {
  contractCreated:    "contract.contract.created",
  contractApproved:   "contract.contract.approved",
  contractActivated:  "contract.contract.activated",
  contractClosed:     "contract.contract.closed",
  contractTerminated: "contract.contract.terminated",
  contractAmended:    "contract.contract.amended",
  milestoneCompleted: "contract.milestone.completed",

  // ── G15 — MoU milestone governance events ────────────────────────────────
  /**
   * An MoU milestone was registered.
   * payload: {
   *   id, tenantId, contractId: string (uuid), milestoneCode: string,
   *   name: string, dueDate: string (YYYY-MM-DD), ordinal: number,
   *   amountMinor: string | null,  // MONEY: decimal string of minor units
   *   currency: string
   * }
   * Guarantee: at-least-once. Keyed by `id`; consumers must dedupe on it.
   */
  mouMilestoneRegistered: "contract.mou.milestone.registered",
  /**
   * An MoU milestone is approaching or has reached its due date.
   * Consumed by notification-service (reminder to the owning officer) and
   * workflow-service (opens a delivery-confirmation task).
   * payload: {
   *   id, tenantId, contractId: string (uuid), milestoneCode: string,
   *   dueDate: string (YYYY-MM-DD), daysUntilDue: number (int, may be 0),
   *   amountMinor: string | null, currency: string
   * }
   */
  mouMilestoneDue:        "contract.mou.milestone.due",
  /**
   * An MoU milestone was missed (due date passed beyond any grace threshold).
   * Consumed by notification-service (vendor + officer notice) and
   * workflow-service (opens a breach-review task). finance-service listens for
   * the downstream penalty event, not this one.
   * payload: {
   *   id, tenantId, contractId: string (uuid), milestoneCode: string,
   *   dueDate: string (YYYY-MM-DD), overdueDays: number (int > 0),
   *   amountMinor: string | null, currency: string
   * }
   */
  mouMilestoneMissed:     "contract.mou.milestone.missed",
  /**
   * An MoU milestone was delivered.
   * payload: {
   *   id, tenantId, contractId: string (uuid), milestoneCode: string,
   *   completedAt: string (ISO-8601 instant),
   *   amountMinor: string | null, currency: string
   * }
   */
  mouMilestoneMet:        "contract.mou.milestone.met",
  /**
   * A missed MoU milestone was excused. Always carries the waiving actor and
   * the reason — this is the audit record for the exception.
   * payload: {
   *   id, tenantId, contractId: string (uuid), milestoneCode: string,
   *   waivedBy: string (uuid), waivedAt: string (ISO-8601 instant),
   *   waiverReason: string
   * }
   */
  mouMilestoneWaived:     "contract.mou.milestone.waived",
  /**
   * A penalty / SLA term was created.
   * payload: {
   *   id, tenantId, contractId: string (uuid), termCode: string,
   *   triggerType: "milestone_missed" | "sla_breached",
   *   penaltyKind: "fixed" | "percentage" | "per_day",
   *   penaltyAmountMinor: string | null, // MONEY: decimal string, minor units
   *   penaltyRateBps: number | null, maxPenaltyBps: number, currency: string
   * }
   */
  mouPenaltyTermCreated:  "contract.mou.penalty_term.created",
  /**
   * A penalty was applied and ledgered. Consumed by finance-service to raise
   * a recovery/deduction and by notification-service for the vendor notice.
   * Emitted EXACTLY once per (tenantId, penaltyTermId, occurrenceKey) — the
   * uniqueness is enforced by a database constraint, not by the publisher.
   * payload: {
   *   id, tenantId, contractId, penaltyTermId: string (uuid),
   *   milestoneId: string (uuid) | null, occurrenceKey: string,
   *   computedAmountMinor: string, // MONEY: decimal string of minor units
   *   currency: string, capped: boolean, chargeableDays: number
   * }
   */
  mouPenaltyApplied:      "contract.mou.penalty.applied",
  /**
   * A periodic MoU review was scheduled or re-scheduled.
   * payload: {
   *   id, tenantId, contractId: string (uuid), reviewCode: string,
   *   cadence: string, nextReviewDate: string (YYYY-MM-DD), reviewerRole: string
   * }
   */
  mouReviewScheduled:     "contract.mou.review.scheduled",
  /**
   * A scheduled MoU review fell due. Consumed by notification-service.
   * payload: {
   *   id, tenantId, contractId: string (uuid), reviewCode: string,
   *   nextReviewDate: string (YYYY-MM-DD), reviewerRole: string
   * }
   */
  mouReviewDue:           "contract.mou.review.due",
  /**
   * A review cycle was completed; the next date has already been advanced.
   * payload: {
   *   id, tenantId, contractId: string (uuid), reviewCode: string,
   *   reviewedAt: string (ISO-8601 instant), nextReviewDate: string (YYYY-MM-DD)
   * }
   */
  mouReviewCompleted:     "contract.mou.review.completed",

  bondRegistered:     "contract.bond.registered",
  bondTransitioned:   "contract.bond.transitioned",
  clauseCreated:      "contract.clause.created",
  clauseUpdated:      "contract.clause.updated",
  clauseArchived:     "contract.clause.archived",
  templateCreated:    "contract.template.created",
  templateUpdated:    "contract.template.updated",
  templateArchived:   "contract.template.archived",
  obligationCreated:  "contract.obligation.created",
  obligationUpdated:  "contract.obligation.updated",
  renewalCreated:     "contract.renewal.created",
  renewalUpdated:     "contract.renewal.updated",
  approvalLevelCreated: "contract.approval_level.created",
  approvalLevelUpdated: "contract.approval_level.updated",
  approvalLevelDeleted: "contract.approval_level.deleted",
  esignCreated:         "contract.esign.created",
  esignSigned:          "contract.esign.signed",
  esignCompleted:       "contract.esign.completed",
  esignEscalated:       "contract.esign.escalated",
  versionCreated:       "contract.version.created",
  contractExpiryAlert: "contract.expiry.alert",
} as const;

/** Topics consumed from other services (cross-service stitching). */
export const CONSUMED_EVENTS = {
  // eOffice (estab-service) award decision callback — source_ref_type "contract_award".
  awardFileDecided: "contract.award.file_decided",
} as const;

export const SERVICE = "contract";
