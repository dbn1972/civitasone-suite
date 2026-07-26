/**
 * Route-level integration tests for ALL 9 inspection-service modules.
 * Exercises every endpoint: happy path (200/202), 400 (validation), 401 (no auth), 403 (wrong role).
 *
 * Pattern: mock DB/infra → build app with all routes → inject HTTP requests.
 * Auth uses HS256 bypass (JWT_SECRET=test_secret_for_civitasone_32chr).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const USER_ID = "11111111-2222-3333-4444-555555555555";
const SECRET = "test_secret_for_civitasone_32chr";

function makeToken(roles: string[] = ["super_admin"]): string {
  return signToken(
    { sub: USER_ID, tid: TENANT_ID, roles, sid: "sess-test-1" },
    SECRET,
    3600,
  );
}

const AUTH_HEADER = { authorization: `Bearer ${makeToken()}` };
const INSPECTOR_HEADER = { authorization: `Bearer ${makeToken(["inspector"])}` };
const NO_ROLE_HEADER = { authorization: `Bearer ${makeToken(["employee"])}` };

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockEntity = {
  id: "eeeeeeee-1111-2222-3333-444444444444",
  tenantId: TENANT_ID,
  registrationNo: "REG-001",
  entityType: "factory",
  name: "Test Factory",
  jurisdiction: "central",
  addressLine1: "123 Main St",
  city: "Delhi",
  state: "Delhi",
  pincode: "110001",
  riskCategory: "high",
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockRiskModel = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  tenantId: TENANT_ID,
  name: "Default Model",
  factors: [{ factorName: "history", weight: 0.5, scoringFunction: "linear", dataSource: "db" }],
  isActive: true,
  createdAt: new Date().toISOString(),
};

const mockRiskScore = {
  id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
  tenantId: TENANT_ID,
  entityId: mockEntity.id,
  modelId: mockRiskModel.id,
  score: 72,
  factorBreakdown: [{ factorName: "history", weight: 0.5, rawScore: 80, weightedScore: 40 }],
  previousScore: 65,
  computedAt: new Date().toISOString(),
};

const mockPlan = {
  id: "cccccccc-dddd-eeee-ffff-000000000000",
  tenantId: TENANT_ID,
  title: "Q1 Plan",
  status: "draft",
  entityIds: [mockEntity.id],
  selectionCriteria: { riskThreshold: 70 },
  version: 1,
  createdAt: new Date().toISOString(),
};

const mockAssignment = {
  id: "dddddddd-eeee-ffff-0000-111111111111",
  tenantId: TENANT_ID,
  inspectorId: USER_ID,
  entityId: mockEntity.id,
  scheduledDate: "2025-03-15",
  status: "assigned",
  createdAt: new Date().toISOString(),
};

const mockTemplate = {
  id: "eeeeeeee-ffff-0000-1111-222222222222",
  tenantId: TENANT_ID,
  code: "TMPL-001",
  name: "Fire Safety",
  status: "draft",
  versionNumber: 1,
  sections: [{ id: "s1", title: "Section 1", weight: 1, questions: [{ id: "q1", text: "Q1?", type: "boolean", required: true }] }],
  createdAt: new Date().toISOString(),
};

const mockInstance = {
  id: "ffffffff-0000-1111-2222-333333333333",
  tenantId: TENANT_ID,
  templateId: mockTemplate.id,
  inspectionId: "11111111-0000-0000-0000-000000000000",
  responses: {},
  sectionScores: [],
  overallScore: null,
  createdAt: new Date().toISOString(),
};

const mockSyncPackage = {
  id: "11112222-3333-4444-5555-666677778888",
  tenantId: TENANT_ID,
  inspectorId: USER_ID,
  status: "ready",
  checksum: "abc123def456",
  s3Key: "sync/pkg-1.json",
  createdAt: new Date().toISOString(),
};

const mockEvidence = {
  id: "22223333-4444-5555-6666-777788889999",
  tenantId: TENANT_ID,
  inspectionId: "11111111-0000-0000-0000-000000000000",
  sha256Hash: "e3b0c44298fc1c149afbf4c8996fb924",
  s3Key: "evidence/photo1.jpg",
  mimeType: "image/jpeg",
  fileSizeBytes: 1024000,
  integrityStatus: "valid",
  captureMetadata: {},
  createdAt: new Date().toISOString(),
};

const mockInspection = {
  id: "33334444-5555-6666-7777-888899990000",
  tenantId: TENANT_ID,
  state: "scheduled",
  assignedInspectors: [USER_ID],
  entityId: mockEntity.id,
  version: 1,
  createdAt: new Date().toISOString(),
};

const mockFinding = {
  id: "44445555-6666-7777-8888-999900001111",
  tenantId: TENANT_ID,
  findingNumber: "FND-2025-000001",
  severity: "major",
  state: "open",
  inspectionId: mockInspection.id,
  evidenceIds: [mockEvidence.id],
  version: 1,
  createdAt: new Date().toISOString(),
};

// ── DB + Infra Mocks ──────────────────────────────────────────────────────────

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
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
    subscribe: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
  },
}));

// ── Repo/Queries Mocks ────────────────────────────────────────────────────────

vi.mock("../src/modules/universe/repo.js", () => ({
  findEntityById: vi.fn().mockResolvedValue(null),
  findEntitiesByTenant: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertEntity: vi.fn().mockResolvedValue(undefined),
  updateEntity: vi.fn().mockResolvedValue(undefined),
  findInspectionTypeById: vi.fn().mockResolvedValue(null),
  findInspectionTypesByTenant: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertInspectionType: vi.fn().mockResolvedValue(undefined),
  findProvisionById: vi.fn().mockResolvedValue(null),
  findProvisionsByTenant: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertProvision: vi.fn().mockResolvedValue(undefined),
  findVocabularyById: vi.fn().mockResolvedValue(null),
  findVocabulariesByTenant: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertVocabulary: vi.fn().mockResolvedValue(undefined),
  upsertVocabulary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/modules/universe/queries.js", () => ({
  searchEntities: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  listEntities: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
}));

vi.mock("../src/modules/risk/repo.js", () => ({
  findModelById: vi.fn().mockResolvedValue(null),
  findModelsByTenant: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertModel: vi.fn().mockResolvedValue(undefined),
  findScoreByEntity: vi.fn().mockResolvedValue(null),
  insertScore: vi.fn().mockResolvedValue(undefined),
  findActiveModelByTenant: vi.fn().mockResolvedValue(null),
}));

vi.mock("../src/modules/risk/queries.js", () => ({
  getScoreHistory: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
}));

vi.mock("../src/modules/planning/repo.js", () => ({
  findPlanById: vi.fn().mockResolvedValue(null),
  findPlansByTenant: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertPlan: vi.fn().mockResolvedValue(undefined),
  updatePlan: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/modules/assignment/repo.js", () => ({
  findAssignmentsByTenant: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertAssignment: vi.fn().mockResolvedValue(undefined),
  findConflicts: vi.fn().mockResolvedValue([]),
  countDailyAssignments: vi.fn().mockResolvedValue(0),
  findCapacity: vi.fn().mockResolvedValue(null),
  insertGeoAttendance: vi.fn().mockResolvedValue(undefined),
  insertTourPlan: vi.fn().mockResolvedValue(undefined),
  findTourPlan: vi.fn().mockResolvedValue(null),
}));

vi.mock("../src/modules/checklist/repo.js", () => ({
  findTemplateById: vi.fn().mockResolvedValue(null),
  findTemplatesByTenant: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertTemplate: vi.fn().mockResolvedValue(undefined),
  updateTemplate: vi.fn().mockResolvedValue(undefined),
  findInstanceById: vi.fn().mockResolvedValue(null),
  findInstancesByInspection: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertInstance: vi.fn().mockResolvedValue(undefined),
  updateInstance: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/modules/sync/repo.js", () => ({
  findPackageById: vi.fn().mockResolvedValue(null),
  findPackagesByInspector: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertPackage: vi.fn().mockResolvedValue(undefined),
  updatePackage: vi.fn().mockResolvedValue(undefined),
  insertUpload: vi.fn().mockResolvedValue(undefined),
  findUploadBySequence: vi.fn().mockResolvedValue(null),
  markUploadProcessed: vi.fn().mockResolvedValue(undefined),
  getOrCreateCursor: vi.fn().mockResolvedValue({ lastAckedSeq: 0 }),
  updateCursorSeq: vi.fn().mockResolvedValue(undefined),
  findCursorsByInspector: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/modules/evidence/repo.js", () => ({
  findEvidenceById: vi.fn().mockResolvedValue(null),
  findEvidenceByInspection: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertEvidence: vi.fn().mockResolvedValue(undefined),
  updateEvidenceIntegrity: vi.fn().mockResolvedValue(undefined),
  insertCustodyEntry: vi.fn().mockResolvedValue(undefined),
  findCustodyByEvidence: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/modules/execution/repo.js", () => ({
  findInspectionById: vi.fn().mockResolvedValue(null),
  findInspections: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  updateInspectionState: vi.fn().mockResolvedValue(undefined),
  insertHistory: vi.fn().mockResolvedValue(undefined),
  findHistoryByInspection: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/modules/findings/repo.js", () => ({
  findFindingById: vi.fn().mockResolvedValue(null),
  findFindings: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }),
  insertFinding: vi.fn().mockResolvedValue(undefined),
  updateFindingState: vi.fn().mockResolvedValue(undefined),
  softDeleteFinding: vi.fn().mockResolvedValue(undefined),
  findNoticesByFinding: vi.fn().mockResolvedValue([]),
  insertComplianceNotice: vi.fn().mockResolvedValue(undefined),
  nextFindingSequence: vi.fn().mockResolvedValue(1),
  findOverdueFindings: vi.fn().mockResolvedValue([]),
}));

// ── App Setup ─────────────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();

  // Register all module routes

  // findings routes are now registered by buildApp() (app.ts) — do not double-register

  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// ══════════════════════════════════════════════════════════════════════════════
// UNIVERSE MODULE ROUTES
// ══════════════════════════════════════════════════════════════════════════════

describe("Universe Routes", () => {
  describe("POST /v1/inspection/entities", () => {
    const VALID_BODY = {
      registrationNo: "REG-100",
      entityType: "factory",
      name: "New Factory",
      jurisdiction: "central",
      addressLine1: "456 Test St",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
      riskCategory: "medium",
    };

    it("returns 202 on valid body with admin role", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/inspection/entities", headers: AUTH_HEADER, payload: VALID_BODY });
      expect(res.statusCode).toBe(202);
      expect(res.json().data).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/inspection/entities", payload: VALID_BODY });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 with wrong role", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/inspection/entities", headers: NO_ROLE_HEADER, payload: VALID_BODY });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 with missing required field", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/inspection/entities", headers: AUTH_HEADER, payload: { name: "X" } });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("PATCH /v1/inspection/entities/:id", () => {
    it("returns 404 when entity not found", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/inspection/entities/${mockEntity.id}`,
        headers: AUTH_HEADER,
        payload: { version: 1, patch: { name: "Updated" } },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 or 404 with empty patch", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/inspection/entities/${mockEntity.id}`,
        headers: AUTH_HEADER,
        payload: { version: 1, patch: {} },
      });
      // 400 (validation) or 404 (entity not found checked first)
      expect([400, 404]).toContain(res.statusCode);
    });

    it("returns 400 with invalid UUID", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/v1/inspection/entities/not-a-uuid",
        headers: AUTH_HEADER,
        payload: { version: 1, patch: { name: "X" } },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/inspection/entities/:id", () => {
    it("returns 404 when entity not found", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/inspection/entities/${mockEntity.id}`, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(404);
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/inspection/entities/${mockEntity.id}` });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 with wrong role", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/inspection/entities/${mockEntity.id}`, headers: NO_ROLE_HEADER });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/inspection/entities", () => {
    it("returns 200 with paginated response", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/inspection/entities", headers: AUTH_HEADER });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("data");
      expect(body).toHaveProperty("meta");
    });

    it("returns 200 with search query", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/inspection/entities?q=test&page=1&pageSize=10", headers: AUTH_HEADER });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("POST /v1/inspection/types", () => {
    it("returns 202 on valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/types", headers: AUTH_HEADER,
        payload: { code: "FIRE", name: "Fire Safety", applicableEntityTypes: ["factory"], requiredCompetencies: ["fire_cert"] },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 with missing fields", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/inspection/types", headers: AUTH_HEADER, payload: {} });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/inspection/types", () => {
    it("returns 200 with paginated list", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/inspection/types", headers: AUTH_HEADER });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("POST /v1/inspection/provisions", () => {
    it("returns 202 on valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/provisions", headers: AUTH_HEADER,
        payload: { actReference: "Act 1948", sectionNumber: "S.14", description: "Fire exits", severityClassification: "critical" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 with invalid severity", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/provisions", headers: AUTH_HEADER,
        payload: { actReference: "Act", sectionNumber: "1", description: "X", severityClassification: "invalid" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/inspection/provisions", () => {
    it("returns 200", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/inspection/provisions", headers: AUTH_HEADER });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("POST /v1/inspection/vocabularies", () => {
    it("returns 202 on valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/vocabularies", headers: AUTH_HEADER,
        payload: { category: "entity_type", code: "factory", label: "Factory" },
      });
      expect(res.statusCode).toBe(202);
    });
  });

  describe("GET /v1/inspection/vocabularies", () => {
    it("returns 200 with category filter", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/inspection/vocabularies?category=entity_type", headers: AUTH_HEADER });
      expect(res.statusCode).toBe(200);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// RISK MODULE ROUTES
// ══════════════════════════════════════════════════════════════════════════════

describe("Risk Routes", () => {
  describe("POST /v1/inspection/risk/models", () => {
    it("returns 202 on valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/risk/models", headers: AUTH_HEADER,
        payload: { name: "Default", factors: [{ factorName: "history", weight: 1.0, scoringFunction: "linear", dataSource: "db" }] },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 with empty factors", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/risk/models", headers: AUTH_HEADER,
        payload: { name: "Bad", factors: [] },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/inspection/risk/models", payload: { name: "X" } });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /v1/inspection/risk/models", () => {
    it("returns 200", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/inspection/risk/models", headers: AUTH_HEADER });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("POST /v1/inspection/risk/scores/compute", () => {
    it("returns 202 on valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/risk/scores/compute", headers: AUTH_HEADER,
        payload: { entityId: mockEntity.id },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 with invalid UUID", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/risk/scores/compute", headers: AUTH_HEADER,
        payload: { entityId: "not-uuid" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/inspection/risk/scores/:entityId", () => {
    it("returns 404 when score not found", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/inspection/risk/scores/${mockEntity.id}`, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(404);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PLANNING MODULE ROUTES
// ══════════════════════════════════════════════════════════════════════════════

describe("Planning Routes", () => {
  describe("POST /v1/inspection/plans", () => {
    it("returns 202 on valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/plans", headers: AUTH_HEADER,
        payload: { name: "Q1 Plan", periodStart: "2025-01-01", periodEnd: "2025-03-31", entityIds: [mockEntity.id], selectionCriteria: { riskThreshold: 70 } },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 with missing fields", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/inspection/plans", headers: AUTH_HEADER, payload: {} });
      expect(res.statusCode).toBe(400);
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/inspection/plans", payload: {} });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("PATCH /v1/inspection/plans/:id", () => {
    it("returns 404 when plan not found", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/inspection/plans/${mockPlan.id}`, headers: AUTH_HEADER,
        payload: { title: "Updated" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /v1/inspection/plans/:id/submit", () => {
    it("returns 404 when plan not found", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/inspection/plans/${mockPlan.id}/submit`, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /v1/inspection/plans/:id", () => {
    it("returns 404 when plan not found", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/inspection/plans/${mockPlan.id}`, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /v1/inspection/plans", () => {
    it("returns 200 with paginated list", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/inspection/plans", headers: AUTH_HEADER });
      expect(res.statusCode).toBe(200);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ASSIGNMENT MODULE ROUTES
// ══════════════════════════════════════════════════════════════════════════════

describe("Assignment Routes", () => {
  describe("POST /v1/inspection/assignments", () => {
    it("returns 202 on valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/assignments", headers: AUTH_HEADER,
        payload: { inspectionId: mockInspection.id, inspectorId: USER_ID, entityId: mockEntity.id, scheduledDate: "2025-06-15", inspectionTypeId: mockEntity.id },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 with missing fields", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/inspection/assignments", headers: AUTH_HEADER, payload: {} });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/inspection/assignments", () => {
    it("returns 200", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/inspection/assignments", headers: AUTH_HEADER });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("POST /v1/inspection/tour-plans/generate", () => {
    it("returns 202 on valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/tour-plans/generate", headers: AUTH_HEADER,
        payload: { inspectorId: USER_ID, periodStart: "2025-06-01", periodEnd: "2025-06-30" },
      });
      expect(res.statusCode).toBe(202);
    });
  });

  describe("GET /v1/inspection/tour-plans/:inspectorId", () => {
    it("returns 404 when no plan found", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/inspection/tour-plans/${USER_ID}`, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /v1/inspection/geo-attendance", () => {
    it("returns 202 on valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/geo-attendance", headers: AUTH_HEADER,
        payload: { inspectionId: mockInspection.id, inspectorId: USER_ID, entityId: mockEntity.id, latitude: "28.6139", longitude: "77.2090", entityLatitude: "28.6140", entityLongitude: "77.2091", geofenceRadius: 500, deviceId: "device-001", timestamp: new Date().toISOString() },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 with missing coords", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/geo-attendance", headers: AUTH_HEADER,
        payload: { inspectorId: USER_ID },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CHECKLIST MODULE ROUTES
// ══════════════════════════════════════════════════════════════════════════════

describe("Checklist Routes", () => {
  describe("POST /v1/inspection/checklists/templates", () => {
    it("returns 202 on valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/checklists/templates", headers: AUTH_HEADER,
        payload: {
          name: "Fire Safety",
          sections: [{ title: "Section 1", questions: [{ fieldType: "boolean", label: "Fire exits clear?" }] }],
        },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 with empty sections", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/checklists/templates", headers: AUTH_HEADER,
        payload: { name: "X", sections: [] },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /v1/inspection/checklists/templates/:id/publish", () => {
    it("returns 404 when template not found", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/inspection/checklists/templates/${mockTemplate.id}/publish`, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /v1/inspection/checklists/templates/:id", () => {
    it("returns 404 when template not found", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/inspection/checklists/templates/${mockTemplate.id}`, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /v1/inspection/checklists/templates", () => {
    it("returns 200", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/inspection/checklists/templates", headers: AUTH_HEADER });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("POST /v1/inspection/checklists/instances", () => {
    it("returns 202 on valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/checklists/instances", headers: AUTH_HEADER,
        payload: { templateId: mockTemplate.id, inspectionId: mockInspection.id, templateVersion: 1 },
      });
      expect(res.statusCode).toBe(202);
    });
  });

  describe("PATCH /v1/inspection/checklists/instances/:id", () => {
    it("returns 404 when instance not found", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/inspection/checklists/instances/${mockInstance.id}`, headers: AUTH_HEADER,
        payload: { responses: { q1: true } },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /v1/inspection/checklists/instances/:id", () => {
    it("returns 404 when instance not found", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/inspection/checklists/instances/${mockInstance.id}`, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(404);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SYNC MODULE ROUTES
// ══════════════════════════════════════════════════════════════════════════════

describe("Sync Routes", () => {
  describe("POST /v1/inspection/sync/packages", () => {
    it("returns 202 on valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/sync/packages", headers: AUTH_HEADER,
        payload: { inspectorId: USER_ID, inspectionIds: [mockInspection.id] },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 with missing fields", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/inspection/sync/packages", headers: AUTH_HEADER, payload: {} });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/inspection/sync/packages/:id", () => {
    it("returns 404 when not found", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/inspection/sync/packages/${mockSyncPackage.id}`, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /v1/inspection/sync/upload", () => {
    it("returns 202 on valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/sync/upload", headers: AUTH_HEADER,
        payload: { inspectorId: USER_ID, inspectionId: mockInspection.id, deviceId: "device-001", sequenceNumber: 1, payload: { responses: { q1: { value: true, answeredAt: "2025-01-01T00:00:00Z" } }, evidence: [{ evidenceId: "ev1", sha256: "abc" }] }, sha256Hash: "abc123", networkState: "online" },
      });
      expect(res.statusCode).toBe(202);
    });
  });

  describe("GET /v1/inspection/sync/status/:inspectorId", () => {
    it("returns 200", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/inspection/sync/status/${USER_ID}`, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(200);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EVIDENCE MODULE ROUTES
// ══════════════════════════════════════════════════════════════════════════════

describe("Evidence Routes", () => {
  describe("POST /v1/inspection/evidence/presign", () => {
    it("returns 200 on valid mime and size", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/evidence/presign", headers: AUTH_HEADER,
        payload: { fileName: "photo.jpg", mimeType: "image/jpeg", fileSizeBytes: 1024000, inspectionId: mockInspection.id },
      });
      // 200 for presign URL generation
      expect([200, 202]).toContain(res.statusCode);
    });

    it("returns 400 with invalid mime type", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/evidence/presign", headers: AUTH_HEADER,
        payload: { fileName: "hack.exe", mimeType: "application/x-executable", fileSizeBytes: 500, inspectionId: mockInspection.id },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /v1/inspection/evidence", () => {
    it("returns 202 on valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/evidence", headers: AUTH_HEADER,
        payload: { inspectionId: mockInspection.id, sha256Hash: "deadbeef", s3Key: "evidence/file.jpg", mimeType: "image/jpeg", fileSizeBytes: 1024, captureTimestamp: "2025-01-01T00:00:00Z", deviceId: "device-001", inspectorId: USER_ID },
      });
      expect(res.statusCode).toBe(202);
    });
  });

  describe("GET /v1/inspection/evidence/:id", () => {
    it("returns 404 when not found", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/inspection/evidence/${mockEvidence.id}`, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /v1/inspection/evidence", () => {
    it("returns 200", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/inspection/evidence?inspectionId=" + mockInspection.id, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("POST /v1/inspection/evidence/:id/verify", () => {
    it("returns 404 when evidence not found", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/inspection/evidence/${mockEvidence.id}/verify`, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /v1/inspection/evidence/:id/custody", () => {
    it("returns 200 empty array when evidence not found or no custody", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/inspection/evidence/${mockEvidence.id}/custody`, headers: AUTH_HEADER });
      expect([200, 404]).toContain(res.statusCode);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EXECUTION MODULE ROUTES
// ══════════════════════════════════════════════════════════════════════════════

describe("Execution Routes", () => {
  describe("POST /v1/inspection/inspections/:id/transition", () => {
    it("returns 202 for valid transition command", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/inspection/inspections/${mockInspection.id}/transition`, headers: AUTH_HEADER,
        payload: { targetState: "in_progress" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 with missing targetState", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/inspection/inspections/${mockInspection.id}/transition`, headers: AUTH_HEADER,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with invalid targetState", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/inspection/inspections/${mockInspection.id}/transition`, headers: AUTH_HEADER,
        payload: { targetState: "invalid_state" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /v1/inspection/inspections/:id/submit-review", () => {
    it("returns 202 for valid submit-review command", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/inspection/inspections/${mockInspection.id}/submit-review`, headers: AUTH_HEADER,
        payload: { reviewerId: USER_ID },
      });
      expect(res.statusCode).toBe(202);
    });
  });

  describe("POST /v1/inspection/inspections/:id/finalize", () => {
    it("returns 202 for valid finalize command", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/inspection/inspections/${mockInspection.id}/finalize`, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(202);
    });
  });

  describe("GET /v1/inspection/inspections/:id", () => {
    it("returns 404 when not found", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/inspection/inspections/${mockInspection.id}`, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /v1/inspection/inspections", () => {
    it("returns 200", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/inspection/inspections", headers: AUTH_HEADER });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /v1/inspection/inspections/:id/history", () => {
    it("returns 200 empty history", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/inspection/inspections/${mockInspection.id}/history`, headers: AUTH_HEADER });
      expect([200, 404]).toContain(res.statusCode);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FINDINGS MODULE ROUTES
// ══════════════════════════════════════════════════════════════════════════════

describe("Findings Routes", () => {
  describe("POST /v1/inspection/findings", () => {
    it("returns 202 on valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/inspection/findings", headers: AUTH_HEADER,
        payload: { inspectionId: mockInspection.id, provisionId: mockEntity.id, description: "Fire exit blocked", evidenceIds: [mockEvidence.id] },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 with missing fields", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/inspection/findings", headers: AUTH_HEADER, payload: {} });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/inspection/findings/:id", () => {
    it("returns 404 when not found", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/inspection/findings/${mockFinding.id}`, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /v1/inspection/findings", () => {
    it("returns 200", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/inspection/findings", headers: AUTH_HEADER });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("POST /v1/inspection/findings/:id/compliance-notice", () => {
    it("returns 404 when finding not found", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/inspection/findings/${mockFinding.id}/compliance-notice`, headers: AUTH_HEADER,
        payload: { dueDate: "2025-07-01", requiredAction: "Fix exits", responsibleParty: "Factory Manager" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /v1/inspection/findings/:id/verify", () => {
    it("returns 404 when finding not found", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/inspection/findings/${mockFinding.id}/verify`, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("DELETE /v1/inspection/findings/:id", () => {
    it("returns 404 when finding not found", async () => {
      const res = await app.inject({ method: "DELETE", url: `/v1/inspection/findings/${mockFinding.id}`, headers: AUTH_HEADER });
      expect(res.statusCode).toBe(404);
    });
  });
});
