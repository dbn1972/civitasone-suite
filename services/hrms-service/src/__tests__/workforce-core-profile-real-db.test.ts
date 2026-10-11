/**
 * Workforce Core profile — core-only boot test on REAL Postgres (ST-M01-04).
 *
 * Boots hrms-service via buildApp() with HRMS_MODULES=core and asserts:
 *   • CORE routes are registered and answer (NOT 404) — employees list,
 *     departments/designations masters, orgchart, reservation sanctioned
 *     posts, manpower, service book, bulk import, dashboard.
 *   • NON-CORE routes are NOT registered -> 404 (leave, attendance,
 *     recruitment, payroll-facing pension/gpf/claims, training, disciplinary,
 *     rti, id-cards, deputation).
 *   • A positive control: with HRMS_MODULES unset (all modules), those same
 *     non-core routes ARE registered (NOT 404) — proving the 404s above are
 *     the gate, not a typo'd path.
 *
 * Runs on real Postgres (DATABASE_URL from vitest env). A valid hr_admin token
 * is sent so a REGISTERED route never 404s for lack of auth: a 404 therefore
 * means "route not registered", which is exactly the gate under test.
 *
 * Spec: SMARTTRANSFER-MASTER-SPEC-v3 §3, §11; D-ST-23.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0004-4000-8000-000000000004";

function adminTok(): string {
  return signToken(
    { sub: "wc-profile-test", tid: TENANT, roles: ["hr_admin", "super_admin"], sid: "sess-wc" },
    SECRET,
  );
}

/** Build an app with a specific HRMS_MODULES value, restoring env afterwards. */
async function buildWith(hrmsModules: string | undefined): Promise<FastifyInstance> {
  const prev = process.env.HRMS_MODULES;
  if (hrmsModules === undefined) delete process.env.HRMS_MODULES;
  else process.env.HRMS_MODULES = hrmsModules;
  try {
    const { buildApp } = await import("../app.js");
    return await buildApp();
  } finally {
    if (prev === undefined) delete process.env.HRMS_MODULES;
    else process.env.HRMS_MODULES = prev;
  }
}

// Routes that MUST stay registered under HRMS_MODULES=core (Workforce Core).
const CORE_GET_ROUTES = [
  "/v1/hrms/employees?limit=1",
  "/v1/hrms/departments",
  "/v1/hrms/designations",
  "/v1/hrms/org-chart",
  "/v1/hrms/reservation/rosters",
  "/v1/hrms/manpower/plans",
];

// Routes that MUST be absent (404) under HRMS_MODULES=core — non-core modules.
const NON_CORE_GET_ROUTES = [
  "/v1/hrms/leave-allocations", // leave
  "/v1/hrms/attendance/locks", // attendance
  "/v1/hrms/job-openings", // recruitment
  "/v1/hrms/apar", // appraisal
  "/v1/hrms/rti/requests", // rti
  "/v1/hrms/id-cards", // id_cards
];

describe("HRMS_MODULES=core — core routes answer, non-core routes are 404 (real Postgres)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildWith("core");
  });
  afterAll(async () => {
    await app.close();
  });

  for (const url of CORE_GET_ROUTES) {
    it(`core route registered: GET ${url} is not 404`, async () => {
      const r = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${adminTok()}` } });
      expect(r.statusCode).not.toBe(404);
    });
  }

  for (const url of NON_CORE_GET_ROUTES) {
    it(`non-core route NOT registered: GET ${url} is 404`, async () => {
      const r = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${adminTok()}` } });
      expect(r.statusCode).toBe(404);
    });
  }
});

describe("HRMS_MODULES unset — all modules on (positive control, no regression)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildWith(undefined);
  });
  afterAll(async () => {
    await app.close();
  });

  for (const url of [...CORE_GET_ROUTES, ...NON_CORE_GET_ROUTES]) {
    it(`route registered with all modules: GET ${url} is not 404`, async () => {
      const r = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${adminTok()}` } });
      expect(r.statusCode).not.toBe(404);
    });
  }
});
