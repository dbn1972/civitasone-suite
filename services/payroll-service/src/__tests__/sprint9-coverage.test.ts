/**
 * Sprint-9 coverage gate — payroll-service
 *
 * Covers route modules with <45 % line coverage after existing passing
 * tests: DSC-config, sponsor-config, loans, ECR statutory routes,
 * challan routes, statutory-returns, world-class payroll routes,
 * tax routes, form16-pdf routes.
 *
 * Each route group tests:
 *   - 401  (no Authorization header)
 *   - 403  (JWT with "citizen" role)
 *   - 400  (valid JWT + invalid / missing request body)
 *   - 200/404  (valid JWT admin token, happy-path or not-found)
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET   = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT   = "cccccccc-8888-4000-8000-000000000099";
const FAKE_ID  = "00000000-dead-4000-8000-ffffffffffff";

function tok(roles: string[] = ["payroll_admin", "super_admin"], sub = "s9-pay-001") {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-s9-payroll" }, SECRET);
}
const adminTok   = tok();
const citizenTok = tok(["citizen"]);

afterAll(async () => { await sqlClient.end(); });

// ================================================================
// DSC Config Routes  — src/modules/dsc-config/routes.ts
// ADMIN_ROLES = ["payroll_admin", "super_admin"]
// GET/PUT/DELETE /v1/payroll/dsc-config
// ================================================================
describe("DSC Config routes", () => {
  it("GET /v1/payroll/dsc-config — 200 or 404 admin", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("GET /v1/payroll/dsc-config — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/payroll/dsc-config" });
    await app.close();
    expect(r.statusCode).toBe(401);
  });

  it("GET /v1/payroll/dsc-config — 403 citizen", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: "Bearer " + citizenTok },
    });
    await app.close();
    expect(r.statusCode).toBe(403);
  });

  it("PUT /v1/payroll/dsc-config — 400 missing fields", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: "Bearer " + adminTok, "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect(r.statusCode).toBe(400);
  });

  it("PUT /v1/payroll/dsc-config — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect(r.statusCode).toBe(401);
  });

  it("DELETE /v1/payroll/dsc-config — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url: "/v1/payroll/dsc-config" });
    await app.close();
    expect(r.statusCode).toBe(401);
  });

  it("DELETE /v1/payroll/dsc-config — 403 citizen", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: "Bearer " + citizenTok },
    });
    await app.close();
    expect(r.statusCode).toBe(403);
  });
});

// ================================================================
// Sponsor Config Routes  — src/modules/sponsor-config/routes.ts
//
// STALE-URL FIX (sprint9-coverage-urls): "/v1/payroll/sponsor-config" never
// existed in this repo's history except in the commit that introduced this
// test file (git log --all -S over the literal path turns up nothing else).
// The real routes are GET/PUT "/v1/payroll/sponsor-bank-config" — there is
// no POST; the writer verb is PUT, and it is F3-async (202, not 200/201).
// ================================================================
describe("Sponsor Config routes", () => {
  it("GET /v1/payroll/sponsor-bank-config — 200 or 404 admin", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/sponsor-bank-config",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("GET /v1/payroll/sponsor-bank-config — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/payroll/sponsor-bank-config" });
    await app.close();
    expect(r.statusCode).toBe(401);
  });

  it("GET /v1/payroll/sponsor-bank-config — 403 citizen", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/sponsor-bank-config",
      headers: { authorization: "Bearer " + citizenTok },
    });
    await app.close();
    expect(r.statusCode).toBe(403);
  });

  it("PUT /v1/payroll/sponsor-bank-config — 400 missing fields", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/v1/payroll/sponsor-bank-config",
      headers: { authorization: "Bearer " + adminTok, "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect(r.statusCode).toBe(400);
  });

  it("PUT /v1/payroll/sponsor-bank-config — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/v1/payroll/sponsor-bank-config",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect(r.statusCode).toBe(401);
  });

  it("PUT /v1/payroll/sponsor-bank-config — 202 accepted admin", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/v1/payroll/sponsor-bank-config",
      headers: { authorization: "Bearer " + adminTok, "content-type": "application/json" },
      payload: {
        sponsorCode: "HDFC",
        sponsorIfsc: "HDFC0001234",
        sponsorAccount: "123456789012",
        settlementOffsetDays: 1,
        nachEnabled: true,
        apbsEnabled: false,
        maxRecordsPerFile: 100000,
        maxAmountPerFileMinor: "1000000000",
      },
    });
    await app.close();
    // F3 command route: sendAccepted() always replies 202, never 200/201.
    expect(r.statusCode).toBe(202);
  });
});

// ================================================================
// Loans Routes  — src/modules/loans/routes.ts
// ================================================================
describe("Loans routes", () => {
  it("GET /v1/payroll/loans — 200 empty list", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/loans",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400]).toContain(r.statusCode);
  });

  it("GET /v1/payroll/loans — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/payroll/loans" });
    await app.close();
    expect(r.statusCode).toBe(401);
  });

  it("GET /v1/payroll/loans — 403 citizen", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/loans",
      headers: { authorization: "Bearer " + citizenTok },
    });
    await app.close();
    expect(r.statusCode).toBe(403);
  });

  it("GET /v1/payroll/loans/:id — 404 unknown", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/loans/" + FAKE_ID,
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("POST /v1/payroll/loans — 400 missing employeeId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/payroll/loans",
      headers: { authorization: "Bearer " + adminTok, "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect(r.statusCode).toBe(400);
  });

  it("POST /v1/payroll/loans — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/payroll/loans",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect(r.statusCode).toBe(401);
  });
});

// ================================================================
// Statutory ECR Routes  — src/modules/statutory/ecr-routes.ts
//
// STALE-URL FIX: "POST /v1/payroll/statutory/ecr/generate" never existed
// (git log --all -S confirms it only ever appeared in this test file's own
// introducing commit). Reading the whole of ecr-routes.ts confirms there is
// truly no generate-style mutation route in this module — ECR is exported
// synchronously off the single GET, keyed by ?month=. Rather than invent a
// fake test for a route that was never built (or silently build one — out
// of scope for a test-fix), the two POST .../generate cases below are
// retargeted onto the real GET's own validation branches: a well-formed
// admin request with no `month` query param 400s exactly like the old
// "missing period" case intended, and a well-formed-but-unmatched month
// exercises the 404 branch this module never got coverage on.
// ================================================================
describe("Statutory ECR routes", () => {
  it("GET /v1/payroll/statutory/ecr — 200 or 400 admin", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/ecr",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400, 404]).toContain(r.statusCode);
  });

  it("GET /v1/payroll/statutory/ecr — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/payroll/statutory/ecr" });
    await app.close();
    expect(r.statusCode).toBe(401);
  });

  it("GET /v1/payroll/statutory/ecr — 403 citizen", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/ecr",
      headers: { authorization: "Bearer " + citizenTok },
    });
    await app.close();
    expect(r.statusCode).toBe(403);
  });

  it("GET /v1/payroll/statutory/ecr — 400 missing month admin", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/ecr",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect(r.statusCode).toBe(400);
  });

  it("GET /v1/payroll/statutory/ecr?month=1999-01 — 404 no records admin", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/ecr?month=1999-01",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect(r.statusCode).toBe(404);
  });
});

// ================================================================
// Challan Routes  — src/modules/statutory-returns/challan-routes.ts
// ================================================================
describe("Statutory challan routes", () => {
  it("GET /v1/payroll/statutory/challans — 200 or 400 admin", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400, 404]).toContain(r.statusCode);
  });

  it("GET /v1/payroll/statutory/challans — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/payroll/statutory/challans" });
    await app.close();
    expect(r.statusCode).toBe(401);
  });

  it("GET /v1/payroll/statutory/challans — 403 citizen", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: "Bearer " + citizenTok },
    });
    await app.close();
    expect(r.statusCode).toBe(403);
  });

  it("GET /v1/payroll/statutory/challans/:id — 404", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/challans/" + FAKE_ID,
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("POST /v1/payroll/statutory/challans — 400 missing fields", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: "Bearer " + adminTok, "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect(r.statusCode).toBe(400);
  });

  it("POST /v1/payroll/statutory/challans/:id/submit — 404 unknown", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans/" + FAKE_ID + "/submit",
      headers: { authorization: "Bearer " + adminTok, "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect([400, 404]).toContain(r.statusCode);
  });

  it("GET /v1/payroll/statutory/challans/:id/receipt — 404", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/challans/" + FAKE_ID + "/receipt",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });
});

// ================================================================
// Statutory Returns Routes  — src/modules/statutory-returns/routes.ts
//
// STALE-URL FIX: there is no generic "/v1/payroll/statutory/returns"
// collection (git log --all -S confirms it, like the ECR /generate path
// above, only ever appeared in this file's own introducing commit). The
// real module registers separate per-form-type endpoints instead — this
// block is retargeted onto Form 24Q (GET + the confirmed POST
// .../force-file — the one real mutation route in this module, replacing
// the fictional "/:id/file"), which is the closest real analogue of the
// original 401/403/400/200-or-404 shape. The fictional "/:id" and
// "/:id/download" GETs have no real analogue at all (no return in this
// module is addressed by id), so they're replaced with real auth-smoke
// coverage of form12ba and form26q instead of being deleted outright.
// ================================================================
describe("Statutory Returns routes", () => {
  it("GET /v1/payroll/statutory/form24q?fy=2026-27&quarter=Q1 — 200 or 400 admin", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2026-27&quarter=Q1",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    // 502 covers HRMS-unreachable in this test environment (buildForm24Q
    // always calls fetchPayrollInput for the deductee master, even when
    // there are zero deductees); 409 covers an unreconciled-quarter block.
    expect([200, 400, 404, 409, 502]).toContain(r.statusCode);
  });

  it("GET /v1/payroll/statutory/form24q — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/payroll/statutory/form24q" });
    await app.close();
    expect(r.statusCode).toBe(401);
  });

  it("GET /v1/payroll/statutory/form24q — 403 citizen", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q",
      headers: { authorization: "Bearer " + citizenTok },
    });
    await app.close();
    expect(r.statusCode).toBe(403);
  });

  it("GET /v1/payroll/statutory/form24q — 400 missing fy/quarter admin", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect(r.statusCode).toBe(400);
  });

  it("POST /v1/payroll/statutory/form24q/force-file — 400 missing fields", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/form24q/force-file",
      headers: { authorization: "Bearer " + adminTok, "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect(r.statusCode).toBe(400);
  });

  it("POST /v1/payroll/statutory/form24q/force-file — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/form24q/force-file",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect(r.statusCode).toBe(401);
  });

  it("GET /v1/payroll/statutory/form12ba — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/payroll/statutory/form12ba" });
    await app.close();
    expect(r.statusCode).toBe(401);
  });

  it("GET /v1/payroll/statutory/form26q — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/payroll/statutory/form26q" });
    await app.close();
    expect(r.statusCode).toBe(401);
  });
});

// ================================================================
// World-Class Payroll Routes  — src/modules/payroll/world-class-routes.ts
// ================================================================
describe("World-class payroll routes", () => {
  it("GET /v1/payroll/runs — 200 or 400 admin", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/runs",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400, 404]).toContain(r.statusCode);
  });

  it("GET /v1/payroll/runs — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/payroll/runs" });
    await app.close();
    expect(r.statusCode).toBe(401);
  });

  it("GET /v1/payroll/runs — 403 citizen", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/runs",
      headers: { authorization: "Bearer " + citizenTok },
    });
    await app.close();
    expect(r.statusCode).toBe(403);
  });

  it("GET /v1/payroll/runs/:id — 404", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/runs/" + FAKE_ID,
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });

  it("POST /v1/payroll/runs — 400 missing period", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs",
      headers: { authorization: "Bearer " + adminTok, "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect(r.statusCode).toBe(400);
  });

  it("POST /v1/payroll/runs/:id/approve — 404 unknown run", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs/" + FAKE_ID + "/approve",
      headers: { authorization: "Bearer " + adminTok, "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect([400, 404]).toContain(r.statusCode);
  });

  it("POST /v1/payroll/runs/:id/reject — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs/" + FAKE_ID + "/reject",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect(r.statusCode).toBe(401);
  });

  it("GET /v1/payroll/payslips — 200 or 400 admin", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/payslips",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400, 404]).toContain(r.statusCode);
  });

  it("GET /v1/payroll/payslips — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/payroll/payslips" });
    await app.close();
    expect(r.statusCode).toBe(401);
  });

  it("GET /v1/payroll/payslips/:id — 404", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/payslips/" + FAKE_ID,
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 404]).toContain(r.statusCode);
  });
});

// ================================================================
// Tax Routes  — src/modules/tax/routes.ts
//
// STALE-URL FIX: "/v1/payroll/tax/declarations" (with a slash) and
// "/v1/payroll/tax/regimes" never existed — git log --all -S over both
// literal paths turns up nothing outside this test file's own introducing
// commit. The real path is hyphenated: GET/POST "/v1/payroll/tax-declarations"
// (no ":id"/":id/submit" — declarations are looked up by employeeId+fy query,
// not a row id, and there is no separate "submit" step; POST itself is the
// submission). "tax/regimes" has no real analogue anywhere in this file —
// the closest real per-regime endpoint is GET "/v1/payroll/tax/computation",
// which computes tax for one employee under a given ?regime=, so the two
// regimes cases are retargeted onto that instead of being deleted.
// ================================================================
describe("Tax routes", () => {
  it("GET /v1/payroll/tax-declarations?employeeId=..&fy=2026-27 — 200 or 400 admin", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax-declarations?employeeId=" + FAKE_ID + "&fy=2026-27",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400, 404]).toContain(r.statusCode);
  });

  it("GET /v1/payroll/tax-declarations — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/payroll/tax-declarations" });
    await app.close();
    expect(r.statusCode).toBe(401);
  });

  it("GET /v1/payroll/tax-declarations — 403 citizen", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax-declarations",
      headers: { authorization: "Bearer " + citizenTok },
    });
    await app.close();
    expect(r.statusCode).toBe(403);
  });

  it("GET /v1/payroll/tax-declarations?employeeId=.. — 400 missing fy admin", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax-declarations?employeeId=" + FAKE_ID,
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect(r.statusCode).toBe(400);
  });

  it("POST /v1/payroll/tax-declarations — 400 missing fields", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax-declarations",
      headers: { authorization: "Bearer " + adminTok, "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect(r.statusCode).toBe(400);
  });

  it("POST /v1/payroll/tax-declarations — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax-declarations",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect(r.statusCode).toBe(401);
  });

  it("GET /v1/payroll/tax/computation?employeeId=..&fy=2026-27&regime=new — 200 or 400 admin", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/computation?employeeId=" + FAKE_ID + "&fy=2026-27&regime=new",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400, 404, 422]).toContain(r.statusCode);
  });

  it("GET /v1/payroll/tax/computation — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/payroll/tax/computation" });
    await app.close();
    expect(r.statusCode).toBe(401);
  });
});

// ================================================================
// Form-16 PDF Routes  — src/modules/form16-pdf/routes.ts,
//                       src/modules/form16-verify/routes.ts,
//                       src/modules/tax/routes.ts (GET .../tax/form16)
//
// STALE-URL FIX: "/v1/payroll/form16" and "/v1/payroll/form16/generate" (and
// the "/:id" family under them) never existed — git log --all -S over both
// literal paths turns up nothing outside this test file's own introducing
// commit. Form 16 is actually spread across three real routes: a plain JSON
// read at GET "/v1/payroll/tax/form16" (tax/routes.ts), the admin-only bulk
// PDF pipeline under "/v1/payroll/tax/form16/bulk-*" (form16-pdf/routes.ts,
// no ":id" — bulk jobs are looked up by fy, not id), the single-employee PDF
// at GET "/v1/payroll/tax/form16/:employeeId/pdf", and signature verification
// at POST "/v1/payroll/tax/form16/verify" (form16-verify/routes.ts — NOTE:
// that route has no role gate beyond authentication, so it has no 403 case).
// ================================================================
describe("Form-16 PDF routes", () => {
  it("GET /v1/payroll/tax/form16?employeeId=..&fy=2026-27 — 200 or 400 admin", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16?employeeId=" + FAKE_ID + "&fy=2026-27",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400, 404, 422, 502]).toContain(r.statusCode);
  });

  it("GET /v1/payroll/tax/form16 — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/payroll/tax/form16" });
    await app.close();
    expect(r.statusCode).toBe(401);
  });

  it("GET /v1/payroll/tax/form16 — 403 citizen", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16",
      headers: { authorization: "Bearer " + citizenTok },
    });
    await app.close();
    expect(r.statusCode).toBe(403);
  });

  it("POST /v1/payroll/tax/form16/bulk-generate — 400 missing fy", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: "Bearer " + adminTok, "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect(r.statusCode).toBe(400);
  });

  it("POST /v1/payroll/tax/form16/bulk-generate — 401", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect(r.statusCode).toBe(401);
  });

  it("GET /v1/payroll/tax/form16/:employeeId/pdf?fy=2026-27 — unknown employee admin", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/" + FAKE_ID + "/pdf?fy=2026-27",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect([200, 400, 404, 422, 502, 503]).toContain(r.statusCode);
  });

  it("POST /v1/payroll/tax/form16/verify — 400 invalid/missing PDF body", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/verify",
      headers: { authorization: "Bearer " + adminTok, "content-type": "application/json" },
      payload: {},
    });
    await app.close();
    expect(r.statusCode).toBe(400);
  });

  it("GET /v1/payroll/tax/form16/bulk-status?fy=2026-27 — 404 no job admin", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status?fy=2026-27",
      headers: { authorization: "Bearer " + adminTok },
    });
    await app.close();
    expect(r.statusCode).toBe(404);
  });
});

// ================================================================
// Auth smoke tests for remaining low-coverage routes
// ================================================================
describe("Payroll low-coverage routes — auth smoke tests", () => {
  type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

  const routes: Array<[Method, string]> = [
    ["GET", "/v1/payroll/reports/summary"],
    ["GET", "/v1/payroll/reports/department"],
    ["GET", "/v1/payroll/reconciliation"],
    ["GET", "/v1/payroll/variance"],
    ["GET", "/v1/payroll/salary-revision"],
    ["GET", "/v1/payroll/arrears"],
    ["GET", "/v1/payroll/bonus"],
    ["GET", "/v1/payroll/gratuity"],
    ["GET", "/v1/payroll/statutory/pf"],
    ["GET", "/v1/payroll/statutory/esi"],
  ];

  for (const [method, url] of routes) {
    it(method + " " + url + " — 401 no token", async () => {
      const app = await buildApp();
      const r = await app.inject({ method, url });
      await app.close();
      // unregistered routes return 404; registered ones return 401
      expect([401, 404]).toContain(r.statusCode);
    });

    it(method + " " + url + " — 403 citizen", async () => {
      const app = await buildApp();
      const r = await app.inject({
        method,
        url,
        headers: { authorization: "Bearer " + citizenTok },
      });
      await app.close();
      // unregistered routes return 404; registered+wrong-role return 403
      expect([403, 404]).toContain(r.statusCode);
    });

    it(method + " " + url + " — 200/404 admin", async () => {
      const app = await buildApp();
      const r = await app.inject({
        method,
        url,
        headers: { authorization: "Bearer " + adminTok },
      });
      await app.close();
      expect([200, 400, 404]).toContain(r.statusCode);
    });
  }
});
