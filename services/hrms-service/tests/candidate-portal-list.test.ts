/**
 * GAP-RECRUITMENT-CAREERS-PORTAL-06 / -07: the candidate portal LIST
 *  - loads only the job openings the candidate's applications reference (not every opening in the tenant)
 *  - does not fabricate a job title ("Unknown Position") when the opening row is gone
 *  - pages (limit/offset) and reports the total
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { PgDialect } from "drizzle-orm/pg-core";

const JOB_A = "bbbbbbbb-0001-4000-8000-00000000b001";
const JOB_GONE = "bbbbbbbb-0001-4000-8000-00000000b999";

const state = vi.hoisted(() => ({
  captured: [] as { rendered: unknown }[],
  results: [] as unknown[][],
}));

// scopedRead(fn): run fn against a fake tx that records the WHERE / LIMIT / OFFSET of each query,
// then hand back the next canned result set (count, applications, job titles — in call order).
vi.mock("../src/shared/db.js", async (io) => {
  return {
    ...(await io<Record<string, unknown>>()),
    scopedRead: async (fn: (tx: unknown) => unknown) => {
      const rec: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.orderBy = (...a: unknown[]) => { rec.orderBy = a; return chain; };
      chain.where = (w: unknown) => { rec.where = w; return chain; };
      chain.limit = (n: number) => { rec.limit = n; return chain; };
      chain.offset = (n: number) => { rec.offset = n; return chain; };
      (chain as { then?: unknown }).then = (res: (v: unknown) => unknown) => res(state.results.shift());
      const tx = { select: () => chain };
      const out = await fn(tx);
      state.captured.push({ rendered: rec });
      return out;
    },
  };
});
vi.mock("../src/modules/recruitment/candidate-public-auth-routes.js", () => ({
  verifyCandToken: () => ({ candidateId: "c1", tenantId: "cccccccc-0001-4000-8000-00000000c001", email: "a@example.gov.in" }),
}));

import { candidatePublicPortalRoutes } from "../src/modules/recruitment/candidate-public-portal-routes.js";

const dialect = new PgDialect();
const render = (w: unknown) => dialect.sqlToQuery(w as never);

async function get(url: string) {
  const app = Fastify();
  await app.register(candidatePublicPortalRoutes);
  const res = await app.inject({ method: "GET", url, headers: { authorization: "Bearer x.y" } });
  await app.close();
  return res;
}

beforeEach(() => { state.captured = []; state.results = []; });

describe("candidate portal list", () => {
  it("only loads the job openings its applications reference (inArray on ids)", async () => {
    state.results = [
      [{ n: 1 }],
      [{ id: "a1", applicationNo: "REC/1", jobOpeningId: JOB_A, stage: "applied", status: "active", appliedAt: new Date("2026-03-01T00:00:00Z") }],
      [{ id: JOB_A, title: "Assistant", location: null, refNo: "R1" }],
    ];
    const res = await get("/v1/careers/portal/applications");
    expect(res.statusCode).toBe(200);
    const titlesWhere = render((state.captured[2]!.rendered as { where: unknown }).where);
    expect(titlesWhere.params).toContain(JOB_A);
    expect(titlesWhere.sql).toMatch(/"id" in \(/i);
  });

  it("returns jobTitle null (not 'Unknown Position') when the opening no longer exists", async () => {
    state.results = [
      [{ n: 1 }],
      [{ id: "a1", applicationNo: "REC/1", jobOpeningId: JOB_GONE, stage: "applied", status: "active", appliedAt: new Date() }],
      [],
    ];
    const res = await get("/v1/careers/portal/applications");
    const body = res.json() as { data: { jobTitle: string | null; jobLocation: string | null }[] };
    expect(body.data[0]!.jobTitle).toBeNull();
    expect(res.body).not.toContain("Unknown Position");
    expect(body.data[0]!.jobLocation).toBeNull();
  });

  it("applies limit/offset and returns the total", async () => {
    state.results = [[{ n: 60 }], [], []];
    const res = await get("/v1/careers/portal/applications?limit=20&offset=40");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 60, limit: 20, offset: 40, data: [] });
    const rows = state.captured[1]!.rendered as { limit: number; offset: number };
    expect(rows.limit).toBe(20);
    expect(rows.offset).toBe(40);
  });

  it("orders by applied_at DESC with an id tie-breaker so pages are stable", async () => {
    state.results = [[{ n: 2 }], [], []];
    await get("/v1/careers/portal/applications");
    const ob = (state.captured[1]!.rendered as { orderBy: unknown[] }).orderBy;
    expect(ob).toHaveLength(2);
    expect(render(ob[1]).sql).toMatch(/"id"/);
  });

  it("rejects an offset above the bound", async () => {
    expect((await get("/v1/careers/portal/applications?offset=10001")).statusCode).toBe(400);
    expect((await get("/v1/careers/portal/applications?offset=99999999999")).statusCode).toBe(400);
  });

  it("rejects an out-of-range limit", async () => {
    expect((await get("/v1/careers/portal/applications?limit=500")).statusCode).toBe(400);
  });
});
