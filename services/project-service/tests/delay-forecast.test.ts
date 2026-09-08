import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";

/**
 * Route-level integration tests for delay forecast route.
 *
 * DOM-001: the route used to run its Monte Carlo simulation over a
 * hardcoded array of 7 synthetic tasks ("task-1".."task-7") for EVERY
 * project and tenant — see the gap report entry DOM-001. The tests below
 * seed REAL rows into project.project_projects / project.project_tasks /
 * project.task_dependencies for several distinct projects and assert the
 * route's output tracks each project's own real data:
 *   - two real projects with different real task durations get different
 *     forecasts (the direct sabotage check — this fails immediately if the
 *     hardcoded task-1..7 array is restored, since both projects would then
 *     produce byte-identical output)
 *   - the counts sent to ml-service (completedTaskCount/totalTaskCount)
 *     match the REAL seeded counts, not the old fixed 5/7
 *   - no `task-<n>` synthetic ids ever appear in a response
 *   - a project with zero real tasks gets 422 INSUFFICIENT_DATA, never a
 *     fabricated fallback
 *
 * Also covers:
 * - GET /v1/projects/:projectId/delay-forecast → 200 (ML available)
 * - GET /v1/projects/:projectId/delay-forecast → 200 (fallback mode, < 5 completed tasks)
 * - GET /v1/projects/:projectId/delay-forecast → 200 (ML error → local computation)
 * - GET /v1/projects/:projectId/delay-forecast → 400 (invalid projectId)
 * - GET /v1/projects/:projectId/delay-forecast → 401 (no auth)
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";

// Unseeded — used only for the 400/401 checks, which never reach the DB.
const PROJECT_INVALID = "33333333-cccc-4000-8000-000000000001";

// Real seeded projects — distinct real task data per project.
const PROJECT_A = "33333333-cccc-4000-8000-0000000000aa"; // 6 completed + 2 incomplete (short durations)
const PROJECT_B = "33333333-cccc-4000-8000-0000000000bb"; // 5 completed + 1 incomplete (long durations)
const PROJECT_FALLBACK = "33333333-cccc-4000-8000-0000000000fa"; // 2 completed + 1 incomplete (< 5 completed)
const PROJECT_EMPTY = "33333333-cccc-4000-8000-0000000000ee"; // zero tasks

function token(roles: string[] = ["project_manager", "tenant_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-delay" }, SECRET, 3600);
}

function authHeaders() {
  return { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT };
}

function taskId(group: string, n: number): string {
  return `55555555-dddd-4000-8000-${group}${String(n).padStart(11, "0")}`;
}

/** Date-only 'YYYY-MM-DD' string, `offsetDays` from today (UTC). */
function dayOffset(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** How repo.ts turns a planned_end date column into baselineEndDate. */
function isoOfDayOffset(offsetDays: number): string {
  return new Date(dayOffset(offsetDays)).toISOString();
}

interface SeedTask {
  id: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  progressPct: number;
}

async function seedProject(input: {
  projectId: string;
  code: string;
  tasks: SeedTask[];
  deps?: Array<{ id: string; fromTaskId: string; toTaskId: string }>;
}): Promise<void> {
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
      INSERT INTO project.project_projects (id, tenant_id, code, name, status, created_by, updated_by)
      VALUES (${input.projectId}, ${TENANT}, ${input.code}, ${input.code}, 'active', ${ACTOR}, ${ACTOR})
    `;
    for (const t of input.tasks) {
      await sql`
        INSERT INTO project.project_tasks
          (id, project_id, tenant_id, name, status, planned_start, planned_end, actual_start, actual_end, progress_pct, created_by, updated_by)
        VALUES (${t.id}, ${input.projectId}, ${TENANT}, ${t.id}, ${t.status}, ${t.plannedStart}, ${t.plannedEnd}, ${t.actualStart}, ${t.actualEnd}, ${t.progressPct}, ${ACTOR}, ${ACTOR})
      `;
    }
    for (const d of input.deps ?? []) {
      await sql`
        INSERT INTO project.task_dependencies
          (id, tenant_id, project_id, from_task_id, to_task_id, dep_type, lag_ms, created_by, updated_by)
        VALUES (${d.id}, ${TENANT}, ${input.projectId}, ${d.fromTaskId}, ${d.toTaskId}, 'FS', 0, ${ACTOR}, ${ACTOR})
      `;
    }
  });
}

// ── Project A — short durations, 6 completed + 2 incomplete (total 8) ──
// Deliberately NOT 5 completed / 7 total (the old hardcoded stub's exact
// counts) so a reverted fix is caught even by a coincidental count match.
const PROJECT_A_TASKS: SeedTask[] = [
  { id: taskId("a", 1), status: "completed", plannedStart: dayOffset(-10), plannedEnd: dayOffset(-9), actualStart: dayOffset(-10), actualEnd: dayOffset(-9), progressPct: 100 },
  { id: taskId("a", 2), status: "completed", plannedStart: dayOffset(-9), plannedEnd: dayOffset(-7), actualStart: dayOffset(-9), actualEnd: dayOffset(-6), progressPct: 100 },
  { id: taskId("a", 3), status: "completed", plannedStart: dayOffset(-7), plannedEnd: dayOffset(-6), actualStart: dayOffset(-7), actualEnd: dayOffset(-6), progressPct: 100 },
  { id: taskId("a", 4), status: "completed", plannedStart: dayOffset(-6), plannedEnd: dayOffset(-4), actualStart: dayOffset(-6), actualEnd: dayOffset(-3), progressPct: 100 },
  { id: taskId("a", 5), status: "completed", plannedStart: dayOffset(-4), plannedEnd: dayOffset(-3), actualStart: dayOffset(-4), actualEnd: dayOffset(-3), progressPct: 100 },
  { id: taskId("a", 6), status: "completed", plannedStart: dayOffset(-3), plannedEnd: dayOffset(-1), actualStart: dayOffset(-3), actualEnd: dayOffset(-1), progressPct: 100 },
  { id: taskId("a", 7), status: "in_progress", plannedStart: dayOffset(1), plannedEnd: dayOffset(2), actualStart: null, actualEnd: null, progressPct: 40 },
  { id: taskId("a", 8), status: "in_progress", plannedStart: dayOffset(2), plannedEnd: dayOffset(4), actualStart: null, actualEnd: null, progressPct: 10 },
];

// ── Project B — much longer durations, 5 completed + 1 incomplete (total 6) ──
const PROJECT_B_TASKS: SeedTask[] = [
  { id: taskId("b", 1), status: "completed", plannedStart: dayOffset(-60), plannedEnd: dayOffset(-50), actualStart: dayOffset(-60), actualEnd: dayOffset(-48), progressPct: 100 },
  { id: taskId("b", 2), status: "completed", plannedStart: dayOffset(-50), plannedEnd: dayOffset(-35), actualStart: dayOffset(-50), actualEnd: dayOffset(-35), progressPct: 100 },
  { id: taskId("b", 3), status: "completed", plannedStart: dayOffset(-35), plannedEnd: dayOffset(-20), actualStart: dayOffset(-35), actualEnd: dayOffset(-18), progressPct: 100 },
  { id: taskId("b", 4), status: "completed", plannedStart: dayOffset(-20), plannedEnd: dayOffset(-10), actualStart: dayOffset(-20), actualEnd: dayOffset(-10), progressPct: 100 },
  { id: taskId("b", 5), status: "completed", plannedStart: dayOffset(-10), plannedEnd: dayOffset(-5), actualStart: dayOffset(-10), actualEnd: dayOffset(-5), progressPct: 100 },
  { id: taskId("b", 6), status: "in_progress", plannedStart: dayOffset(5), plannedEnd: dayOffset(40), actualStart: null, actualEnd: null, progressPct: 10 },
];

// ── Fallback project — only 2 completed (< MIN_COMPLETED_TASKS = 5) ──
const PROJECT_FALLBACK_TASKS: SeedTask[] = [
  { id: taskId("f", 1), status: "completed", plannedStart: dayOffset(-5), plannedEnd: dayOffset(-4), actualStart: dayOffset(-5), actualEnd: dayOffset(-4), progressPct: 100 },
  { id: taskId("f", 2), status: "completed", plannedStart: dayOffset(-4), plannedEnd: dayOffset(-2), actualStart: dayOffset(-4), actualEnd: dayOffset(-2), progressPct: 100 },
  { id: taskId("f", 3), status: "in_progress", plannedStart: dayOffset(20), plannedEnd: dayOffset(25), actualStart: null, actualEnd: null, progressPct: 0 },
];

beforeAll(async () => {
  // Clean up any leftover data from previous runs of this tenant, then seed
  // fresh, distinct real projects for the tests below.
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM project.task_dependencies WHERE tenant_id = ${TENANT}::uuid`;
    await sql`DELETE FROM project.project_tasks WHERE tenant_id = ${TENANT}::uuid`;
    await sql`DELETE FROM project.project_projects WHERE tenant_id = ${TENANT}::uuid`;
  });

  await seedProject({
    projectId: PROJECT_A,
    code: "DOM-001-PROJECT-A",
    tasks: PROJECT_A_TASKS,
    deps: [{ id: taskId("a", 900), fromTaskId: taskId("a", 6), toTaskId: taskId("a", 7) }],
  });
  await seedProject({ projectId: PROJECT_B, code: "DOM-001-PROJECT-B", tasks: PROJECT_B_TASKS });
  await seedProject({ projectId: PROJECT_FALLBACK, code: "DOM-001-PROJECT-FALLBACK", tasks: PROJECT_FALLBACK_TASKS });
  await seedProject({ projectId: PROJECT_EMPTY, code: "DOM-001-PROJECT-EMPTY", tasks: [] });
});

afterAll(async () => {
  await sqlClient.end();
});

describe("Delay forecast routes — real project data (DOM-001), local computation (ML disabled)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    vi.stubEnv("FEATURE_ML_ENABLED", "false");

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("GET /v1/projects/:projectId/delay-forecast returns 200 with forecast data for a real project", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_A}/delay-forecast`, headers: authHeaders() });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.data.p50Date).toBeDefined();
    expect(body.data.p80Date).toBeDefined();
    expect(body.data.p95Date).toBeDefined();
    expect(Array.isArray(body.data.taskRisks)).toBe(true);
    expect(Array.isArray(body.data.bottlenecks)).toBe(true);
    expect(body.data.isFallback).toBe(false);
  });

  it("never returns the old synthetic task-1..task-7 ids — only Project A's real task ids", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_A}/delay-forecast`, headers: authHeaders() });
    const body = res.json();

    const realIds = new Set(PROJECT_A_TASKS.map((t) => t.id));
    expect(body.data.taskRisks.length).toBeGreaterThan(0);
    for (const risk of body.data.taskRisks) {
      expect(risk.taskId).not.toMatch(/^task-\d$/);
      expect(realIds.has(risk.taskId)).toBe(true);
    }
  });

  it("returns valid ISO date strings for p50/p80/p95, ordered p50 <= p80 <= p95", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_A}/delay-forecast`, headers: authHeaders() });

    const body = res.json();
    expect(() => new Date(body.data.p50Date)).not.toThrow();
    const p50 = new Date(body.data.p50Date).getTime();
    const p80 = new Date(body.data.p80Date).getTime();
    const p95 = new Date(body.data.p95Date).getTime();
    expect(p50).toBeLessThanOrEqual(p80);
    expect(p80).toBeLessThanOrEqual(p95);
  });

  it("SABOTAGE CHECK: Project A and Project B — same tenant, different real task durations — produce DIFFERENT forecasts", async () => {
    const resA = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_A}/delay-forecast`, headers: authHeaders() });
    const resB = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_B}/delay-forecast`, headers: authHeaders() });

    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);
    const bodyA = resA.json();
    const bodyB = resB.json();

    // If the route still ran the simulation over the hardcoded task-1..7
    // array for every project, these would be byte-for-byte identical no
    // matter which project is queried. They must not be.
    expect(bodyA.data.p50Date).not.toBe(bodyB.data.p50Date);
    expect(bodyA.data.p95Date).not.toBe(bodyB.data.p95Date);

    // Project B's incomplete task spans 35 real days vs Project A's ~3 real
    // days combined, so B's forecast must land meaningfully later.
    expect(new Date(bodyB.data.p50Date).getTime()).toBeGreaterThan(new Date(bodyA.data.p50Date).getTime());
  });

  it("falls back to baseline dates for a project with < 5 completed tasks, using its OWN real max planned end date", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_FALLBACK}/delay-forecast`, headers: authHeaders() });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.isFallback).toBe(true);
    const expected = isoOfDayOffset(25); // PROJECT_FALLBACK_TASKS' latest planned_end (task f-3)
    expect(body.data.p50Date).toBe(expected);
    expect(body.data.p80Date).toBe(expected);
    expect(body.data.p95Date).toBe(expected);
  });

  it("returns 422 INSUFFICIENT_DATA for a project with zero real tasks — never a fabricated fallback", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_EMPTY}/delay-forecast`, headers: authHeaders() });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe("INSUFFICIENT_DATA");
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/projects/${PROJECT_INVALID}/delay-forecast`,
      headers: { "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for invalid UUID", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects/not-a-uuid/delay-forecast",
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Delay forecast routes — ML available (mocked)", () => {
  let app: FastifyInstance;
  let capturedRequestBody: { entityId?: string; features?: { completedTaskCount?: number; totalTaskCount?: number } } | undefined;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    vi.stubEnv("FEATURE_ML_ENABLED", "true");
    vi.stubEnv("ML_SERVICE_URL", "http://localhost:3032");

    capturedRequestBody = undefined;
    // Mock fetch to simulate ml-service delay forecast response, and to
    // capture the request body sent — this is what proves the route feeds
    // ml-service REAL counts, not the old hardcoded 5-completed/7-total.
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/v1/ml/predict")) {
        capturedRequestBody = JSON.parse((init?.body as string) ?? "{}");
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            p50Ms: 604800000,   // 7 days
            p80Ms: 864000000,   // 10 days
            p95Ms: 1296000000,  // 15 days
            taskRisks: [
              { taskId: taskId("a", 7), riskScore: 0.85, factors: ["SPI below target", "high resource utilization"] },
              { taskId: taskId("a", 8), riskScore: 0.45, factors: ["moderate dependency chain"] },
            ],
            bottlenecks: [],
            fallback: false,
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("not found") });
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("SABOTAGE CHECK: sends Project A's REAL completed/total task counts to ml-service, not the old hardcoded 5/7", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_A}/delay-forecast`, headers: authHeaders() });

    expect(res.statusCode).toBe(200);
    expect(capturedRequestBody?.entityId).toBe(PROJECT_A);
    // Project A: 6 completed of 8 total (PROJECT_A_TASKS above) — the old
    // hardcoded task-1..7 stub always sent completedTaskCount=5,
    // totalTaskCount=7 regardless of which project was queried.
    expect(capturedRequestBody?.features?.completedTaskCount).toBe(6);
    expect(capturedRequestBody?.features?.totalTaskCount).toBe(8);
  });

  it("returns ML prediction with task risks referencing Project A's real task ids", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_A}/delay-forecast`, headers: authHeaders() });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.isFallback).toBe(false);
    expect(body.data.taskRisks).toHaveLength(2);
    expect(body.data.taskRisks[0].taskId).toBe(taskId("a", 7));
  });

  it("returns ISO date strings converted from ms offsets, ordered p50 <= p80 <= p95", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_A}/delay-forecast`, headers: authHeaders() });

    const body = res.json();
    const p50 = new Date(body.data.p50Date).getTime();
    const p80 = new Date(body.data.p80Date).getTime();
    const p95 = new Date(body.data.p95Date).getTime();
    expect(p50).toBeLessThanOrEqual(p80);
    expect(p80).toBeLessThanOrEqual(p95);
  });
});

describe("Delay forecast routes — ML error (fallback on failure)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    vi.stubEnv("FEATURE_ML_ENABLED", "true");
    vi.stubEnv("ML_SERVICE_URL", "http://localhost:3032");

    // Mock fetch to simulate ml-service failure
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/v1/ml/predict")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve("internal server error"),
        });
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("not found") });
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("falls back to local computation over Project A's real tasks when ML returns error", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_A}/delay-forecast`, headers: authHeaders() });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // When ML fails but enough real tasks exist, it computes locally (not isFallback mode)
    expect(body.data.p50Date).toBeDefined();
    expect(body.data.p80Date).toBeDefined();
    expect(body.data.p95Date).toBeDefined();
    expect(Array.isArray(body.data.taskRisks)).toBe(true);
    for (const risk of body.data.taskRisks) {
      expect(risk.taskId).not.toMatch(/^task-\d$/);
    }
  });
});

describe("Delay forecast domain logic — risk score computation", () => {
  it("computeTaskRiskScores returns scores between 0 and 1", async () => {
    const { computeTaskRiskScores } = await import("../src/modules/delay-forecast/domain.js");

    const tasks = [
      { taskId: "t1", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "u1", isCriticalPath: true, spiHistory: [0.5, 0.5], resourceUtilization: 0.9, isCompleted: false, baselineEndDate: "2025-12-01T00:00:00Z" },
      { taskId: "t2", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: ["t1", "t3", "t4"], assignedTo: "u2", isCriticalPath: false, spiHistory: [1.0, 1.0], resourceUtilization: 0.3, isCompleted: false, baselineEndDate: "2025-12-05T00:00:00Z" },
    ];

    const risks = computeTaskRiskScores(tasks);
    for (const risk of risks) {
      expect(risk.riskScore).toBeGreaterThanOrEqual(0);
      expect(risk.riskScore).toBeLessThanOrEqual(1);
    }
  });

  it("high SPI deficit produces high risk score", async () => {
    const { computeTaskRiskScores } = await import("../src/modules/delay-forecast/domain.js");

    const tasks = [
      { taskId: "t1", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: ["d1", "d2", "d3", "d4", "d5"], assignedTo: "u1", isCriticalPath: true, spiHistory: [0.3, 0.2, 0.1], resourceUtilization: 0.95, isCompleted: false, baselineEndDate: "2025-12-01T00:00:00Z" },
    ];

    const risks = computeTaskRiskScores(tasks);
    expect(risks[0]!.riskScore).toBeGreaterThan(0.80);
    expect(risks[0]!.factors).toContain("SPI below target");
    expect(risks[0]!.factors).toContain("high resource utilization");
    expect(risks[0]!.factors).toContain("heavy dependency chain");
  });

  it("low risk features produce low risk score", async () => {
    const { computeTaskRiskScores } = await import("../src/modules/delay-forecast/domain.js");

    const tasks = [
      { taskId: "t1", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "u1", isCriticalPath: false, spiHistory: [1.2, 1.1, 1.0], resourceUtilization: 0.2, isCompleted: false, baselineEndDate: "2025-12-01T00:00:00Z" },
    ];

    const risks = computeTaskRiskScores(tasks);
    expect(risks[0]!.riskScore).toBeLessThan(0.40);
  });

  it("skips completed tasks in risk scoring", async () => {
    const { computeTaskRiskScores } = await import("../src/modules/delay-forecast/domain.js");

    const tasks = [
      { taskId: "t1", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "u1", isCriticalPath: true, spiHistory: [0.3], resourceUtilization: 0.9, isCompleted: true, baselineEndDate: "2025-12-01T00:00:00Z" },
      { taskId: "t2", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "u2", isCriticalPath: false, spiHistory: [1.0], resourceUtilization: 0.5, isCompleted: false, baselineEndDate: "2025-12-05T00:00:00Z" },
    ];

    const risks = computeTaskRiskScores(tasks);
    expect(risks).toHaveLength(1);
    expect(risks[0]!.taskId).toBe("t2");
  });
});

describe("Delay forecast domain logic — bottleneck detection", () => {
  it("identifies bottleneck when user has > 3 concurrent critical-path tasks", async () => {
    const { identifyBottlenecks } = await import("../src/modules/delay-forecast/domain.js");

    const tasks = [
      { taskId: "t1", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-overloaded", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: false },
      { taskId: "t2", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-overloaded", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: false },
      { taskId: "t3", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-overloaded", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: false },
      { taskId: "t4", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-overloaded", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: false },
      { taskId: "t5", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-normal", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: false },
    ];

    const bottlenecks = identifyBottlenecks(tasks);
    expect(bottlenecks).toHaveLength(1);
    expect(bottlenecks[0]!.userId).toBe("user-overloaded");
    expect(bottlenecks[0]!.concurrentCriticalTasks).toBe(4);
  });

  it("returns empty when no user exceeds threshold", async () => {
    const { identifyBottlenecks } = await import("../src/modules/delay-forecast/domain.js");

    const tasks = [
      { taskId: "t1", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-a", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: false },
      { taskId: "t2", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-b", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: false },
      { taskId: "t3", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-c", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: false },
    ];

    const bottlenecks = identifyBottlenecks(tasks);
    expect(bottlenecks).toHaveLength(0);
  });

  it("ignores completed tasks for bottleneck detection", async () => {
    const { identifyBottlenecks } = await import("../src/modules/delay-forecast/domain.js");

    const tasks = [
      { taskId: "t1", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-a", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: true },
      { taskId: "t2", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-a", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: true },
      { taskId: "t3", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-a", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: true },
      { taskId: "t4", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], assignedTo: "user-a", isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: true },
    ];

    const bottlenecks = identifyBottlenecks(tasks);
    expect(bottlenecks).toHaveLength(0);
  });
});

describe("Delay forecast domain logic — fallback mode", () => {
  it("hasEnoughHistory returns false when < 5 completed tasks", async () => {
    const { hasEnoughHistory } = await import("../src/modules/delay-forecast/domain.js");

    const tasks = [
      { taskId: "t1", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], isCriticalPath: false, spiHistory: [], resourceUtilization: 0.5, isCompleted: true },
      { taskId: "t2", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], isCriticalPath: false, spiHistory: [], resourceUtilization: 0.5, isCompleted: true },
      { taskId: "t3", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], isCriticalPath: false, spiHistory: [], resourceUtilization: 0.5, isCompleted: false },
    ];

    expect(hasEnoughHistory(tasks)).toBe(false);
  });

  it("hasEnoughHistory returns true when >= 5 completed tasks", async () => {
    const { hasEnoughHistory } = await import("../src/modules/delay-forecast/domain.js");

    const tasks = Array.from({ length: 5 }, (_, i) => ({
      taskId: `t${i + 1}`,
      baselineDurationMs: 86400000,
      varianceMs: 14400000,
      dependencies: [],
      isCriticalPath: false,
      spiHistory: [],
      resourceUtilization: 0.5,
      isCompleted: true,
    }));

    expect(hasEnoughHistory(tasks)).toBe(true);
  });

  it("computeFallbackForecast returns isFallback=true with baseline dates", async () => {
    const { computeFallbackForecast } = await import("../src/modules/delay-forecast/domain.js");

    const futureDate = new Date(Date.now() + 86400000 * 30).toISOString();
    const tasks = [
      { taskId: "t1", baselineDurationMs: 86400000, varianceMs: 14400000, dependencies: [], isCriticalPath: true, spiHistory: [], resourceUtilization: 0.5, isCompleted: false, baselineEndDate: futureDate },
    ];

    const result = computeFallbackForecast(tasks);
    expect(result.isFallback).toBe(true);
    expect(result.p50Date).toBe(futureDate);
    expect(result.p80Date).toBe(futureDate);
    expect(result.p95Date).toBe(futureDate);
    expect(result.taskRisks).toHaveLength(0);
    expect(result.bottlenecks).toHaveLength(0);
  });
});

describe("Delay forecast domain logic — msToIsoDate", () => {
  it("converts milliseconds offset to ISO date string", async () => {
    const { msToIsoDate } = await import("../src/modules/delay-forecast/domain.js");

    const start = new Date("2025-01-01T00:00:00.000Z");
    const result = msToIsoDate(86400000, start); // 1 day
    expect(result).toBe("2025-01-02T00:00:00.000Z");
  });

  it("handles bigint input", async () => {
    const { msToIsoDate } = await import("../src/modules/delay-forecast/domain.js");

    const start = new Date("2025-01-01T00:00:00.000Z");
    const result = msToIsoDate(BigInt(172800000), start); // 2 days
    expect(result).toBe("2025-01-03T00:00:00.000Z");
  });

  it("uses current date as default start", async () => {
    const { msToIsoDate } = await import("../src/modules/delay-forecast/domain.js");

    const before = Date.now();
    const result = msToIsoDate(0);
    const after = Date.now();
    const resultTime = new Date(result).getTime();
    expect(resultTime).toBeGreaterThanOrEqual(before);
    expect(resultTime).toBeLessThanOrEqual(after);
  });
});
