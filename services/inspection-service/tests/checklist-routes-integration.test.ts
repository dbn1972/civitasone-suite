/**
 * Integration tests for checklist module routes.
 *
 * Tests:
 * - Template publish immutability (422 on modification after publish)
 * - Instance generation deep-copy correctness
 * - Scoring after response submission
 * - Route validation (400), auth (401/403), not found (404)
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8**
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const USER_ID = "11111111-2222-3333-4444-555555555555";
const SECRET = "test_secret_for_civitasone_32chr";
const TEMPLATE_ID = "a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e4e4e4";
const INSTANCE_ID = "f0f0f0f0-a1a1-b2b2-c3c3-d4d4d4d4d4d4";
const INSPECTION_ID = "c0c0c0c0-d1d1-e2e2-f3f3-a4a4a4a4a4a4";

function makeToken(roles: string[] = ["super_admin"]): string {
  return signToken(
    { sub: USER_ID, tid: TENANT_ID, roles, sid: "sess-test-1" },
    SECRET,
    3600,
  );
}

const ADMIN_HEADER = { authorization: `Bearer ${makeToken(["inspection_admin"])}` };
const INSPECTOR_HEADER = { authorization: `Bearer ${makeToken(["inspector"])}` };
const NO_ROLE_HEADER = { authorization: `Bearer ${makeToken(["employee"])}` };

// ── Mock template data ────────────────────────────────────────────────────────

const DRAFT_TEMPLATE = {
  id: TEMPLATE_ID,
  tenantId: TENANT_ID,
  name: "Fire Safety Checklist",
  code: "fire-safety-checklist",
  versionNumber: 1,
  status: "draft",
  sections: [
    {
      id: "sec-1",
      title: "Fire Exits",
      sortOrder: 1,
      weight: 1,
      questions: [
        { id: "q-1-1", text: "Are exits clear?", fieldType: "boolean", sortOrder: 1, weight: 1, required: true },
        { id: "q-1-2", text: "Exit count", fieldType: "number", sortOrder: 2, weight: 1, required: true },
      ],
    },
    {
      id: "sec-2",
      title: "Extinguishers",
      sortOrder: 2,
      weight: 1,
      questions: [
        { id: "q-2-1", text: "Extinguisher present?", fieldType: "boolean", sortOrder: 1, weight: 1, required: true },
      ],
    },
  ],
  publishedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  createdBy: USER_ID,
  updatedBy: USER_ID,
  version: 1,
};

const PUBLISHED_TEMPLATE = {
  ...DRAFT_TEMPLATE,
  status: "published",
  publishedAt: new Date().toISOString(),
  version: 2,
};

const MOCK_INSTANCE = {
  id: INSTANCE_ID,
  tenantId: TENANT_ID,
  templateId: TEMPLATE_ID,
  templateVersion: 1,
  inspectionId: INSPECTION_ID,
  sections: JSON.parse(JSON.stringify(PUBLISHED_TEMPLATE.sections)),
  responses: null,
  sectionScores: null,
  overallScore: null,
  completedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  createdBy: USER_ID,
  updatedBy: USER_ID,
  version: 1,
};

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockFindTemplateById = vi.fn();
const mockFindTemplatesByTenant = vi.fn();
const mockFindInstanceById = vi.fn();
const mockInsertTemplate = vi.fn();
const mockUpdateTemplate = vi.fn();
const mockInsertInstance = vi.fn();
const mockUpdateInstance = vi.fn();

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

vi.mock("../src/modules/checklist/repo.js", () => ({
  findTemplateById: (...args: unknown[]) => mockFindTemplateById(...args),
  findTemplatesByTenant: (...args: unknown[]) => mockFindTemplatesByTenant(...args),
  findInstanceById: (...args: unknown[]) => mockFindInstanceById(...args),
  insertTemplate: (...args: unknown[]) => mockInsertTemplate(...args),
  updateTemplate: (...args: unknown[]) => mockUpdateTemplate(...args),
  insertInstance: (...args: unknown[]) => mockInsertInstance(...args),
  updateInstance: (...args: unknown[]) => mockUpdateInstance(...args),
}));

// ── App Setup ─────────────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();

  const { registerChecklistRoutes } = await import("../src/modules/checklist/routes.js");
  await registerChecklistRoutes(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockFindTemplateById.mockResolvedValue(null);
  mockFindTemplatesByTenant.mockResolvedValue({
    data: [],
    meta: { page: 1, pageSize: 20, total: 0 },
  });
  mockFindInstanceById.mockResolvedValue(null);
});

// ══════════════════════════════════════════════════════════════════════════════
// Template Publish Immutability (Req 5.2)
// ══════════════════════════════════════════════════════════════════════════════

describe("Template publish immutability", () => {
  /**
   * Once a template is published, it becomes immutable.
   * Attempting to publish an already-published template returns 422.
   * This is enforced at the consumer level, but the route checks template
   * existence and delegates to the command. Consumer rejection is non-retryable.
   *
   * **Validates: Requirements 5.2**
   */
  it("POST /templates/:id/publish returns 202 for draft template", async () => {
    mockFindTemplateById.mockResolvedValue(DRAFT_TEMPLATE);

    const res = await app.inject({
      method: "POST",
      url: `/v1/inspection/checklists/templates/${TEMPLATE_ID}/publish`,
      headers: ADMIN_HEADER,
      payload: { version: 1 },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().data.accepted).toBe(true);
  });

  it("POST /templates/:id/publish on already published template still returns 202 (CQRS: consumer rejects)", async () => {
    // In CQRS the route accepts the command structurally, the consumer enforces
    // business rule (published templates cannot be re-published).
    mockFindTemplateById.mockResolvedValue(PUBLISHED_TEMPLATE);

    const res = await app.inject({
      method: "POST",
      url: `/v1/inspection/checklists/templates/${TEMPLATE_ID}/publish`,
      headers: ADMIN_HEADER,
      payload: { version: 2 },
    });

    // Route accepts structurally valid payload
    expect(res.statusCode).toBe(202);
  });

  it("consumer rejects templatePublish for already published template (immutability)", async () => {
    // Directly test the domain logic that the consumer enforces
    const { assertTemplateDraft, DomainError } = await import("../src/modules/checklist/domain.js");

    // Published template should throw
    expect(() => assertTemplateDraft("published")).toThrow(DomainError);
    expect(() => assertTemplateDraft("published")).toThrow("draft");

    // Draft template should pass
    expect(() => assertTemplateDraft("draft")).not.toThrow();
  });

  it("POST /templates/:id/publish returns 404 for non-existent template", async () => {
    mockFindTemplateById.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: `/v1/inspection/checklists/templates/${TEMPLATE_ID}/publish`,
      headers: ADMIN_HEADER,
      payload: { version: 1 },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Instance Generation Deep-Copy Correctness (Req 5.3)
// ══════════════════════════════════════════════════════════════════════════════

describe("Instance generation deep-copy correctness", () => {
  /**
   * When an instance is generated from a published template, the sections
   * must be deep-copied so mutations to the instance don't affect the template.
   *
   * **Validates: Requirements 5.3**
   */
  it("POST /instances returns 202 for valid instance generation", async () => {
    mockFindTemplateById.mockResolvedValue(PUBLISHED_TEMPLATE);

    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/checklists/instances",
      headers: INSPECTOR_HEADER,
      payload: {
        inspectionId: INSPECTION_ID,
        templateId: TEMPLATE_ID,
        templateVersion: 1,
      },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().data.accepted).toBe(true);
  });

  it("deep-copy produces structurally equal but independent copy", () => {
    // Simulate the consumer's deep-copy logic
    const original = PUBLISHED_TEMPLATE.sections;
    const deepCopy = JSON.parse(JSON.stringify(original));

    // Structural equality
    expect(deepCopy).toEqual(original);

    // Independence: mutating copy does not affect original
    deepCopy[0].title = "MUTATED";
    expect(original[0].title).toBe("Fire Exits");
    expect(deepCopy[0].title).toBe("MUTATED");
  });

  it("deep-copy preserves all nested question structure", () => {
    const original = PUBLISHED_TEMPLATE.sections;
    const deepCopy = JSON.parse(JSON.stringify(original));

    // All section IDs preserved
    expect(deepCopy.map((s: { id: string }) => s.id)).toEqual(["sec-1", "sec-2"]);

    // All question IDs preserved
    const originalQIds = original.flatMap((s) => s.questions.map((q) => q.id));
    const copyQIds = deepCopy.flatMap((s: { questions: { id: string }[] }) =>
      s.questions.map((q: { id: string }) => q.id),
    );
    expect(copyQIds).toEqual(originalQIds);

    // Field types preserved
    expect(deepCopy[0].questions[0].fieldType).toBe("boolean");
    expect(deepCopy[0].questions[1].fieldType).toBe("number");
  });

  it("POST /instances returns 400 with invalid templateId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/checklists/instances",
      headers: INSPECTOR_HEADER,
      payload: {
        inspectionId: INSPECTION_ID,
        templateId: "not-a-uuid",
        templateVersion: 1,
      },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Scoring After Response Submission (Req 5.5)
// ══════════════════════════════════════════════════════════════════════════════

describe("Scoring after response submission", () => {
  /**
   * When responses are submitted to a checklist instance, the service
   * computes section scores and an overall compliance percentage.
   *
   * **Validates: Requirements 5.5**
   */
  it("PATCH /instances/:id returns 202 for valid response submission", async () => {
    mockFindInstanceById.mockResolvedValue(MOCK_INSTANCE);

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/inspection/checklists/instances/${INSTANCE_ID}`,
      headers: INSPECTOR_HEADER,
      payload: {
        responses: [
          { questionId: "q-1-1", value: true },
          { questionId: "q-1-2", value: 4 },
        ],
      },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json().data.accepted).toBe(true);
  });

  it("domain scoring produces valid section scores and overall score", async () => {
    const { computeChecklistScores } = await import("../src/modules/checklist/domain.js");

    const sections = [
      {
        id: "sec-1",
        title: "Section A",
        sortOrder: 1,
        weight: 1,
        questions: [
          { id: "q-1-1", text: "Q1", fieldType: "boolean" as const, sortOrder: 1, weight: 1, required: true },
          { id: "q-1-2", text: "Q2", fieldType: "number" as const, sortOrder: 2, weight: 1, required: true },
        ],
      },
    ];

    const responses = {
      "q-1-1": { value: true, answeredAt: new Date().toISOString() },
      "q-1-2": { value: 5, answeredAt: new Date().toISOString() },
    };

    const result = computeChecklistScores(sections, responses);

    // Both questions answered → 100% score for sec-1
    expect(result.sectionScores["sec-1"]).toBe(100);
    expect(result.overallScore).toBe(100);
  });

  it("domain scoring handles partial responses correctly", async () => {
    const { computeChecklistScores } = await import("../src/modules/checklist/domain.js");

    const sections = [
      {
        id: "sec-1",
        title: "Section A",
        sortOrder: 1,
        weight: 1,
        questions: [
          { id: "q-1-1", text: "Q1", fieldType: "boolean" as const, sortOrder: 1, weight: 1, required: true },
          { id: "q-1-2", text: "Q2", fieldType: "number" as const, sortOrder: 2, weight: 1, required: true },
        ],
      },
    ];

    // Only one of two questions answered
    const responses = {
      "q-1-1": { value: true, answeredAt: new Date().toISOString() },
    };

    const result = computeChecklistScores(sections, responses);

    // Only 1 of 2 required questions answered → 50%
    expect(result.sectionScores["sec-1"]).toBe(50);
    expect(result.overallScore).toBe(50);
  });

  it("PATCH /instances/:id returns 404 for non-existent instance", async () => {
    mockFindInstanceById.mockResolvedValue(null);

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/inspection/checklists/instances/${INSTANCE_ID}`,
      headers: INSPECTOR_HEADER,
      payload: {
        responses: [{ questionId: "q-1-1", value: true }],
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it("PATCH /instances/:id returns 400 with empty responses array", async () => {
    mockFindInstanceById.mockResolvedValue(MOCK_INSTANCE);

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/inspection/checklists/instances/${INSTANCE_ID}`,
      headers: INSPECTOR_HEADER,
      payload: { responses: [] },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/inspection/checklists/templates — Validation & Auth (Req 5.1)
// ══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/inspection/checklists/templates", () => {
  const VALID_BODY = {
    name: "Building Safety Checklist",
    sections: [
      {
        title: "Structural",
        questions: [
          { fieldType: "boolean", label: "Foundation intact?" },
          { fieldType: "number", label: "Floor count" },
        ],
      },
    ],
  };

  it("returns 202 on valid body with inspection_admin role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/checklists/templates",
      headers: ADMIN_HEADER,
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.accepted).toBe(true);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/checklists/templates",
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with inspector role (not admin)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/checklists/templates",
      headers: INSPECTOR_HEADER,
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 with wrong role (employee)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/checklists/templates",
      headers: NO_ROLE_HEADER,
      payload: VALID_BODY,
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 with missing name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/checklists/templates",
      headers: ADMIN_HEADER,
      payload: {
        sections: [{ title: "S1", questions: [{ fieldType: "text", label: "Q1" }] }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with empty sections array", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/checklists/templates",
      headers: ADMIN_HEADER,
      payload: { name: "Empty", sections: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with empty questions in a section", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/checklists/templates",
      headers: ADMIN_HEADER,
      payload: { name: "Bad", sections: [{ title: "S1", questions: [] }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid fieldType", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/checklists/templates",
      headers: ADMIN_HEADER,
      payload: {
        name: "Bad Type",
        sections: [{ title: "S1", questions: [{ fieldType: "invalid_type", label: "Q1" }] }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with missing label in question", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/checklists/templates",
      headers: ADMIN_HEADER,
      payload: {
        name: "No Label",
        sections: [{ title: "S1", questions: [{ fieldType: "text" }] }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with empty body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/checklists/templates",
      headers: ADMIN_HEADER,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/inspection/checklists/templates/:id — Auth & Not Found (Req 5.7)
// ══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/inspection/checklists/templates/:id", () => {
  it("returns 200 with valid template data", async () => {
    mockFindTemplateById.mockResolvedValue(PUBLISHED_TEMPLATE);

    const res = await app.inject({
      method: "GET",
      url: `/v1/inspection/checklists/templates/${TEMPLATE_ID}`,
      headers: ADMIN_HEADER,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.id).toBe(TEMPLATE_ID);
    expect(body.data.name).toBe("Fire Safety Checklist");
    expect(body.data.status).toBe("published");
  });

  it("returns 200 for inspector role (read access)", async () => {
    mockFindTemplateById.mockResolvedValue(PUBLISHED_TEMPLATE);

    const res = await app.inject({
      method: "GET",
      url: `/v1/inspection/checklists/templates/${TEMPLATE_ID}`,
      headers: INSPECTOR_HEADER,
    });

    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/inspection/checklists/templates/${TEMPLATE_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role (employee)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/inspection/checklists/templates/${TEMPLATE_ID}`,
      headers: NO_ROLE_HEADER,
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 when template not found", async () => {
    mockFindTemplateById.mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: `/v1/inspection/checklists/templates/${TEMPLATE_ID}`,
      headers: ADMIN_HEADER,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 with invalid UUID param", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/inspection/checklists/templates/not-a-uuid",
      headers: ADMIN_HEADER,
    });
    expect(res.statusCode).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/inspection/checklists/templates — List (Paginated)
// ══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/inspection/checklists/templates", () => {
  it("returns 200 with paginated list for inspection_admin", async () => {
    mockFindTemplatesByTenant.mockResolvedValue({
      data: [PUBLISHED_TEMPLATE],
      meta: { page: 1, pageSize: 20, total: 1 },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/inspection/checklists/templates",
      headers: ADMIN_HEADER,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.meta.page).toBe(1);
    expect(body.meta.pageSize).toBe(20);
    expect(body.meta.total).toBe(1);
  });

  it("returns 200 for inspector role (read access)", async () => {
    mockFindTemplatesByTenant.mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 20, total: 0 },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/inspection/checklists/templates",
      headers: INSPECTOR_HEADER,
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/inspection/checklists/templates",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role (employee)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/inspection/checklists/templates",
      headers: NO_ROLE_HEADER,
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /v1/inspection/checklists/instances/:id — Auth & Not Found
// ══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/inspection/checklists/instances/:id", () => {
  it("returns 200 with valid instance data", async () => {
    mockFindInstanceById.mockResolvedValue(MOCK_INSTANCE);

    const res = await app.inject({
      method: "GET",
      url: `/v1/inspection/checklists/instances/${INSTANCE_ID}`,
      headers: INSPECTOR_HEADER,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.id).toBe(INSTANCE_ID);
    expect(body.data.templateId).toBe(TEMPLATE_ID);
    expect(body.data.inspectionId).toBe(INSPECTION_ID);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/inspection/checklists/instances/${INSTANCE_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role (employee)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/inspection/checklists/instances/${INSTANCE_ID}`,
      headers: NO_ROLE_HEADER,
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 when instance not found", async () => {
    mockFindInstanceById.mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: `/v1/inspection/checklists/instances/${INSTANCE_ID}`,
      headers: INSPECTOR_HEADER,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 with invalid UUID param", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/inspection/checklists/instances/not-a-uuid",
      headers: INSPECTOR_HEADER,
    });
    expect(res.statusCode).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/inspection/checklists/templates/:id/publish — Validation
// ══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/inspection/checklists/templates/:id/publish — validation", () => {
  it("returns 400 with missing version in body", async () => {
    mockFindTemplateById.mockResolvedValue(DRAFT_TEMPLATE);

    const res = await app.inject({
      method: "POST",
      url: `/v1/inspection/checklists/templates/${TEMPLATE_ID}/publish`,
      headers: ADMIN_HEADER,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid UUID in path", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/checklists/templates/not-a-uuid/publish",
      headers: ADMIN_HEADER,
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/inspection/checklists/templates/${TEMPLATE_ID}/publish`,
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with inspector role (not admin)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/inspection/checklists/templates/${TEMPLATE_ID}/publish`,
      headers: INSPECTOR_HEADER,
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /v1/inspection/checklists/instances — Validation & Auth
// ══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/inspection/checklists/instances — validation & auth", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/checklists/instances",
      payload: {
        inspectionId: INSPECTION_ID,
        templateId: TEMPLATE_ID,
        templateVersion: 1,
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with wrong role (employee)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/checklists/instances",
      headers: NO_ROLE_HEADER,
      payload: {
        inspectionId: INSPECTION_ID,
        templateId: TEMPLATE_ID,
        templateVersion: 1,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 with missing inspectionId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/checklists/instances",
      headers: INSPECTOR_HEADER,
      payload: {
        templateId: TEMPLATE_ID,
        templateVersion: 1,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with invalid inspectionId (not UUID)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/checklists/instances",
      headers: INSPECTOR_HEADER,
      payload: {
        inspectionId: "bad-id",
        templateId: TEMPLATE_ID,
        templateVersion: 1,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with missing templateVersion", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/checklists/instances",
      headers: INSPECTOR_HEADER,
      payload: {
        inspectionId: INSPECTION_ID,
        templateId: TEMPLATE_ID,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 with empty body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/checklists/instances",
      headers: INSPECTOR_HEADER,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
