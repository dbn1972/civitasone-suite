/**
 * ST-M01-06 — `smarttransfer.*` contract pack C0 (enforce; D-ST-19).
 *
 * Producer of every topic here is `smarttransfer-service`, except
 * `smarttransfer.solve.completed` whose producer is `allocation-solver`
 * (the solver returns the plan). Topic names, kinds, consumers and payload
 * outlines follow `docs/smarttransfer/event-list.md` (PR #1974, ST-M01-05)
 * and MUST be kept in lockstep with it; that doc is not merged yet.
 *
 * Kind convention (docs/ARCHITECTURE.md §4): commands are
 * `{service}.{aggregate}.{action}`, events are `{service}.{aggregate}.{past}`.
 * A topic is one or the other, never both (DSL rule 2).
 *
 * v1-minimal fields whose downstream *consumer* depends on a PROPOSED decision
 * are still part of the frozen contract (tolerant reader; the contract does not
 * change when a consumer is added later). The open decisions are:
 *   - `order.issued.signingState` relates to signing — OPEN D-ST-12.
 *   - the solver topics' runtime — OPEN D-ST-05/06 (contract is engine-neutral).
 * No field value is invented here; each is a plain state/ref string.
 */
import { z, zTenantId, zId, zWhen, zCode, defineStContract } from "./common.js";

const ST = "smarttransfer-service";
const SOLVER = "allocation-solver";

// ── Cycle ────────────────────────────────────────────────────────────────────

export const smarttransferCycleCreated = defineStContract({
  topic: "smarttransfer.cycle.created",
  kind: "event",
  owner: ST,
  version: "1.0",
  consumers: ["audit-service", "notification-service"],
  schema: z.object({
    cycleId: zId,
    tenantId: zTenantId,
    name: z.string().min(1),
    movementTypeId: zId,
    calendar: z.object({
      opensAt: zWhen,
      freezesAt: zWhen,
      closesAt: zWhen,
    }),
  }),
});

export const smarttransferCycleFrozen = defineStContract({
  topic: "smarttransfer.cycle.frozen",
  kind: "event",
  owner: ST,
  version: "1.0",
  consumers: ["audit-service"],
  schema: z.object({
    cycleId: zId,
    tenantId: zTenantId,
    snapshotId: zId,
    snapshotHash: z.string().min(1),
    policyPackId: zId,
    policyPackHash: z.string().min(1),
    counts: z.object({
      employees: z.number().int().nonnegative(),
      posts: z.number().int().nonnegative(),
    }),
  }),
});

export const smarttransferCycleClosed = defineStContract({
  topic: "smarttransfer.cycle.closed",
  kind: "event",
  owner: ST,
  version: "1.0",
  consumers: ["audit-service", "notification-service"],
  schema: z.object({
    cycleId: zId,
    tenantId: zTenantId,
    closedAt: zWhen,
    reconciliationRef: zId,
  }),
});

// ── Request / preference / scenario ───────────────────────────────────────────

export const smarttransferRequestSubmitted = defineStContract({
  topic: "smarttransfer.request.submitted",
  kind: "event",
  owner: ST,
  version: "1.0",
  consumers: ["audit-service", "notification-service"],
  schema: z.object({
    requestId: zId,
    cycleId: zId,
    tenantId: zTenantId,
    employeeId: zId,
    movementTypeId: zId,
  }),
});

export const smarttransferRequestWithdrawn = defineStContract({
  topic: "smarttransfer.request.withdrawn",
  kind: "event",
  owner: ST,
  version: "1.0",
  consumers: ["audit-service", "notification-service"],
  schema: z.object({
    requestId: zId,
    cycleId: zId,
    tenantId: zTenantId,
    employeeId: zId,
    reasonCode: zCode,
  }),
});

export const smarttransferPreferenceSubmitted = defineStContract({
  topic: "smarttransfer.preference.submitted",
  kind: "event",
  owner: ST,
  version: "1.0",
  consumers: ["audit-service"],
  schema: z.object({
    preferenceId: zId,
    cycleId: zId,
    tenantId: zTenantId,
    employeeId: zId,
    itemCount: z.number().int().nonnegative(),
  }),
});

export const smarttransferScenarioCreated = defineStContract({
  topic: "smarttransfer.scenario.created",
  kind: "event",
  owner: ST,
  version: "1.0",
  consumers: ["audit-service"],
  schema: z.object({
    scenarioId: zId,
    cycleId: zId,
    tenantId: zTenantId,
    name: z.string().min(1),
    weightsRef: zId,
  }),
});

// ── Run (coordinator) ─────────────────────────────────────────────────────────

export const smarttransferRunRequested = defineStContract({
  topic: "smarttransfer.run.requested",
  kind: "command",
  owner: ST,
  version: "1.0",
  consumers: [ST],
  schema: z.object({
    runId: zId,
    scenarioId: zId,
    cycleId: zId,
    tenantId: zTenantId,
    snapshotId: zId,
    policyPackHash: z.string().min(1),
    seed: z.number().int(),
  }),
});

export const smarttransferRunCompleted = defineStContract({
  topic: "smarttransfer.run.completed",
  kind: "event",
  owner: ST,
  version: "1.0",
  consumers: ["audit-service", "notification-service"],
  schema: z.object({
    runId: zId,
    cycleId: zId,
    tenantId: zTenantId,
    outputHash: z.string().min(1),
    score: z.number(),
    assigned: z.number().int().nonnegative(),
    unassigned: z.number().int().nonnegative(),
  }),
});

export const smarttransferRunFailed = defineStContract({
  topic: "smarttransfer.run.failed",
  kind: "event",
  owner: ST,
  version: "1.0",
  consumers: ["audit-service", "notification-service"],
  schema: z.object({
    runId: zId,
    cycleId: zId,
    tenantId: zTenantId,
    reasonCode: zCode,
  }),
});

export const smarttransferAssignmentProposed = defineStContract({
  topic: "smarttransfer.assignment.proposed",
  kind: "event",
  owner: ST,
  version: "1.0",
  consumers: ["audit-service"],
  schema: z.object({
    assignmentId: zId,
    runId: zId,
    tenantId: zTenantId,
    employeeId: zId,
    postId: zId,
    justificationRef: zId,
  }),
});

// ── Solver boundary (engine-neutral; runtime OPEN D-ST-05/06) ─────────────────

export const smarttransferSolveRequested = defineStContract({
  topic: "smarttransfer.solve.requested",
  kind: "command",
  owner: ST,
  version: "1.0",
  consumers: [SOLVER],
  schema: z.object({
    runId: zId,
    tenantId: zTenantId,
    snapshotRef: zId,
    arcsRef: zId,
    weightsRef: zId,
    seed: z.number().int(),
  }),
});

export const smarttransferSolveCompleted = defineStContract({
  topic: "smarttransfer.solve.completed",
  kind: "event",
  owner: SOLVER,
  version: "1.0",
  consumers: [ST],
  schema: z.object({
    runId: zId,
    tenantId: zTenantId,
    planRef: zId,
    planHash: z.string().min(1),
    score: z.number(),
    hardViolations: z.number().int().nonnegative(),
  }),
});

// ── Order ──────────────────────────────────────────────────────────────────────

export const smarttransferOrderDrafted = defineStContract({
  topic: "smarttransfer.order.drafted",
  kind: "event",
  owner: ST,
  version: "1.0",
  consumers: ["audit-service"],
  schema: z.object({
    orderId: zId,
    assignmentId: zId,
    tenantId: zTenantId,
    orderNumber: z.string().min(1),
  }),
});

export const smarttransferOrderIssued = defineStContract({
  topic: "smarttransfer.order.issued",
  kind: "event",
  owner: ST,
  version: "1.0",
  consumers: ["audit-service", "notification-service", "hrms-service"],
  schema: z.object({
    orderId: zId,
    assignmentId: zId,
    tenantId: zTenantId,
    employeeId: zId,
    postId: zId,
    orderNumber: z.string().min(1),
    effectiveDate: zWhen,
    // v1-minimal: the signing posture is OPEN D-ST-12. Until credentials exist
    // orders are stamped "system generated, not digitally signed"; this field
    // carries that state as a plain string, no signing value is invented.
    signingState: zCode,
  }),
});

export const smarttransferOrderCancelled = defineStContract({
  topic: "smarttransfer.order.cancelled",
  kind: "event",
  owner: ST,
  version: "1.0",
  consumers: ["audit-service", "notification-service"],
  schema: z.object({
    orderId: zId,
    tenantId: zTenantId,
    reasonCode: zCode,
    cancelledBy: zId,
  }),
});

// ── Relieving / joining ────────────────────────────────────────────────────────

export const smarttransferRelievingRecorded = defineStContract({
  topic: "smarttransfer.relieving.recorded",
  kind: "event",
  owner: ST,
  version: "1.0",
  consumers: ["audit-service", "notification-service"],
  schema: z.object({
    orderId: zId,
    tenantId: zTenantId,
    employeeId: zId,
    sourceOfficeId: zId,
    relievedOn: zWhen,
  }),
});

export const smarttransferJoiningRecorded = defineStContract({
  topic: "smarttransfer.joining.recorded",
  kind: "event",
  owner: ST,
  version: "1.0",
  consumers: ["audit-service", "notification-service"],
  schema: z.object({
    orderId: zId,
    tenantId: zTenantId,
    employeeId: zId,
    destOfficeId: zId,
    joinedOn: zWhen,
  }),
});

// ── Appeal ───────────────────────────────────────────────────────────────────

export const smarttransferAppealSubmitted = defineStContract({
  topic: "smarttransfer.appeal.submitted",
  kind: "event",
  owner: ST,
  version: "1.0",
  consumers: ["audit-service", "notification-service"],
  schema: z.object({
    appealId: zId,
    orderId: zId,
    tenantId: zTenantId,
    employeeId: zId,
    groundCode: zCode,
  }),
});

export const smarttransferAppealDecided = defineStContract({
  topic: "smarttransfer.appeal.decided",
  kind: "event",
  owner: ST,
  version: "1.0",
  consumers: ["audit-service", "notification-service"],
  schema: z.object({
    appealId: zId,
    orderId: zId,
    tenantId: zTenantId,
    outcome: zCode,
    decidedBy: zId,
    reasonCode: zCode,
  }),
});

// ── Evidence ─────────────────────────────────────────────────────────────────

export const smarttransferEvidenceRecorded = defineStContract({
  topic: "smarttransfer.evidence.recorded",
  kind: "event",
  owner: ST,
  version: "1.0",
  consumers: ["audit-service"],
  schema: z.object({
    evidenceId: zId,
    runId: zId,
    tenantId: zTenantId,
    snapshotHash: z.string().min(1),
    policyPackHash: z.string().min(1),
    solverVersion: z.string().min(1),
    seed: z.number().int(),
  }),
});

/** Every `smarttransfer.*` contract in this pack, in event-list order. */
export const smarttransferContracts = [
  smarttransferCycleCreated,
  smarttransferCycleFrozen,
  smarttransferCycleClosed,
  smarttransferRequestSubmitted,
  smarttransferRequestWithdrawn,
  smarttransferPreferenceSubmitted,
  smarttransferScenarioCreated,
  smarttransferRunRequested,
  smarttransferRunCompleted,
  smarttransferRunFailed,
  smarttransferAssignmentProposed,
  smarttransferSolveRequested,
  smarttransferSolveCompleted,
  smarttransferOrderDrafted,
  smarttransferOrderIssued,
  smarttransferOrderCancelled,
  smarttransferRelievingRecorded,
  smarttransferJoiningRecorded,
  smarttransferAppealSubmitted,
  smarttransferAppealDecided,
  smarttransferEvidenceRecorded,
] as const;
