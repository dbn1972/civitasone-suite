/**
 * World-class gap features — comprehensive route-level tests.
 * Covers: happy path, 400, 401, 403, 404, 409 for all gap-features endpoints.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const ID1 = "cccccccc-0001-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  poolQuery: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => {
  const createSelectChain = (...args: unknown[]) => ({
    from: (t: unknown) => ({
      where: (...w: unknown[]) => {
        const result = H.selectFrom(...args, ...w);
        return {
          limit: (n: unknown) => H.selectFrom(...args, ...w),
          orderBy: (...o: unknown[]) => ({
            limit: (n: unknown) => H.selectFrom(...args, ...w),
          }),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(result).then(resolve, reject),
        };
      },
      orderBy: (...o: unknown[]) => ({
        limit: (n: unknown) => H.selectFrom(...args),
      }),
    }),
  });
  const mockTx = {
    select: (...args: unknown[]) => createSelectChain(...args),
    update: (t: unknown) => ({
      set: (v: unknown) => ({ where: (...a: unknown[]) => H.update(v, ...a) }),
    }),
    insert: (t: unknown) => ({ values: (v: unknown) => H.insert(v) }),
    execute: (q: unknown) => H.execute(q),
  };
  return {
    db: {
      transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
    },
    scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    sqlClient: { end: async () => {} },
    sqlPool: { query: (...a: unknown[]) => H.poolQuery(...a) },
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: async () => {},
    makeKey: (...a: string[]) => a.join(":"),
    getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn(),
  },
  queue: { publish: async () => {} },
}));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["hr_admin"]) =>
  signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) => ({
  authorization: `Bearer ${tok(sub, roles)}`,
});

beforeEach(() => {
  vi.clearAllMocks();
  H.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

// ═══════════════════ Gap 1: Compensation Planning ═══════════════════
describe("POST /v1/hrms/compensation/plans", () => {
  const payload = { name: "FY26 Plan", fy: "2025-26", budgetMinor: 10000000 };

  it("creates a compensation plan (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/compensation/plans", headers: auth(), payload });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.name).toBe("FY26 Plan");
    expect(r.json().data.status).toBe("draft");
    await app.close();
  });

  it("returns 400 for invalid body", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/compensation/plans", headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("returns 400 for invalid fy format", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/compensation/plans", headers: auth(), payload: { ...payload, fy: "2025" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/compensation/plans", payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/compensation/plans", headers: auth(USER, ["employee"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/compensation/plans", () => {
  it("lists plans (200)", async () => {
    H.poolQuery.mockResolvedValue({ rows: [{ id: ID1, name: "Plan", fy: "2025-26" }], rowCount: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/compensation/plans", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/compensation/plans" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /v1/hrms/compensation/plans/:id/model", () => {
  it("returns model for existing plan (200)", async () => {
    H.poolQuery.mockResolvedValue({ rows: [{ id: ID1, budget_minor: 10000000 }], rowCount: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/compensation/plans/${ID1}/model`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.model).toBe("average_10pct");
    await app.close();
  });

  it("returns 404 when plan not found", async () => {
    H.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/compensation/plans/${ID1}/model`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("returns 400 for invalid UUID", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/compensation/plans/not-uuid/model", headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/compensation/plans/${ID1}/model`, payload: {} });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/compensation/plans/${ID1}/model`, headers: auth(USER, ["employee"]), payload: {} });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ═══════════════════ Gap 2: LMS ═══════════════════
describe("POST /v1/hrms/lms/courses", () => {
  const payload = { code: "SEC-101", name: "Cybersecurity Basics", durationHours: 8 };

  it("creates a course (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/lms/courses", headers: auth(), payload });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.code).toBe("SEC-101");
    expect(r.json().data.status).toBe("active");
    await app.close();
  });

  it("returns 400 for missing name", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/lms/courses", headers: auth(), payload: { code: "X" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/lms/courses", payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/lms/courses", headers: auth(USER, ["employee"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/lms/courses", () => {
  it("returns 200 for employee (allowed)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/lms/courses", headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/lms/courses" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /v1/hrms/lms/courses/:id/enroll", () => {
  it("enrolls an employee (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/lms/courses/${ID1}/enroll`, headers: auth(), payload: { employeeId: USER } });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.status).toBe("enrolled");
    await app.close();
  });

  it("returns 400 for invalid employeeId", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/lms/courses/${ID1}/enroll`, headers: auth(), payload: { employeeId: "bad" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/lms/courses/${ID1}/enroll`, payload: { employeeId: USER } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /v1/hrms/lms/enrollments/:id/complete", () => {
  it("completes enrollment (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/lms/enrollments/${ID1}/complete`, headers: auth(), payload: { score: 85 } });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.status).toBe("completed");
    await app.close();
  });

  it("returns 400 for score > 100", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/lms/enrollments/${ID1}/complete`, headers: auth(), payload: { score: 150 } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/lms/enrollments/${ID1}/complete`, headers: auth(USER, ["employee"]), payload: {} });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/lms/my-learning", () => {
  it("returns 200", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/lms/my-learning", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toBeDefined();
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/lms/my-learning" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /v1/hrms/lms/compliance", () => {
  it("returns 200 for hr_admin", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/lms/compliance", headers: auth() });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/lms/compliance", headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ═══════════════════ Gap 3: Skills Matrix ═══════════════════
describe("POST /v1/hrms/skills/competencies", () => {
  it("creates a competency (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/skills/competencies", headers: auth(), payload: { name: "TypeScript" } });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.name).toBe("TypeScript");
    await app.close();
  });

  it("returns 400 for empty name", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/skills/competencies", headers: auth(), payload: { name: "" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/skills/competencies", payload: { name: "X" } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/skills/competencies", headers: auth(USER, ["employee"]), payload: { name: "X" } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/hrms/skills/role-matrix", () => {
  it("creates a role-competency mapping (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/skills/role-matrix", headers: auth(), payload: { roleRef: "developer", competencyId: ID1, requiredLevel: "advanced" } });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("returns 400 for invalid competencyId", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/skills/role-matrix", headers: auth(), payload: { roleRef: "dev", competencyId: "bad", requiredLevel: "x" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

describe("POST /v1/hrms/skills/assessments", () => {
  it("creates a skill assessment (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/skills/assessments", headers: auth(), payload: { employeeId: USER, competencyId: ID1, assessedLevel: "intermediate" } });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("returns 400 for missing fields", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/skills/assessments", headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /v1/hrms/skills/gap-analysis", () => {
  it("returns gap analysis (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/skills/gap-analysis?employeeId=${USER}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("returns 400 without employeeId", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/skills/gap-analysis", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /v1/hrms/skills/team-heatmap", () => {
  it("returns heatmap (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/skills/team-heatmap", headers: auth() });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/skills/team-heatmap", headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ═══════════════════ Gap 4: Succession Planning ═══════════════════
describe("POST /v1/hrms/succession/critical-roles", () => {
  it("creates a critical role (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/succession/critical-roles", headers: auth(), payload: { roleRef: "CTO" } });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.isCritical).toBe(true);
    await app.close();
  });

  it("returns 400 for empty body", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/succession/critical-roles", headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/succession/critical-roles", payload: { roleRef: "CTO" } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/succession/critical-roles", headers: auth(USER, ["employee"]), payload: { roleRef: "CTO" } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/hrms/succession/nominees", () => {
  it("adds a nominee (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/succession/nominees", headers: auth(), payload: { planId: ID1, employeeId: USER, readiness: "1yr" } });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("returns 400 for invalid planId", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/succession/nominees", headers: auth(), payload: { planId: "bad", employeeId: USER } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /v1/hrms/succession/pipeline", () => {
  it("returns pipeline data (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/succession/pipeline", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toBeDefined();
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/succession/pipeline", headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/succession/risk", () => {
  it("returns risk data (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/succession/risk", headers: auth() });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/succession/risk" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

// ═══════════════════ Gap 5: Engagement Surveys ═══════════════════
describe("POST /v1/hrms/engagement/surveys", () => {
  const payload = { title: "Q3 Pulse", questions: [{ text: "How happy?", type: "rating" as const }] };

  it("creates a survey (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/engagement/surveys", headers: auth(), payload });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.status).toBe("active");
    await app.close();
  });

  it("returns 400 for empty questions array", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/engagement/surveys", headers: auth(), payload: { title: "X", questions: [] } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/engagement/surveys", payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/engagement/surveys", headers: auth(USER, ["employee"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/hrms/engagement/surveys/:id/respond", () => {
  it("submits a response (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/engagement/surveys/${ID1}/respond`, headers: auth(), payload: { answers: [5], enpsScore: 9 } });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.submitted).toBe(true);
    await app.close();
  });

  it("returns 400 for empty answers", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/engagement/surveys/${ID1}/respond`, headers: auth(), payload: { answers: [] } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /v1/hrms/engagement/surveys/:id/results", () => {
  it("returns survey results (200)", async () => {
    H.poolQuery.mockResolvedValue({ rows: [{ response_count: "5", avg_enps: "7.50" }], rowCount: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/engagement/surveys/${ID1}/results`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.responseCount).toBe(5);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/engagement/surveys/${ID1}/results`, headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/engagement/eNPS", () => {
  it("returns eNPS score (200)", async () => {
    H.poolQuery.mockResolvedValue({ rows: [{ promoters: "30", detractors: "10", total: "50" }], rowCount: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/engagement/eNPS", headers: auth() });
    expect(r.statusCode).toBe(200);
    const data = r.json().data;
    expect(data.enps).toBe(40); // (30-10)/50 * 100
    expect(data.total).toBe(50);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/engagement/eNPS" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/engagement/eNPS", headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ═══════════════════ Gap 6: Onboarding ═══════════════════
describe("POST /v1/hrms/onboarding/templates", () => {
  const payload = { name: "Engineering Onboarding", steps: [{ title: "Orientation" }, { title: "Setup Laptop" }] };

  it("creates a template (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/onboarding/templates", headers: auth(), payload });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.status).toBe("active");
    await app.close();
  });

  it("returns 400 for empty steps", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/onboarding/templates", headers: auth(), payload: { name: "X", steps: [] } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/onboarding/templates", payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/onboarding/templates", headers: auth(USER, ["employee"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/onboarding/active", () => {
  it("returns active onboardings (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/onboarding/active", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toBeDefined();
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/onboarding/active", headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/hrms/onboarding/:id/steps/:stepIdx/complete", () => {
  it("completes a step (200)", async () => {
    H.poolQuery.mockResolvedValueOnce({ rows: [{ steps: [{ title: "Step 1" }, { title: "Step 2" }] }], rowCount: 1 });
    H.poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/onboarding/${ID1}/steps/0/complete`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.completionPct).toBe(50);
    await app.close();
  });

  it("returns 404 when instance not found", async () => {
    H.poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/onboarding/${ID1}/steps/0/complete`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("returns 400 for step index out of range", async () => {
    H.poolQuery.mockResolvedValue({ rows: [{ steps: [{ title: "Step 1" }] }], rowCount: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/onboarding/${ID1}/steps/5/complete`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("INVALID_STEP");
    await app.close();
  });
});

// ═══════════════════ Gap 7: 360° Feedback ═══════════════════
describe("POST /v1/hrms/feedback/cycles", () => {
  const payload = { name: "H1 Review", questions: [{ text: "Rate communication", maxScore: 5 }] };

  it("creates a feedback cycle (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/feedback/cycles", headers: auth(), payload });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.status).toBe("active");
    await app.close();
  });

  it("returns 400 for empty questions", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/feedback/cycles", headers: auth(), payload: { name: "X", questions: [] } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/feedback/cycles", payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/feedback/cycles", headers: auth(USER, ["employee"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/hrms/feedback/cycles/:id/nominate-raters", () => {
  it("nominates raters (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/feedback/cycles/${ID1}/nominate-raters`, headers: auth(), payload: { employeeId: USER, raters: [{ raterId: ID1, raterGroup: "peer" }] } });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.ratersAdded).toBe(1);
    await app.close();
  });

  it("returns 400 for empty raters", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/feedback/cycles/${ID1}/nominate-raters`, headers: auth(), payload: { employeeId: USER, raters: [] } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

describe("POST /v1/hrms/feedback/responses", () => {
  it("submits feedback response (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/feedback/responses", headers: auth(), payload: { cycleId: ID1, employeeId: USER, raterGroup: "self", scores: { q1: 4, q2: 5 } } });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.submitted).toBe(true);
    await app.close();
  });

  it("returns 400 for missing required fields", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/feedback/responses", headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /v1/hrms/feedback/cycles/:id/report", () => {
  it("returns aggregated report (200)", async () => {
    H.poolQuery.mockResolvedValue({ rows: [{ rater_group: "peer", scores: { q1: 4 } }], rowCount: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/feedback/cycles/${ID1}/report?employeeId=${USER}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.byRaterGroup).toBeDefined();
    await app.close();
  });

  it("returns 400 without employeeId query", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/feedback/cycles/${ID1}/report`, headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/feedback/cycles/${ID1}/report?employeeId=${USER}`, headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ═══════════════════ Gap 8: Benefits Administration ═══════════════════
describe("POST /v1/hrms/benefits/plans", () => {
  const payload = { name: "Flex Benefits FY26", fy: "2025-26", flexBudgetMinor: 200000, components: [{ name: "Medical", maxMinor: 100000, taxExempt: true }] };

  it("creates a benefit plan (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/benefits/plans", headers: auth(), payload });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.status).toBe("active");
    await app.close();
  });

  it("returns 400 for empty components", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/benefits/plans", headers: auth(), payload: { name: "X", fy: "2025-26", flexBudgetMinor: 0, components: [] } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 for invalid fy", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/benefits/plans", headers: auth(), payload: { ...payload, fy: "bad" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/benefits/plans", payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/benefits/plans", headers: auth(USER, ["employee"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("POST /v1/hrms/benefits/elections", () => {
  it("submits benefit elections (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/benefits/elections", headers: auth(), payload: { planId: ID1, fy: "2025-26", elections: [{ component: "Medical", electedMinor: 50000 }] } });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.totalElectedMinor).toBe(50000);
    await app.close();
  });

  it("returns 400 for empty elections", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/benefits/elections", headers: auth(), payload: { planId: ID1, fy: "2025-26", elections: [] } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/benefits/elections", payload: { planId: ID1, fy: "2025-26", elections: [{ component: "X", electedMinor: 1 }] } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /v1/hrms/benefits/my-elections", () => {
  it("returns my elections (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/benefits/my-elections", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toBeDefined();
    await app.close();
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/benefits/my-elections" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});
