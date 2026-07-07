/**
 * WBS Hierarchy Rollup & Delay Analysis — tests.
 *
 * Tests cover:
 * - Domain logic: rollup computation (duration sum, cost sum, weighted completion %)
 * - Domain logic: delay analysis (variance in ms, critical-path flag)
 * - Domain logic: max 10 levels validation
 * - Route-level: happy path, validation errors, auth
 */
import { describe, it, expect } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import {
  rollupWbs,
  analyzeDelays,
  validateWbsDepth,
  computeDepths,
  MAX_WBS_DEPTH,
} from "../src/modules/scheduling/wbs.js";
import type { WbsNode, DelayAnalysisInput } from "../src/modules/scheduling/wbs.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-000000000033";
const PROJECT_ID = "bbbbbbbb-0000-4000-8000-000000000010";

function makeToken(roles: string[] = ["project_manager"]) {
  return signToken({ sub: "eeeeeeee-0000-4000-8000-000000000001", tid: TENANT, roles, sid: "sess-wbs" }, SECRET);
}

function uuid(n: number): string {
  return `cccccccc-0b50-4000-8000-${String(n).padStart(12, "0")}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Domain unit tests — rollupWbs
// ═══════════════════════════════════════════════════════════════════════════════

describe("rollupWbs — domain logic", () => {
  it("returns leaf node values unchanged", () => {
    const nodes: WbsNode[] = [
      { id: uuid(1), parentId: null, durationMs: 100n, costPaise: 5000n, completionPct: 50, weightPct: 1 },
    ];
    const results = rollupWbs(nodes)!;
    expect(results).toHaveLength(1);
    expect(results[0]!.durationMs).toBe(100n);
    expect(results[0]!.costPaise).toBe(5000n);
    expect(results[0]!.completionPct).toBe(50);
    expect(results[0]!.depth).toBe(0);
  });

  it("rolls up duration as sum of children", () => {
    const nodes: WbsNode[] = [
      { id: uuid(1), parentId: null, durationMs: 0n, costPaise: 0n, completionPct: 0, weightPct: 1 },
      { id: uuid(2), parentId: uuid(1), durationMs: 100n, costPaise: 1000n, completionPct: 50, weightPct: 1 },
      { id: uuid(3), parentId: uuid(1), durationMs: 200n, costPaise: 2000n, completionPct: 80, weightPct: 1 },
    ];
    const results = rollupWbs(nodes)!;
    const parent = results.find((r) => r.id === uuid(1))!;
    expect(parent.durationMs).toBe(300n); // 100 + 200
    expect(parent.costPaise).toBe(3000n); // 1000 + 2000
  });

  it("computes weighted average completion percentage", () => {
    const nodes: WbsNode[] = [
      { id: uuid(1), parentId: null, durationMs: 0n, costPaise: 0n, completionPct: 0, weightPct: 1 },
      { id: uuid(2), parentId: uuid(1), durationMs: 100n, costPaise: 1000n, completionPct: 40, weightPct: 3 },
      { id: uuid(3), parentId: uuid(1), durationMs: 200n, costPaise: 2000n, completionPct: 80, weightPct: 1 },
    ];
    const results = rollupWbs(nodes)!;
    const parent = results.find((r) => r.id === uuid(1))!;
    // Weighted avg: (40*3 + 80*1) / (3+1) = (120+80)/4 = 50
    expect(parent.completionPct).toBe(50);
  });

  it("handles multi-level hierarchy (3 levels)", () => {
    const nodes: WbsNode[] = [
      { id: uuid(1), parentId: null, durationMs: 0n, costPaise: 0n, completionPct: 0, weightPct: 1 },
      { id: uuid(2), parentId: uuid(1), durationMs: 0n, costPaise: 0n, completionPct: 0, weightPct: 1 },
      { id: uuid(3), parentId: uuid(2), durationMs: 50n, costPaise: 500n, completionPct: 100, weightPct: 1 },
      { id: uuid(4), parentId: uuid(2), durationMs: 150n, costPaise: 1500n, completionPct: 60, weightPct: 1 },
      { id: uuid(5), parentId: uuid(1), durationMs: 300n, costPaise: 3000n, completionPct: 20, weightPct: 1 },
    ];
    const results = rollupWbs(nodes)!;

    // uuid(2) rolls up from uuid(3) and uuid(4)
    const mid = results.find((r) => r.id === uuid(2))!;
    expect(mid.durationMs).toBe(200n); // 50+150
    expect(mid.costPaise).toBe(2000n); // 500+1500
    expect(mid.completionPct).toBe(80); // (100*1 + 60*1) / 2 = 80

    // uuid(1) rolls up from mid(200ms,2000p,80%) and uuid(5)(300ms,3000p,20%)
    const root = results.find((r) => r.id === uuid(1))!;
    expect(root.durationMs).toBe(500n); // 200+300
    expect(root.costPaise).toBe(5000n); // 2000+3000
    expect(root.completionPct).toBe(50); // (80*1 + 20*1) / 2 = 50
  });

  it("returns null when exceeding max depth (10 levels)", () => {
    // Build a chain of 11 levels (exceeds max of 10)
    const nodes: WbsNode[] = [];
    for (let i = 0; i <= 10; i++) {
      nodes.push({
        id: uuid(i + 100),
        parentId: i === 0 ? null : uuid(i + 99),
        durationMs: 10n,
        costPaise: 100n,
        completionPct: 50,
        weightPct: 1,
      });
    }
    const result = rollupWbs(nodes);
    expect(result).toBeNull();
  });

  it("handles empty array", () => {
    const results = rollupWbs([]);
    expect(results).toEqual([]);
  });

  it("handles zero weights gracefully (returns 0% completion)", () => {
    const nodes: WbsNode[] = [
      { id: uuid(1), parentId: null, durationMs: 0n, costPaise: 0n, completionPct: 0, weightPct: 1 },
      { id: uuid(2), parentId: uuid(1), durationMs: 100n, costPaise: 1000n, completionPct: 50, weightPct: 0 },
      { id: uuid(3), parentId: uuid(1), durationMs: 200n, costPaise: 2000n, completionPct: 80, weightPct: 0 },
    ];
    const results = rollupWbs(nodes)!;
    const parent = results.find((r) => r.id === uuid(1))!;
    expect(parent.completionPct).toBe(0); // all weights are 0
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Domain unit tests — analyzeDelays
// ═══════════════════════════════════════════════════════════════════════════════

describe("analyzeDelays — domain logic", () => {
  it("identifies delayed tasks with positive variance", () => {
    const inputs: DelayAnalysisInput[] = [
      {
        taskId: uuid(1),
        actualStartMs: 1000n,
        actualEndMs: 5000n,
        baselineStartMs: 500n,
        baselineEndMs: 4000n,
        onCriticalPath: true,
      },
    ];
    const results = analyzeDelays(inputs);
    expect(results).toHaveLength(1);
    expect(results[0]!.taskId).toBe(uuid(1));
    expect(results[0]!.startVarianceMs).toBe(500n); // 1000 - 500
    expect(results[0]!.endVarianceMs).toBe(1000n); // 5000 - 4000
    expect(results[0]!.onCriticalPath).toBe(true);
  });

  it("excludes tasks with no delay (on schedule or early)", () => {
    const inputs: DelayAnalysisInput[] = [
      {
        taskId: uuid(1),
        actualStartMs: 500n,
        actualEndMs: 4000n,
        baselineStartMs: 500n,
        baselineEndMs: 4000n,
        onCriticalPath: false,
      },
      {
        taskId: uuid(2),
        actualStartMs: 400n, // early
        actualEndMs: 3500n,  // early
        baselineStartMs: 500n,
        baselineEndMs: 4000n,
        onCriticalPath: false,
      },
    ];
    const results = analyzeDelays(inputs);
    expect(results).toHaveLength(0);
  });

  it("handles null actual dates (treats as 0 variance)", () => {
    const inputs: DelayAnalysisInput[] = [
      {
        taskId: uuid(1),
        actualStartMs: null,
        actualEndMs: null,
        baselineStartMs: 500n,
        baselineEndMs: 4000n,
        onCriticalPath: false,
      },
    ];
    const results = analyzeDelays(inputs);
    expect(results).toHaveLength(0); // no delay when actual is null
  });

  it("reports only start delay when end is on schedule", () => {
    const inputs: DelayAnalysisInput[] = [
      {
        taskId: uuid(1),
        actualStartMs: 1000n,
        actualEndMs: 4000n, // same as baseline
        baselineStartMs: 500n,
        baselineEndMs: 4000n,
        onCriticalPath: false,
      },
    ];
    const results = analyzeDelays(inputs);
    expect(results).toHaveLength(1);
    expect(results[0]!.startVarianceMs).toBe(500n);
    expect(results[0]!.endVarianceMs).toBe(0n);
  });

  it("correctly flags critical path membership", () => {
    const inputs: DelayAnalysisInput[] = [
      {
        taskId: uuid(1),
        actualStartMs: 2000n,
        actualEndMs: 6000n,
        baselineStartMs: 1000n,
        baselineEndMs: 5000n,
        onCriticalPath: true,
      },
      {
        taskId: uuid(2),
        actualStartMs: 2000n,
        actualEndMs: 6000n,
        baselineStartMs: 1000n,
        baselineEndMs: 5000n,
        onCriticalPath: false,
      },
    ];
    const results = analyzeDelays(inputs);
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.taskId === uuid(1))!.onCriticalPath).toBe(true);
    expect(results.find((r) => r.taskId === uuid(2))!.onCriticalPath).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Domain unit tests — validateWbsDepth / computeDepths
// ═══════════════════════════════════════════════════════════════════════════════

describe("validateWbsDepth", () => {
  it("accepts hierarchy with exactly 10 levels (depth 0-9)", () => {
    const nodes: WbsNode[] = [];
    for (let i = 0; i < 10; i++) {
      nodes.push({
        id: uuid(i + 200),
        parentId: i === 0 ? null : uuid(i + 199),
        durationMs: 10n,
        costPaise: 100n,
        completionPct: 50,
        weightPct: 1,
      });
    }
    expect(validateWbsDepth(nodes)).toBe(true);
  });

  it("rejects hierarchy with 11 levels", () => {
    const nodes: WbsNode[] = [];
    for (let i = 0; i <= 10; i++) {
      nodes.push({
        id: uuid(i + 300),
        parentId: i === 0 ? null : uuid(i + 299),
        durationMs: 10n,
        costPaise: 100n,
        completionPct: 50,
        weightPct: 1,
      });
    }
    expect(validateWbsDepth(nodes)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Route-level integration tests — WBS rollup
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/projects/:projectId/wbs/rollup", () => {
  it("returns 200 with rolled-up values for a simple hierarchy", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/wbs/rollup`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        nodes: [
          { id: uuid(1), parentId: null, durationMs: "0", costPaise: "0", completionPct: 0, weightPct: 1 },
          { id: uuid(2), parentId: uuid(1), durationMs: "100", costPaise: "1000", completionPct: 40, weightPct: 3 },
          { id: uuid(3), parentId: uuid(1), durationMs: "200", costPaise: "2000", completionPct: 80, weightPct: 1 },
        ],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    const parent = body.data.find((r: { id: string }) => r.id === uuid(1));
    expect(parent.durationMs).toBe("300"); // 100 + 200
    expect(parent.costPaise).toBe("3000"); // 1000 + 2000
    expect(parent.completionPct).toBe(50); // (40*3 + 80*1) / 4
  });

  it("returns 422 when hierarchy exceeds max depth", async () => {
    const app = await buildApp();
    // Build 11-level chain
    const nodes = [];
    for (let i = 0; i <= 10; i++) {
      nodes.push({
        id: uuid(i + 400),
        parentId: i === 0 ? null : uuid(i + 399),
        durationMs: "10",
        costPaise: "100",
        completionPct: 50,
        weightPct: 1,
      });
    }
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/wbs/rollup`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { nodes },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("MAX_WBS_DEPTH_EXCEEDED");
  });

  it("returns 400 for invalid body (missing nodes)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/wbs/rollup`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { nodes: [] },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/wbs/rollup`,
      payload: { nodes: [{ id: uuid(1), parentId: null, durationMs: "10", costPaise: "100", completionPct: 50, weightPct: 1 }] },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/wbs/rollup`,
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
      payload: { nodes: [{ id: uuid(1), parentId: null, durationMs: "10", costPaise: "100", completionPct: 50, weightPct: 1 }] },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Route-level integration tests — Delay analysis
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/projects/:projectId/wbs/delay-analysis", () => {
  it("returns delayed tasks with variance in ms and critical-path flag", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/wbs/delay-analysis`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        tasks: [
          {
            taskId: uuid(1),
            actualStartMs: "2000",
            actualEndMs: "6000",
            baselineStartMs: "1000",
            baselineEndMs: "5000",
            onCriticalPath: true,
          },
          {
            taskId: uuid(2),
            actualStartMs: "1000",
            actualEndMs: "5000",
            baselineStartMs: "1000",
            baselineEndMs: "5000",
            onCriticalPath: false,
          },
        ],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1); // Only uuid(1) is delayed
    expect(body.data[0].taskId).toBe(uuid(1));
    expect(body.data[0].startVarianceMs).toBe("1000");
    expect(body.data[0].endVarianceMs).toBe("1000");
    expect(body.data[0].onCriticalPath).toBe(true);
  });

  it("returns empty array when no tasks are delayed", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/wbs/delay-analysis`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: {
        tasks: [
          {
            taskId: uuid(1),
            actualStartMs: "500",
            actualEndMs: "4000",
            baselineStartMs: "1000",
            baselineEndMs: "5000",
            onCriticalPath: false,
          },
        ],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(0);
  });

  it("returns 400 for invalid body (empty tasks)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/wbs/delay-analysis`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { tasks: [] },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/wbs/delay-analysis`,
      payload: { tasks: [{ taskId: uuid(1), actualStartMs: "1000", actualEndMs: "5000", baselineStartMs: "500", baselineEndMs: "4000", onCriticalPath: false }] },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 with unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/projects/${PROJECT_ID}/wbs/delay-analysis`,
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
      payload: { tasks: [{ taskId: uuid(1), actualStartMs: "1000", actualEndMs: "5000", baselineStartMs: "500", baselineEndMs: "4000", onCriticalPath: false }] },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
