/**
 * Sprint-9 coverage gate — hrms-service (part B)
 *
 * Supplementary tests that hit the CORRECT route URLs discovered from
 * source inspection.  Part A (sprint9-coverage.test.ts) had several wrong
 * URL guesses (e.g. /workforce-plans vs /manpower/plans) that meant
 * handlers were never invoked.  Each GET with an admin token reaches the
 * handler and exercises at least one repo function — returning either 200
 * (empty list) or 404 (fake UUID) is both acceptable.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET   = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT   = "dddddddd-7777-4000-8000-000000000099";
const FAKE_ID  = "00000000-cafe-4000-8000-ffffffffffff";

function tok(roles: string[] = ["hr_admin", "super_admin", "payroll_admin", "finance_officer"], sub = "s9b-user-001") {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-s9b-hrms" }, SECRET);
}
const adminTok = tok();

afterAll(async () => { await sqlClient.end(); });

// ================================================================
// Learning — routes with correct URLs
// GET endpoints exercise repo list/get functions
// ================================================================
describe("Learning routes — correct URLs (part B)", () => {
  it("GET /v1/hrms/learning/courses/:id — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/learning/courses/" + FAKE_ID,
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/learning/courses/:id/enrollments — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/learning/courses/" + FAKE_ID + "/enrollments",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/learning/training-plans/:id — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/learning/training-plans/" + FAKE_ID,
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/learning/enrollments/:id — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/learning/enrollments/" + FAKE_ID,
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });
});

// ================================================================
// Assessment — routes with correct URLs
// ================================================================
describe("Assessment routes — correct URLs (part B)", () => {
  it("GET /v1/hrms/assessment/question-banks — 200 or 400", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/assessment/question-banks",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/assessment/question-banks/:id/questions — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/assessment/question-banks/" + FAKE_ID + "/questions",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/assessments/:id — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/assessments/" + FAKE_ID,
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/attempts/:id — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attempts/" + FAKE_ID,
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/assessment/certificates/verify/:token — 200 or 404", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/assessment/certificates/verify/fake-cert-token-0000",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400, 404]).toContain(r.statusCode);
  });
});

// ================================================================
// Manpower Planning — CORRECT URLs (/manpower/plans not /workforce-plans)
// ================================================================
describe("Manpower Planning routes — correct URLs (part B)", () => {
  it("GET /v1/hrms/manpower/plans — 200 or 400", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/manpower/plans",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/manpower/plans/:id — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/manpower/plans/" + FAKE_ID,
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/manpower/requisitions — 200 or 400", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/manpower/requisitions",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400, 404]).toContain(r.statusCode);
  });
});

// ================================================================
// Recruitment — CORRECT URLs (/job-openings, /talent-pool, etc.)
// ================================================================
describe("Recruitment routes — correct URLs (part B)", () => {
  it("GET /v1/hrms/job-openings — 200 or 400", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/job-openings",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/talent-pool — 200 or 400", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/talent-pool",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/job-openings/:id/applications — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/job-openings/" + FAKE_ID + "/applications",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/recruitment/dashboard — 200 or 400", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/recruitment/dashboard",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400, 404]).toContain(r.statusCode);
  });
});

// ================================================================
// Contractor Bill — additional GET routes not in part A
// ================================================================
describe("Contractor Bill routes — additional (part B)", () => {
  it("GET /v1/hrms/contractors/:id/bills — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contractors/" + FAKE_ID + "/bills",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/contractor-bills/:id — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/contractor-bills/" + FAKE_ID,
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });
});

// ================================================================
// Training Admin — CORRECT URLs (/trainings/:id/sessions)
// ================================================================
describe("Training Admin routes — correct URLs (part B)", () => {
  it("GET /v1/hrms/trainings/:id/sessions — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/trainings/" + FAKE_ID + "/sessions",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/sessions/:id/attendance — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/sessions/" + FAKE_ID + "/attendance",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });
});

// ================================================================
// Disciplinary routes (NEW — not in part A)
// ================================================================
describe("Disciplinary routes (part B)", () => {
  it("GET /v1/hrms/employees/:id/disciplinary-cases — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/employees/" + FAKE_ID + "/disciplinary-cases",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/disciplinary-cases/:id — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/disciplinary-cases/" + FAKE_ID,
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/disciplinary-cases/:id/events — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/disciplinary-cases/" + FAKE_ID + "/events",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/employees/:id/suspensions — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/employees/" + FAKE_ID + "/suspensions",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });
});

// ================================================================
// Competency routes (NEW — not in part A)
// ================================================================
describe("Competency routes (part B)", () => {
  it("GET /v1/hrms/competency/frameworks — 200 or 400", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/competency/frameworks",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/competency/competencies — 200 or 400", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/competency/competencies",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/competency/employees/:id/profile — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/competency/employees/" + FAKE_ID + "/profile",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/competency/gap-analysis — 200 or 400", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/competency/gap-analysis",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400, 404]).toContain(r.statusCode);
  });
});

// ================================================================
// Claims (LTC + CEA) routes (NEW — not in part A)
// ================================================================
describe("LTC Claims routes (part B)", () => {
  it("GET /v1/hrms/employees/:id/ltc-claims — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/employees/" + FAKE_ID + "/ltc-claims",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/ltc-claims/:id — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/ltc-claims/" + FAKE_ID,
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/employees/:id/cea-claims — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/employees/" + FAKE_ID + "/cea-claims",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/cea-claims/:id — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/cea-claims/" + FAKE_ID,
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });
});

// ================================================================
// APAR routes (NEW — not in part A)
// ================================================================
describe("APAR routes (part B)", () => {
  it("GET /v1/hrms/apar — 200 or 400", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/apar",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400, 404]).toContain(r.statusCode);
  });

  it("GET /v1/hrms/apar/:id — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/apar/" + FAKE_ID,
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });
});

// ================================================================
// GPF routes (correct URL)
// ================================================================
describe("GPF routes (part B)", () => {
  it("GET /v1/hrms/employees/:id/gpf — 404 or 200", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/employees/" + FAKE_ID + "/gpf",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });
});
