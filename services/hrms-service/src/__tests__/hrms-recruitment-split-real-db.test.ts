/**
 * M8 — HRMS without Recruitment, on REAL Postgres (own throwaway DB).
 *
 * Boots hrms-service twice via buildApp(): with every module (today's default) and with every module EXCEPT
 * recruitment. Asserts that switching Recruitment off removes the recruitment surface and ONLY that surface:
 *   - APAR (/v1/hrms/apar...) and the employee data-reveal (/v1/hrms/pii/reveal) are still registered;
 *   - the route table of "everything but recruitment" is the default table minus recruitment routes (parity: nothing
 *     else moved, nothing was added);
 *   - with HRMS_MODULES unset (current tenants) the recruitment, APAR and data-reveal routes are all there.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { NON_CORE_MODULES } from "../shared/module-profile.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0008-4000-8000-000000000008";
const token = () => signToken({ sub: "m8-split-test", tid: TENANT, roles: ["hr_admin", "super_admin"], sid: "sess-m8" }, SECRET);

async function buildWith(hrmsModules: string | undefined): Promise<FastifyInstance> {
  const prev = process.env.HRMS_MODULES;
  if (hrmsModules === undefined) delete process.env.HRMS_MODULES; else process.env.HRMS_MODULES = hrmsModules;
  try {
    const { buildApp } = await import("../app.js");
    const app = await buildApp();
    await app.ready();
    return app;
  } finally {
    if (prev === undefined) delete process.env.HRMS_MODULES; else process.env.HRMS_MODULES = prev;
  }
}

/** Every "METHOD /url" the app registered (HEAD twins dropped). */
function routeSet(app: FastifyInstance): Set<string> {
  const out = new Set<string>();
  const seen: Array<{ method: string | string[]; url: string }> = [];
  // fastify has no public route listing; printRoutes is a radix tree, so probe with hasRoute over the known candidates
  void seen;
  const tree = app.printRoutes({ commonPrefix: false });
  // rebuild full paths from the tree lines
  const stack: string[] = [];
  for (const line of tree.split("\n")) {
    const m = line.match(/^((?:│   |    )*)(?:├── |└── )(.*?) \(([^)]*)\)$/);
    if (!m) continue;
    const depth = (m[1]?.length ?? 0) / 4;
    stack.length = depth;
    stack[depth] = m[2]!;
    const url = stack.join("");
    for (const method of m[3]!.split(",").map((s) => s.trim())) if (method !== "HEAD") out.add(`${method} ${url}`);
  }
  return out;
}

const RECRUITMENT_PATH = /^(?:GET|POST|PUT|PATCH|DELETE) \/v1\/(?:careers\/|hrms\/(?:recruitment|applications|assessments\/attempts\/:id\/admit-card|candidates|interviews?|interview-|job-openings|jd-templates|offers|requisitions|screening-overrides|selection-lists|talent-pool|recordings|ai\/recruitment))/;

describe("M8 HRMS without Recruitment (real Postgres)", () => {
  let all: FastifyInstance;
  let noRec: FastifyInstance;
  beforeAll(async () => {
    all = await buildWith(undefined);
    noRec = await buildWith(NON_CORE_MODULES.filter((m) => m !== "recruitment").join(","));
  }, 60_000);
  afterAll(async () => {
    await all.close();
    await noRec.close();
  });

  it("default (HRMS_MODULES unset, every current tenant): recruitment, APAR and data-reveal are all registered", () => {
    const routes = routeSet(all);
    expect(routes.has("GET /v1/hrms/job-openings")).toBe(true);
    expect(routes.has("POST /v1/hrms/applications/:id/reveal-contact")).toBe(true);
    expect(routes.has("GET /v1/hrms/apar")).toBe(true);
    expect(routes.has("POST /v1/hrms/apar/:id/finalise")).toBe(true);
    expect(routes.has("POST /v1/hrms/pii/reveal")).toBe(true);
  });

  it("Recruitment off: APAR and the employee data-reveal are still registered; the recruitment surface is gone", () => {
    const routes = routeSet(noRec);
    for (const r of ["GET /v1/hrms/apar", "POST /v1/hrms/apar", "POST /v1/hrms/apar/:id/self-appraisal", "POST /v1/hrms/apar/:id/finalise", "GET /v1/hrms/apar/:id", "POST /v1/hrms/pii/reveal"]) {
      expect(routes.has(r), r).toBe(true);
    }
    for (const r of ["GET /v1/hrms/job-openings", "POST /v1/hrms/requisitions", "POST /v1/hrms/applications/:id/reveal-contact", "GET /v1/careers/vacancies", "GET /v1/hrms/talent-pool"]) {
      expect(routes.has(r), r).toBe(false);
    }
  });

  it("parity: 'everything but recruitment' is exactly the default table minus recruitment routes", () => {
    const a = routeSet(all);
    const b = routeSet(noRec);
    const removed = [...a].filter((r) => !b.has(r));
    const added = [...b].filter((r) => !a.has(r));
    expect(added).toEqual([]);
    expect(removed.length).toBeGreaterThan(50);
    const notRecruitment = removed.filter((r) => !RECRUITMENT_PATH.test(r));
    expect(notRecruitment).toEqual([]);
    // and APAR / data-reveal are not among what was removed
    expect(removed.filter((r) => /\/apar|\/pii\/reveal|\/appraisals/.test(r))).toEqual([]);
  });

  it("served, not just registered: APAR list answers (not 404) and a recruitment route is 404 with Recruitment off", async () => {
    const h = { authorization: `Bearer ${token()}` };
    const apar = await noRec.inject({ method: "GET", url: "/v1/hrms/apar", headers: h });
    expect(apar.statusCode).not.toBe(404);
    const reveal = await noRec.inject({ method: "POST", url: "/v1/hrms/pii/reveal", headers: h, payload: {} });
    expect(reveal.statusCode).not.toBe(404);
    const jobs = await noRec.inject({ method: "GET", url: "/v1/hrms/job-openings", headers: h });
    expect(jobs.statusCode).toBe(404);
    // positive control: the same recruitment route answers on the default build
    const jobsAll = await all.inject({ method: "GET", url: "/v1/hrms/job-openings", headers: h });
    expect(jobsAll.statusCode).not.toBe(404);
  });
});
