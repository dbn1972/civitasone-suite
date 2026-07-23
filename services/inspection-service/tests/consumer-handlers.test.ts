/**
 * Consumer handler tests for all 9 modules.
 * Captures handlers via queue.subscribe mock and exercises them directly.
 * Covers happy-path execution of each command consumer.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const USER_ID = "11111111-2222-3333-4444-555555555555";
const ENTITY_ID = "eeeeeeee-1111-2222-3333-444444444444";

// ── Track handlers ────────────────────────────────────────────────────────────
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

// ── Repo Mocks ────────────────────────────────────────────────────────────────
const mockEntityRow = {
  id: ENTITY_ID, tenantId: TENANT_ID, registrationNo: "REG-001", entityType: "factory",
  name: "Test Factory", jurisdiction: "central", addressLine1: "123 St", city: "Delhi",
  state: "Delhi", pincode: "110001", riskCategory: "high", version: 1,
};

vi.mock("../src/modules/universe/repo.js", () => ({
  findEntityById: vi.fn().mockResolvedValue(mockEntityRow),
  findEntitiesByTenant: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertEntity: vi.fn().mockResolvedValue(mockEntityRow),
  updateEntity: vi.fn().mockResolvedValue({ ...mockEntityRow, version: 2 }),
  findInspectionTypeById: vi.fn().mockResolvedValue(null),
  findInspectionTypesByTenant: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertInspectionType: vi.fn().mockResolvedValue({ id: "type-1", code: "FIRE" }),
  findProvisionById: vi.fn().mockResolvedValue(null),
  findProvisionsByTenant: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertProvision: vi.fn().mockResolvedValue({ id: "prov-1" }),
  findVocabularyById: vi.fn().mockResolvedValue(null),
  findVocabulariesByTenant: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertVocabulary: vi.fn().mockResolvedValue({ id: "vocab-1" }),
  upsertVocabulary: vi.fn().mockResolvedValue({ id: "vocab-1" }),
}));

vi.mock("../src/modules/risk/repo.js", () => ({
  findModelById: vi.fn().mockResolvedValue({ id: "model-1", factors: [{ factorName: "h", weight: 1 }] }),
  findModelsByTenant: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertModel: vi.fn().mockResolvedValue({ id: "model-1" }),
  findScoreByEntity: vi.fn().mockResolvedValue({ score: 60 }),
  insertScore: vi.fn().mockResolvedValue({ id: "score-1", score: 72 }),
  findActiveModelByTenant: vi.fn().mockResolvedValue({ id: "model-1", factors: [{ factorName: "h", weight: 1, scoringFunction: "linear", dataSource: "db" }] }),
}));

vi.mock("../src/modules/planning/repo.js", () => ({
  findPlanById: vi.fn().mockResolvedValue({ id: "plan-1", status: "draft", version: 1, tenantId: TENANT_ID }),
  findPlansByTenant: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertPlan: vi.fn().mockResolvedValue({ id: "plan-1", status: "draft" }),
  updatePlan: vi.fn().mockResolvedValue({ id: "plan-1", status: "pending_approval", version: 2 }),
}));

vi.mock("../src/modules/assignment/repo.js", () => ({
  findAssignmentsByTenant: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertAssignment: vi.fn().mockResolvedValue({ id: "assign-1" }),
  findConflicts: vi.fn().mockResolvedValue([]),
  countDailyAssignments: vi.fn().mockResolvedValue(0),
  findCapacity: vi.fn().mockResolvedValue({ dailyLimit: 5 }),
  insertGeoAttendance: vi.fn().mockResolvedValue({ id: "geo-1" }),
  insertTourPlan: vi.fn().mockResolvedValue({ id: "tour-1" }),
  findTourPlan: vi.fn().mockResolvedValue(null),
}));

vi.mock("../src/modules/checklist/repo.js", () => ({
  findTemplateById: vi.fn().mockResolvedValue({ id: "tmpl-1", status: "draft", sections: [{ title: "S1", questions: [{ fieldType: "boolean", label: "Q?" }] }], versionNumber: 1 }),
  findTemplatesByTenant: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertTemplate: vi.fn().mockResolvedValue({ id: "tmpl-1" }),
  updateTemplate: vi.fn().mockResolvedValue({ id: "tmpl-1", status: "published" }),
  findInstanceById: vi.fn().mockResolvedValue({ id: "inst-1" }),
  findInstancesByInspection: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertInstance: vi.fn().mockResolvedValue({ id: "inst-1" }),
  updateInstance: vi.fn().mockResolvedValue({ id: "inst-1" }),
}));

vi.mock("../src/modules/sync/repo.js", () => ({
  findPackageById: vi.fn().mockResolvedValue(null),
  findPackagesByInspector: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertPackage: vi.fn().mockResolvedValue({ id: "pkg-1", status: "generating" }),
  updatePackage: vi.fn().mockResolvedValue({ id: "pkg-1", status: "ready" }),
  insertUpload: vi.fn().mockResolvedValue({ id: "upload-1" }),
  findUploadBySequence: vi.fn().mockResolvedValue(null),
  markUploadProcessed: vi.fn().mockResolvedValue(undefined),
  getOrCreateCursor: vi.fn().mockResolvedValue({ lastAckedSeq: 0 }),
  updateCursorSeq: vi.fn().mockResolvedValue(undefined),
  findCursorsByInspector: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/modules/evidence/repo.js", () => ({
  findEvidenceById: vi.fn().mockResolvedValue({ id: "ev-1", sha256Hash: "abc123" }),
  findEvidenceByInspection: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertEvidence: vi.fn().mockResolvedValue({ id: "ev-1" }),
  updateEvidenceIntegrity: vi.fn().mockResolvedValue(undefined),
  insertCustodyEntry: vi.fn().mockResolvedValue(undefined),
  findCustodyByEvidence: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/modules/execution/repo.js", () => ({
  findInspectionById: vi.fn().mockResolvedValue({ id: "insp-1", state: "scheduled", version: 1, tenantId: TENANT_ID }),
  findInspections: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  updateInspectionState: vi.fn().mockResolvedValue({ id: "insp-1", state: "in_progress", version: 2 }),
  insertHistory: vi.fn().mockResolvedValue(undefined),
  findHistoryByInspection: vi.fn().mockResolvedValue([]),
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
function makeMsg(topic: string, payload: unknown) {
  return {
    messageId: `msg-${Date.now()}-${Math.random()}`,
    type: topic,
    tenantId: TENANT_ID,
    actorId: USER_ID,
    correlationId: "corr-1",
    schemaVersion: 1,
    payload,
  };
}

// ── Register all consumers ────────────────────────────────────────────────────
beforeAll(async () => {
  const { queue } = await import("../src/shared/infra.js");
  const { registerUniverseConsumers } = await import("../src/modules/universe/consumer.js");
  const { registerRiskConsumers } = await import("../src/modules/risk/consumer.js");
  const { registerPlanningConsumers } = await import("../src/modules/planning/consumer.js");
  const { registerAssignmentConsumers } = await import("../src/modules/assignment/consumer.js");
  const { registerChecklistConsumers } = await import("../src/modules/checklist/consumer.js");
  const { registerSyncConsumers } = await import("../src/modules/sync/consumer.js");
  const { registerEvidenceConsumers } = await import("../src/modules/evidence/consumer.js");
  const { registerExecutionConsumers } = await import("../src/modules/execution/consumer.js");
  const { registerFindingsConsumers } = await import("../src/modules/findings/consumer.js");

  registerUniverseConsumers(queue as any);
  registerRiskConsumers(queue as any);
  registerPlanningConsumers(queue as any);
  registerAssignmentConsumers(queue as any);
  registerChecklistConsumers(queue as any);
  registerSyncConsumers(queue as any);
  registerEvidenceConsumers(queue as any);
  registerExecutionConsumers(queue as any);
  registerFindingsConsumers(queue as any);
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// UNIVERSE CONSUMERS
// ══════════════════════════════════════════════════════════════════════════════

describe("Universe consumers", () => {
  it("handles entityCreate", async () => {
    const handler = handlers.get("inspection.entity.create");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.entity.create", {
      registrationNo: "REG-100", entityType: "factory", name: "New Factory",
      jurisdiction: "central", addressLine1: "123 St", city: "Delhi", state: "Delhi",
      pincode: "110001", riskCategory: "high",
    }));
  });

  it("handles entityUpdate", async () => {
    const handler = handlers.get("inspection.entity.update");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.entity.update", {
      entityId: ENTITY_ID, version: 1, patch: { name: "Updated" },
    }));
  });

  it("handles inspectionTypeCreate", async () => {
    const handler = handlers.get("inspection.type.create");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.type.create", {
      code: "FIRE", name: "Fire Safety", applicableEntityTypes: ["factory"],
      requiredCompetencies: ["fire_cert"],
    }));
  });

  it("handles provisionCreate", async () => {
    const handler = handlers.get("inspection.provision.create");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.provision.create", {
      actReference: "Act 1948", sectionNumber: "S.14", description: "Fire exits",
      severityClassification: "critical",
    }));
  });

  it("handles vocabularyUpsert", async () => {
    const handler = handlers.get("inspection.vocabulary.upsert");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.vocabulary.upsert", {
      category: "entity_type", code: "factory", label: "Factory",
    }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RISK CONSUMERS
// ══════════════════════════════════════════════════════════════════════════════

describe("Risk consumers", () => {
  it("handles riskModelConfigure", async () => {
    const handler = handlers.get("inspection.risk_model.configure");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.risk_model.configure", {
      name: "Default", factors: [{ factorName: "history", weight: 1.0, scoringFunction: "linear", dataSource: "db" }],
    }));
  });

  it("handles riskScoreCompute", async () => {
    const handler = handlers.get("inspection.risk_score.compute");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.risk_score.compute", {
      entityId: ENTITY_ID, modelId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PLANNING CONSUMERS
// ══════════════════════════════════════════════════════════════════════════════

describe("Planning consumers", () => {
  it("handles planCreate", async () => {
    const handler = handlers.get("inspection.plan.create");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.plan.create", {
      name: "Q1 Plan", periodStart: "2025-01-01", periodEnd: "2025-03-31",
      entityIds: [ENTITY_ID], selectionCriteria: { riskThreshold: 70 },
    }));
  });

  it("handles planModify", async () => {
    const handler = handlers.get("inspection.plan.modify");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.plan.modify", {
      planId: "plan-1", version: 1, patch: { name: "Updated Q1" },
    }));
  });

  it("handles planSubmitApproval", async () => {
    const handler = handlers.get("inspection.plan.submit_approval");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.plan.submit_approval", {
      planId: "plan-1", version: 1,
    }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ASSIGNMENT CONSUMERS
// ══════════════════════════════════════════════════════════════════════════════

describe("Assignment consumers", () => {
  it("handles inspectorAssign", async () => {
    const handler = handlers.get("inspection.inspector.assign");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.inspector.assign", {
      inspectionId: "insp-1", inspectorId: USER_ID, inspectionTypeId: "type-1",
      entityId: ENTITY_ID, scheduledDate: "2025-06-15",
    }));
  });

  it("handles tourPlanGenerate", async () => {
    const handler = handlers.get("inspection.tour_plan.generate");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.tour_plan.generate", {
      inspectorId: USER_ID, periodStart: "2025-06-01", periodEnd: "2025-06-30",
    }));
  });

  it("handles geoAttendanceMark", async () => {
    const handler = handlers.get("inspection.geo_attendance.mark");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.geo_attendance.mark", {
      inspectionId: "insp-1", inspectorId: USER_ID, latitude: "28.6139", longitude: "77.2090",
      entityLatitude: "28.6140", entityLongitude: "77.2091", geofenceRadius: 500,
      deviceId: "device-001", timestamp: "2025-06-15T10:00:00Z",
    }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CHECKLIST CONSUMERS
// ══════════════════════════════════════════════════════════════════════════════

describe("Checklist consumers", () => {
  it("handles templateCreate", async () => {
    const handler = handlers.get("inspection.template.create");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.template.create", {
      name: "Fire Safety", sections: [{ title: "S1", questions: [{ fieldType: "boolean", label: "Q?" }] }],
    }));
  });

  it("handles templatePublish", async () => {
    const handler = handlers.get("inspection.template.publish");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.template.publish", {
      templateId: "tmpl-1", version: 1,
    }));
  });

  it("handles instanceGenerate", async () => {
    const { findTemplateById } = await import("../src/modules/checklist/repo.js");
    (findTemplateById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "tmpl-1", status: "published", sections: [{ title: "S1", questions: [{ fieldType: "boolean", label: "Q?" }] }], versionNumber: 1,
    });
    const handler = handlers.get("inspection.instance.generate");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.instance.generate", {
      inspectionId: "insp-1", templateId: "tmpl-1", templateVersion: 1,
    }));
  });

  it("handles instanceSubmitResponse", async () => {
    const { findInstanceById } = await import("../src/modules/checklist/repo.js");
    (findInstanceById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "inst-1", sections: [{ title: "S1", weight: 1, questions: [{ id: "q1", fieldType: "boolean", label: "Q?", required: true }] }],
      responses: [],
    });
    const handler = handlers.get("inspection.instance.submit_response");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.instance.submit_response", {
      instanceId: "inst-1", responses: [{ questionId: "q1", value: true, capturedAt: "2025-01-01T00:00:00Z" }],
    }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SYNC CONSUMERS
// ══════════════════════════════════════════════════════════════════════════════

describe("Sync consumers", () => {
  it("handles syncPackageGenerate", async () => {
    const handler = handlers.get("inspection.sync_package.generate");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.sync_package.generate", {
      inspectorId: USER_ID, inspectionIds: ["insp-1"],
    }));
  });

  it("handles syncUpload", async () => {
    // Use the deterministic serialization to get correct hash
    const { deterministicSerialize } = await import("../src/modules/sync/domain.js");
    const { createHash } = await import("node:crypto");
    const payload = { responses: {}, evidence: [] };
    const serialized = deterministicSerialize(payload);
    const sha256Hash = createHash("sha256").update(serialized).digest("hex");

    const handler = handlers.get("inspection.sync.upload");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.sync.upload", {
      inspectorId: USER_ID, inspectionId: "insp-1", deviceId: "device-001",
      sequenceNumber: 1, payload, sha256Hash, networkState: "online",
    }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EVIDENCE CONSUMERS
// ══════════════════════════════════════════════════════════════════════════════

describe("Evidence consumers", () => {
  it("handles evidenceRegister", async () => {
    const handler = handlers.get("inspection.evidence.register");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.evidence.register", {
      inspectionId: "insp-1", sha256Hash: "deadbeef", mimeType: "image/jpeg",
      fileSizeBytes: 1024, s3Key: "evidence/photo.jpg",
      captureTimestamp: "2025-01-01T00:00:00Z", deviceId: "dev-1", inspectorId: USER_ID,
    }));
  });

  it("handles evidenceVerifyIntegrity", async () => {
    const handler = handlers.get("inspection.evidence.verify_integrity");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.evidence.verify_integrity", {
      evidenceId: "ev-1", computedHash: "abc123",
    }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EXECUTION CONSUMERS
// ══════════════════════════════════════════════════════════════════════════════

describe("Execution consumers", () => {
  it("handles inspectionTransition", async () => {
    const handler = handlers.get("inspection.inspection.transition");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.inspection.transition", {
      inspectionId: "insp-1", targetState: "in_progress",
    }));
  });

  it("handles inspectionSubmitReview", async () => {
    const { findInspectionById } = await import("../src/modules/execution/repo.js");
    (findInspectionById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "insp-1", state: "completed", version: 1, tenantId: TENANT_ID,
    });
    const handler = handlers.get("inspection.inspection.submit_review");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.inspection.submit_review", {
      inspectionId: "insp-1", reviewerId: USER_ID,
    }));
  });

  it("handles inspectionFinalize", async () => {
    const { findInspectionById } = await import("../src/modules/execution/repo.js");
    (findInspectionById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "insp-1", state: "under_review", version: 1, tenantId: TENANT_ID,
    });
    const handler = handlers.get("inspection.inspection.finalize");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.inspection.finalize", {
      inspectionId: "insp-1",
    }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FINDINGS CONSUMERS
// ══════════════════════════════════════════════════════════════════════════════

describe("Findings consumers", () => {
  it("handles findingCreate", async () => {
    const { findProvisionById } = await import("../src/modules/universe/repo.js");
    (findProvisionById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: "prov-1", severityClass: "critical", actReference: "Act 1948", sectionNumber: "S.14",
    });
    const handler = handlers.get("inspection.finding.create");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.finding.create", {
      inspectionId: "insp-1", provisionId: "prov-1", description: "Fire exit blocked",
      evidenceIds: ["ev-1"],
    }));
  });

  it("handles complianceNoticeCreate", async () => {
    const handler = handlers.get("inspection.compliance_notice.create");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.compliance_notice.create", {
      findingId: "find-1", dueDate: "2025-07-01", requiredAction: "Fix exits",
      responsibleParty: "Factory Manager",
    }));
  });

  it("handles findingVerifyResolved", async () => {
    const handler = handlers.get("inspection.finding.verify_resolved");
    expect(handler).toBeDefined();
    await handler!(makeMsg("inspection.finding.verify_resolved", {
      findingId: "find-1", evidenceIds: ["ev-1"],
    }));
  });
});
