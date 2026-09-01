/**
 * Sprint-15 coverage sweep: Licence, CAPA, Enforcement, Survey, Telemetry consumers.
 * Covers the 5 modules that had 0% coverage, pushing inspection-service to ≥80%.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

const TENANT_ID  = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const USER_ID    = "11111111-2222-3333-4444-555555555555";
const CHECKER_ID = "22222222-3333-4444-5555-666666666666"; // different from maker
const ENTITY_ID  = "eeeeeeee-1111-2222-3333-444444444444";

// ── Handler registry ──────────────────────────────────────────────────────────
const handlers = new Map<string, (msg: unknown) => Promise<void>>();

// ── DB Mock ───────────────────────────────────────────────────────────────────
const mockTx = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  onConflictDoNothing: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([{ id: ENTITY_ID, version: 1 }]),
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  execute: vi.fn().mockResolvedValue([]),
  limit: vi.fn().mockReturnThis(),
};

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn(mockTx)),
    execute: vi.fn(),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
  },
  sqlClient: { end: vi.fn() },
  dbFor: vi.fn(),
  sqlClientFor: vi.fn(),
  tierOf: vi.fn(),
  dbForRead: vi.fn(),
  scopedRead: vi.fn(),
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(async () => true),
  enqueue: vi.fn(async () => undefined),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    getOrLoad: vi.fn().mockResolvedValue(null),
    invalidate: vi.fn().mockResolvedValue(undefined),
    makeKey: vi.fn((...args: string[]) => args.join(":")),
    invalidateResourceAfterCommit: vi.fn().mockResolvedValue(undefined),
  },
  queue: {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn((topic: string, handler: (msg: unknown) => Promise<void>) => {
      handlers.set(topic, handler);
    }),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
  },
}));

// ── Repo mocks ────────────────────────────────────────────────────────────────

vi.mock("../src/modules/licence/repo.js", () => ({
  findLicenceById: vi.fn().mockResolvedValue({
    id: "lic-1", status: "active", version: 1, tenantId: TENANT_ID,
    licenceType: "fire_noc", validFrom: "2025-01-01", validTo: "2026-01-01",
    entityId: ENTITY_ID,
  }),
  findLicences: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  findExpiringLicences: vi.fn().mockResolvedValue([]),
  insertLicence: vi.fn().mockResolvedValue({
    id: "lic-1", status: "active", version: 1, tenantId: TENANT_ID,
    licenceType: "fire_noc", licenceNumber: "LIC-2025-001",
  }),
  updateLicence: vi.fn().mockResolvedValue({ id: "lic-1", status: "active", version: 2 }),
}));

vi.mock("../src/modules/capa/repo.js", () => ({
  findCapaById: vi.fn().mockResolvedValue({
    id: "capa-1", status: "open", version: 1, tenantId: TENANT_ID,
    findingId: "find-1", assignedTo: USER_ID, createdBy: USER_ID,
  }),
  findCapas: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertCapa: vi.fn().mockResolvedValue({ id: "capa-1", status: "open", version: 1 }),
  updateCapa: vi.fn().mockResolvedValue({ id: "capa-1", status: "in_progress", version: 2 }),
}));

vi.mock("../src/modules/enforcement/repo.js", () => ({
  findPenaltyRates: vi.fn().mockResolvedValue([]),
  insertPenaltyRate: vi.fn().mockResolvedValue({ id: "rate-1" }),
  findShowCauseById: vi.fn().mockResolvedValue({
    id: "scn-1", status: "issued", version: 1, tenantId: TENANT_ID, findingId: "find-1",
  }),
  insertShowCauseNotice: vi.fn().mockResolvedValue({ id: "scn-1", status: "issued" }),
  updateShowCauseNotice: vi.fn().mockResolvedValue({ id: "scn-1", status: "replied" }),
  findPenaltyOrderById: vi.fn().mockResolvedValue({
    id: "po-1", status: "draft", version: 1, tenantId: TENANT_ID,
    showCauseId: "scn-1",
    // amount must have toString() — use a numeric-like object
    amount: { toString: () => "50000" },
  }),
  insertPenaltyOrder: vi.fn().mockResolvedValue({ id: "po-1", status: "draft" }),
  updatePenaltyOrder: vi.fn().mockResolvedValue({ id: "po-1", status: "issued" }),
  insertProsecutionReferral: vi.fn().mockResolvedValue({ id: "pros-1" }),
}));

vi.mock("../src/modules/survey/repo.js", () => ({
  findSurveyById: vi.fn().mockResolvedValue({
    id: "surv-1", status: "draft", version: 1, tenantId: TENANT_ID,
    questionnaire: [{ id: "q1", fieldType: "rating", label: "How satisfied?", required: true }],
    samplingMethod: "random",
    sampleSizePercent: "50",
  }),
  findSurveys: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  findLatestAggregation: vi.fn().mockResolvedValue(null),
  findResponsesBySurvey: vi.fn().mockResolvedValue([
    { answers: { q1: 4 } },
    { answers: { q1: 5 } },
  ]),
  insertSurveyDefinition: vi.fn().mockResolvedValue({ id: "surv-1", status: "draft" }),
  updateSurveyDefinition: vi.fn().mockResolvedValue({ id: "surv-1", status: "active" }),
  insertSamplingFrame: vi.fn().mockResolvedValue({ id: "frame-1" }),
  insertSurveyResponse: vi.fn().mockResolvedValue({ id: "resp-1" }),
  insertSurveyAggregation: vi.fn().mockResolvedValue({ id: "agg-1" }),
}));

vi.mock("../src/modules/telemetry/repo.js", () => ({
  findDeviceById: vi.fn().mockResolvedValue({
    id: "dev-1", status: "active", version: 1, tenantId: TENANT_ID,
    deviceType: "smoke_detector", serialNumber: "SN-001", entityId: ENTITY_ID,
  }),
  findDevices: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  findReadings: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  findAlerts: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  findAlertById: vi.fn().mockResolvedValue({
    id: "alert-1", status: "acknowledged", version: 1, tenantId: TENANT_ID,
    deviceId: "dev-1", ruleId: "rule-1",
  }),
  findActiveAlertRules: vi.fn().mockResolvedValue([]),
  findAlertRules: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertDevice: vi.fn().mockResolvedValue({ id: "dev-1", status: "active", version: 1 }),
  updateDevice: vi.fn().mockResolvedValue({ id: "dev-1", status: "inactive", version: 2 }),
  insertReading: vi.fn().mockResolvedValue({ id: "read-1" }),
  insertAlert: vi.fn().mockResolvedValue({ id: "alert-1", status: "open" }),
  updateAlert: vi.fn().mockResolvedValue({ id: "alert-1", status: "acknowledged" }),
  insertAlertRule: vi.fn().mockResolvedValue({ id: "rule-1" }),
}));

vi.mock("../src/modules/findings/repo.js", () => ({
  findFindingById: vi.fn().mockResolvedValue({ id: "find-1", state: "open", version: 1, tenantId: TENANT_ID }),
  findFindings: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertFinding: vi.fn().mockResolvedValue({ id: "find-1", findingNumber: "FND-2025-000001" }),
  updateFindingState: vi.fn().mockResolvedValue({ id: "find-1", state: "closed" }),
  softDeleteFinding: vi.fn().mockResolvedValue(undefined),
  findNoticesByFinding: vi.fn().mockResolvedValue([]),
  insertComplianceNotice: vi.fn().mockResolvedValue({ id: "notice-1" }),
  nextFindingSequence: vi.fn().mockResolvedValue(1),
  findOverdueFindings: vi.fn().mockResolvedValue([]),
}));

// ── Helper ────────────────────────────────────────────────────────────────────
function makeMsg(topic: string, payload: unknown, actorId = USER_ID) {
  return {
    messageId: `msg-${Date.now()}-${Math.random()}`,
    type: topic,
    tenantId: TENANT_ID,
    actorId,
    correlationId: "corr-sprint15",
    schemaVersion: 1,
    payload,
  };
}

// ── Register consumers ────────────────────────────────────────────────────────
beforeAll(async () => {
  const { queue } = await import("../src/shared/infra.js");
  const { registerLicenceConsumers }     = await import("../src/modules/licence/consumer.js");
  const { registerCapaConsumers }        = await import("../src/modules/capa/consumer.js");
  const { registerEnforcementConsumers } = await import("../src/modules/enforcement/consumer.js");
  const { registerSurveyConsumers }      = await import("../src/modules/survey/consumer.js");
  const { registerTelemetryConsumers }   = await import("../src/modules/telemetry/consumer.js");

  registerLicenceConsumers(queue as any);
  registerCapaConsumers(queue as any);
  registerEnforcementConsumers(queue as any);
  registerSurveyConsumers(queue as any);
  registerTelemetryConsumers(queue as any);
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// LICENCE CONSUMERS
// ══════════════════════════════════════════════════════════════════════════════

describe("Licence consumers — Sprint 15 coverage", () => {
  it("handles licenceCreate", async () => {
    const handler = handlers.get("inspection.licence.create");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.licence.create", {
      entityId: ENTITY_ID,
      licenceType: "fire_noc",
      licenceNumber: "LIC-2025-001",
      validFrom: "2025-01-01",
      validTo: "2026-01-01",
      conditions: "Annual inspection required",
      renewalFee: "5000",
      currency: "INR",
    }));
  });

  it("handles licenceUpdate", async () => {
    const handler = handlers.get("inspection.licence.update");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.licence.update", {
      licenceId: "lic-1",
      version: 1,
      patch: { conditions: "Updated conditions" },
    }));
  });

  it("handles licenceRenew", async () => {
    const handler = handlers.get("inspection.licence.renew");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.licence.renew", {
      licenceId: "lic-1",
      version: 1,
      newValidFrom: "2026-01-01",
      newValidTo: "2027-01-01",
      renewalFee: "5500",
    }));
  });

  it("handles licenceSuspend", async () => {
    const handler = handlers.get("inspection.licence.suspend");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.licence.suspend", {
      licenceId: "lic-1",
      version: 1,
      reason: "Non-compliance with fire safety norms",
    }));
  });

  it("handles licenceRevoke", async () => {
    const handler = handlers.get("inspection.licence.revoke");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.licence.revoke", {
      licenceId: "lic-1",
      version: 1,
      reason: "Repeated violations",
    }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CAPA CONSUMERS
// ══════════════════════════════════════════════════════════════════════════════

describe("CAPA consumers — Sprint 15 coverage", () => {
  it("handles capaCreate", async () => {
    const handler = handlers.get("inspection.capa.create");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.capa.create", {
      findingId: "find-1",
      description: "Install fire suppression system",
      assignedTo: USER_ID,
      dueDate: "2025-09-01",
      priority: "high",
    }));
  });

  it("handles capaUpdate", async () => {
    const handler = handlers.get("inspection.capa.update");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.capa.update", {
      capaId: "capa-1",
      version: 1,
      patch: { description: "Updated CAPA description" },
    }));
  });

  // Regression for a CRITICAL bug: CAPA_TRANSITIONS (domain.ts) has no
  // open -> completed edge by design (must go through in_progress first —
  // enforced by an existing domain test), but before capaStart existed,
  // nothing anywhere ever performed open -> in_progress. Every CAPA is
  // created with status "open" (capaCreate, above) and stayed there
  // permanently — /complete always threw INVALID_TRANSITION for every real
  // CAPA, silently, because the 202 was already sent before this consumer
  // ran. This test would have nothing to call before the fix (no
  // "inspection.capa.start" handler was ever registered).
  it("handles capaStart — open CAPA transitions to in_progress", async () => {
    const { findCapaById, updateCapa } = await import("../src/modules/capa/repo.js");
    (findCapaById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "capa-1", status: "open", version: 1, tenantId: TENANT_ID,
      findingId: "find-1", assignedTo: USER_ID, createdBy: USER_ID,
    });
    const handler = handlers.get("inspection.capa.start");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.capa.start", { capaId: "capa-1" }));
    expect(updateCapa).toHaveBeenCalledWith(
      expect.anything(),
      "capa-1",
      TENANT_ID,
      expect.objectContaining({ status: "in_progress" }),
      1,
    );
  });

  it("rejects capaStart when the CAPA is already completed (invalid transition, no write)", async () => {
    const { findCapaById, updateCapa } = await import("../src/modules/capa/repo.js");
    (findCapaById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "capa-2", status: "completed", version: 3, tenantId: TENANT_ID,
      findingId: "find-1", assignedTo: USER_ID, createdBy: USER_ID,
    });
    const handler = handlers.get("inspection.capa.start");
    await expect(handler!(makeMsg("inspection.capa.start", { capaId: "capa-2" })))
      .rejects.toThrow(/Cannot transition CAPA/);
    expect(updateCapa).not.toHaveBeenCalled();
  });

  it("handles capaComplete", async () => {
    const { findCapaById } = await import("../src/modules/capa/repo.js");
    (findCapaById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "capa-1", status: "in_progress", version: 1, tenantId: TENANT_ID,
      findingId: "find-1", assignedTo: USER_ID, createdBy: USER_ID,
    });
    const handler = handlers.get("inspection.capa.complete");
    expect(handler).toBeDefined();
    // evidenceOfClosure — the field name the consumer expects
    await handler!(makeMsg("inspection.capa.complete", {
      capaId: "capa-1",
      version: 1,
      evidenceOfClosure: ["ev-1", "ev-2"],
    }));
  });

  it("handles capaVerify — checker is a different user (maker-checker)", async () => {
    const { findCapaById } = await import("../src/modules/capa/repo.js");
    (findCapaById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "capa-1", status: "completed", version: 2, tenantId: TENANT_ID,
      findingId: "find-1", assignedTo: USER_ID,
      createdBy: USER_ID, // maker
    });
    const handler = handlers.get("inspection.capa.verify");
    expect(handler).toBeDefined();
    // actorId = CHECKER_ID ≠ createdBy = USER_ID → passes maker-checker
    await handler!(makeMsg("inspection.capa.verify", {
      capaId: "capa-1",
      version: 2,
      effectivenessVerified: true,
    }, CHECKER_ID));
  });

  it("handles capaTriggerReinspection", async () => {
    const handler = handlers.get("inspection.capa.trigger_reinspection");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.capa.trigger_reinspection", {
      capaId: "capa-1",
      entityId: ENTITY_ID,
      reason: "Verify CAPA effectiveness in field",
    }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ENFORCEMENT CONSUMERS
// ══════════════════════════════════════════════════════════════════════════════

describe("Enforcement consumers — Sprint 15 coverage", () => {
  it("handles penaltyRateCreate", async () => {
    const handler = handlers.get("inspection.penalty_rate.create");
    expect(handler).toBeDefined();
    // payload field is `amount`, not `baseAmount`
    await handler!(makeMsg("inspection.penalty_rate.create", {
      provisionId: "prov-1",
      amount: "50000",
      currency: "INR",
      effectiveFrom: "2025-01-01",
    }));
  });

  it("handles showCauseCreate", async () => {
    const handler = handlers.get("inspection.show_cause.create");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.show_cause.create", {
      findingId: "find-1",
      noticeText: "Show cause why penalty should not be imposed",
      responseDueDate: "2025-07-15",
      violationType: "fire_exit_blocked",
    }));
  });

  it("handles showCauseRespond", async () => {
    const handler = handlers.get("inspection.show_cause.respond");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.show_cause.respond", {
      showCauseId: "scn-1",
      version: 1,
      responseText: "Fire exits have been cleared and inspected",
      evidenceIds: ["ev-1"],
    }));
  });

  it("handles penaltyOrderCreate", async () => {
    const handler = handlers.get("inspection.penalty_order.create");
    expect(handler).toBeDefined();
    // payload field is `amount` not `penaltyAmount`; needs `findingId` and `entityId`
    await handler!(makeMsg("inspection.penalty_order.create", {
      findingId: "find-1",
      entityId: ENTITY_ID,
      showCauseId: "scn-1",
      amount: "50000",
      currency: "INR",
    }));
  });

  it("handles penaltyOrderIssue", async () => {
    // order.amount must have .toString() — BigInt works; our mock returns { toString: () => "50000" }
    const handler = handlers.get("inspection.penalty_order.issue");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.penalty_order.issue", {
      penaltyOrderId: "po-1",
      version: 1,
    }));
  });

  it("handles prosecutionRefer", async () => {
    const handler = handlers.get("inspection.prosecution.refer");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.prosecution.refer", {
      findingId: "find-1",
      penaltyOrderId: "po-1",
      courtName: "Delhi District Court",
      chargeSheet: "Violation of Factories Act 1948, Section 14",
      referralDate: "2025-08-15",
    }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SURVEY CONSUMERS
// ══════════════════════════════════════════════════════════════════════════════

describe("Survey consumers — Sprint 15 coverage", () => {
  it("handles surveyCreate", async () => {
    const handler = handlers.get("inspection.survey.create");
    expect(handler).toBeDefined();
    // `samplingMethod` + `sampleSizePercent` (number) are the real field names
    await handler!(makeMsg("inspection.survey.create", {
      name: "Post-Inspection Satisfaction Survey",
      description: "Collect feedback from inspected entities",
      targetAudience: "inspected_entities",
      samplingMethod: "random",
      sampleSizePercent: 50,
      questionnaire: [
        { id: "q1", fieldType: "rating", label: "Overall satisfaction", required: true },
        { id: "q2", fieldType: "text",   label: "Suggestions",          required: false },
      ],
    }));
  });

  it("handles surveyUpdate", async () => {
    const handler = handlers.get("inspection.survey.update");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.survey.update", {
      surveyId: "surv-1",
      version: 1,
      patch: { description: "Updated survey description" },
    }));
  });

  it("handles surveyActivate (random sampling)", async () => {
    const { findSurveyById } = await import("../src/modules/survey/repo.js");
    (findSurveyById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "surv-1", status: "draft", version: 1, tenantId: TENANT_ID,
      questionnaire: [{ id: "q1", fieldType: "rating", label: "Satisfaction", required: true }],
      samplingMethod: "random",
      sampleSizePercent: "50",
    });
    const handler = handlers.get("inspection.survey.activate");
    expect(handler).toBeDefined();
    // `entityIds` is the real field (not `population`)
    await handler!(makeMsg("inspection.survey.activate", {
      surveyId: "surv-1",
      version: 1,
      entityIds: [ENTITY_ID, "entity-2", "entity-3", "entity-4", "entity-5"],
    }));
  });

  it("handles surveyActivate (stratified sampling)", async () => {
    const { findSurveyById } = await import("../src/modules/survey/repo.js");
    (findSurveyById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "surv-1", status: "draft", version: 1, tenantId: TENANT_ID,
      questionnaire: [{ id: "q1", fieldType: "rating", label: "Satisfaction", required: true }],
      samplingMethod: "stratified",
      sampleSizePercent: "50",
      stratificationField: "entityType",
    });
    const handler = handlers.get("inspection.survey.activate");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.survey.activate", {
      surveyId: "surv-1",
      version: 1,
      entityIds: [ENTITY_ID, "entity-2", "entity-3"],
      entities: [
        { id: ENTITY_ID, entityType: "factory" },
        { id: "entity-2", entityType: "shop" },
        { id: "entity-3", entityType: "shop" },
      ],
    }));
  });

  it("handles surveyActivate (systematic sampling)", async () => {
    const { findSurveyById } = await import("../src/modules/survey/repo.js");
    (findSurveyById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "surv-1", status: "draft", version: 1, tenantId: TENANT_ID,
      questionnaire: [{ id: "q1", fieldType: "rating", label: "Satisfaction", required: true }],
      samplingMethod: "systematic",
      sampleSizePercent: "50",
    });
    const handler = handlers.get("inspection.survey.activate");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.survey.activate", {
      surveyId: "surv-1",
      version: 1,
      entityIds: [ENTITY_ID, "entity-2", "entity-3", "entity-4"],
    }));
  });

  it("handles surveyClose", async () => {
    const { findSurveyById } = await import("../src/modules/survey/repo.js");
    (findSurveyById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "surv-1", status: "active", version: 2, tenantId: TENANT_ID,
      questionnaire: [{ id: "q1", fieldType: "rating", label: "Satisfaction", required: true }],
      samplingMethod: "random", sampleSizePercent: "50",
    });
    const handler = handlers.get("inspection.survey.close");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.survey.close", {
      surveyId: "surv-1",
      version: 2,
      closureReason: "Survey period ended",
    }));
  });

  it("handles surveyResponseSubmit", async () => {
    const { findSurveyById } = await import("../src/modules/survey/repo.js");
    (findSurveyById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "surv-1", status: "active", version: 2, tenantId: TENANT_ID,
      questionnaire: [{ id: "q1", fieldType: "rating", label: "Satisfaction", required: true }],
      samplingMethod: "random", sampleSizePercent: "50",
    });
    const handler = handlers.get("inspection.survey_response.submit");
    expect(handler).toBeDefined();
    // `answers` is a dict (not `responses` array), `capturedAt` not `submittedAt`
    await handler!(makeMsg("inspection.survey_response.submit", {
      surveyId: "surv-1",
      entityId: ENTITY_ID,
      inspectorId: USER_ID,
      answers: { q1: 4 },
      capturedAt: "2025-07-20T10:00:00Z",
    }));
  });

  it("handles surveyAggregate", async () => {
    const { findSurveyById } = await import("../src/modules/survey/repo.js");
    (findSurveyById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "surv-1", status: "closed", version: 3, tenantId: TENANT_ID,
      questionnaire: [{ id: "q1", fieldType: "rating", label: "Satisfaction", required: true }],
      samplingMethod: "random", sampleSizePercent: "50",
    });
    // findResponsesBySurvey mock returns objects with `answers` keyed by questionId
    const { findResponsesBySurvey } = await import("../src/modules/survey/repo.js");
    (findResponsesBySurvey as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { answers: { q1: 4 } },
      { answers: { q1: 5 } },
    ]);
    const handler = handlers.get("inspection.survey.aggregate");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.survey.aggregate", {
      surveyId: "surv-1",
    }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TELEMETRY CONSUMERS
// ══════════════════════════════════════════════════════════════════════════════

describe("Telemetry consumers — Sprint 15 coverage", () => {
  it("handles deviceCreate", async () => {
    const handler = handlers.get("inspection.device.create");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.device.create", {
      entityId: ENTITY_ID,
      deviceType: "smoke_detector",
      serialNumber: "SD-2025-001",
      manufacturer: "FireSafe Ltd",
      model: "FS-100",
      location: "Floor 3, Section B",
      installedAt: "2025-06-01T09:00:00Z",
    }));
  });

  it("handles deviceUpdate", async () => {
    const handler = handlers.get("inspection.device.update");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.device.update", {
      deviceId: "dev-1",
      version: 1,
      patch: { location: "Floor 4, Section A" },
    }));
  });

  it("handles readingIngest — no alert triggered", async () => {
    const { findActiveAlertRules } = await import("../src/modules/telemetry/repo.js");
    (findActiveAlertRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const handler = handlers.get("inspection.reading.ingest");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.reading.ingest", {
      deviceId: "dev-1",
      readingTimestamp: "2025-07-15T14:30:00Z",
      metrics: { temperature: 25.5, humidity: 60, smokeLevel: 0.02 },
      rawPayload: {},
    }));
  });

  it("handles readingIngest — alert triggered when metric exceeds threshold", async () => {
    const { findActiveAlertRules } = await import("../src/modules/telemetry/repo.js");
    (findActiveAlertRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "rule-1",
        metric: "smokeLevel",
        operator: "gt",
        threshold: 0.5,
        severity: "critical",
        alertMessage: "Smoke level exceeds threshold",
        deviceType: "smoke_detector",
      },
    ]);
    const handler = handlers.get("inspection.reading.ingest");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.reading.ingest", {
      deviceId: "dev-1",
      readingTimestamp: "2025-07-15T14:35:00Z",
      metrics: { smokeLevel: 0.85 },
      rawPayload: {},
    }));
  });

  it("handles alertRuleCreate", async () => {
    const handler = handlers.get("inspection.alert_rule.create");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.alert_rule.create", {
      deviceType: "smoke_detector",
      metric: "smokeLevel",
      operator: "gt",
      threshold: 0.5,
      severity: "critical",
      alertMessage: "Smoke level exceeds safe threshold",
    }));
  });

  it("handles alertAcknowledge", async () => {
    const { findAlertById } = await import("../src/modules/telemetry/repo.js");
    (findAlertById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "alert-1", status: "open", version: 1, tenantId: TENANT_ID,
      deviceId: "dev-1", ruleId: "rule-1",
    });
    const handler = handlers.get("inspection.alert.acknowledge");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.alert.acknowledge", {
      alertId: "alert-1",
      version: 1,
      acknowledgedBy: USER_ID,
      notes: "Investigating smoke detector in section B",
    }));
  });

  it("handles alertCreateFinding — alert must be in acknowledged state", async () => {
    // Default mock already returns status: "acknowledged" — suitable for finding_created transition
    const handler = handlers.get("inspection.alert.create_finding");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.alert.create_finding", {
      alertId: "alert-1",
      inspectionId: "insp-1",
      description: "Critical smoke level detected — potential fire hazard",
      severity: "critical",
    }));
  });
});
