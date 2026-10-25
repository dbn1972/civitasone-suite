/**
 * GET /v1/projects/dprs must resolve project names with one batched query, not one per DPR row (CLOS3-S5-22).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const H = vi.hoisted(() => ({
  dprs: [] as Array<Record<string, unknown>>,
  projects: [] as Array<{ id: string; name: string }>,
  selectCalls: 0,
}));

vi.mock("../src/shared/context.js", () => ({
  resolveContext: () => ({ tenantId: "t1", roles: ["project_manager"] }),
  requireRole: () => undefined,
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    makeKey: (...p: string[]) => p.join(":"),
    getOrLoad: async (_k: string, loader: () => Promise<unknown>) => loader(),
  },
}));
vi.mock("../src/modules/escalation/repo.js", () => ({}));
vi.mock("../src/shared/db.js", () => {
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "limit"]) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej);
    return c;
  };
  const tx = {
    select: (fields: Record<string, unknown>) => {
      H.selectCalls += 1;
      if ("dprNo" in fields) return chain(H.dprs);
      // project-name lookup: the per-row form (name only) is the pre-fix shape
      return "id" in fields ? chain(H.projects) : chain(H.projects.slice(0, 1));
    },
  };
  return { db: { transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx) } };
});

import { mockEliminationRoutes } from "../src/modules/project/mock-elimination-routes.js";

async function get() {
  const app = Fastify();
  await mockEliminationRoutes(app);
  const res = await app.inject({ method: "GET", url: "/v1/projects/dprs" });
  await app.close();
  return res.json() as { data: Array<{ projectId: string; projectTitle: string; dprNo: string }> };
}

describe("DPR list project-name lookup", () => {
  beforeEach(() => {
    H.selectCalls = 0;
    H.dprs = [];
    H.projects = [];
  });

  it("200 DPRs over 50 projects take exactly 2 selects and map names correctly", async () => {
    H.projects = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: `Project ${i}` }));
    H.dprs = Array.from({ length: 200 }, (_, i) => ({
      id: `d${i}`, dprNo: `DPR-${i}`, projectId: `p${i % 50}`, dprDate: "2026-10-01", status: "submitted", submittedBy: "u1",
    }));
    const body = await get();
    expect(H.selectCalls).toBe(2);
    expect(body.data).toHaveLength(200);
    expect(body.data[7]).toMatchObject({ projectId: "p7", projectTitle: "Project 7" });
    expect(body.data[199]).toMatchObject({ projectId: "p49", projectTitle: "Project 49" });
  });

  it("a DPR whose project is missing shows 'Unknown Project'", async () => {
    H.projects = [{ id: "p1", name: "Project 1" }];
    H.dprs = [
      { id: "d1", dprNo: "A", projectId: "p1", dprDate: "2026-10-01", status: "submitted", submittedBy: null },
      { id: "d2", dprNo: "B", projectId: "gone", dprDate: "2026-10-01", status: "submitted", submittedBy: null },
    ];
    const body = await get();
    expect(body.data.map((r) => r.projectTitle)).toEqual(["Project 1", "Unknown Project"]);
  });

  it("no DPRs: one select and an empty list", async () => {
    const body = await get();
    expect(H.selectCalls).toBe(1);
    expect(body.data).toEqual([]);
  });
});
