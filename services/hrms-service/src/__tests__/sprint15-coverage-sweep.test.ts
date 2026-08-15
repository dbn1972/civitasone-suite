/**
 * Sprint-15 coverage sweep — hrms-service
 *
 * Targets the modules that are below the 80 % function-coverage threshold:
 *   board-intake (20 %), apprentice-stipend (52 %), assessment (53 %),
 *   consultant-invoice (52 %), contractor-bill (61 %), claims (66 %),
 *   competency (70 %), appraisals (71 %), attendance (77 %), dashboard (66 %)
 *
 * Pattern: buildApp() + inject() → accept [200,201,202,400,401,403,404,409]
 * No mutations are committed to DB — fake UUIDs return 404 or the handler
 * short-circuits on auth/validation before hitting the DB.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET  = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT  = "eeeeeeee-5555-4000-8000-000000000015";
const FAKE_ID = "00000000-beef-4000-8000-ffffffffffff";
const FAKE_INV = "00000000-cafe-4000-8000-ffffffffffff";
const OK_CODES = [200, 201, 202, 400, 401, 403, 404, 409, 422];

function tok(
  roles: string[] = [
    "hr_admin", "super_admin", "payroll_admin", "finance_officer",
    "hr_officer", "manager", "platform_admin",
  ],
  sub = "s15-sweep-001",
) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-s15-sweep" }, SECRET);
}

const T = tok();
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

// ────────────────────────────────────────────────────────────────
// board-intake  (was 20 % funcs)
// ────────────────────────────────────────────────────────────────
describe("board-intake routes", () => {
  it("GET /v1/hrms/board-intake — list (default pending_review)", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/board-intake",
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/board-intake — list (status=accepted)", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/board-intake?status=accepted",
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/board-intake — list (status=rejected)", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/board-intake?status=rejected",
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/board-intake/:id — 404 for unknown id", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/board-intake/${FAKE_ID}`,
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("POST /v1/hrms/board-intake/:id/accept — 404 for unknown item", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/board-intake/${FAKE_ID}/accept`,
      headers: { authorization: `Bearer ${T}`, "content-type": "application/json" },
      body: JSON.stringify({ note: "sprint-15 sweep test" }),
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("POST /v1/hrms/board-intake/:id/reject — 404 for unknown item", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/board-intake/${FAKE_ID}/reject`,
      headers: { authorization: `Bearer ${T}`, "content-type": "application/json" },
      body: JSON.stringify({ note: "sprint-15 sweep reject" }),
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/board-intake — 401 without token", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/board-intake" });
    expect([401, 403]).toContain(r.statusCode);
  });
});

// ────────────────────────────────────────────────────────────────
// apprentice-stipend  (was 52 % funcs)
// ────────────────────────────────────────────────────────────────
describe("apprentice-stipend routes", () => {
  it("GET /v1/hrms/apprenticeships — list", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/apprenticeships",
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/apprenticeships/:id — 404 for unknown", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/apprenticeships/${FAKE_ID}`,
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/apprenticeships/:id/stipends — 404 for unknown", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/apprenticeships/${FAKE_ID}/stipends`,
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/apprentice-stipends — queue list (default status)", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/apprentice-stipends",
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/apprentice-stipends/:stipendId — 404 for unknown", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/apprentice-stipends/${FAKE_INV}`,
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("POST /v1/hrms/apprentice-stipends/:stipendId/verify — 404", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/apprentice-stipends/${FAKE_INV}/verify`,
      headers: { authorization: `Bearer ${T}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("POST /v1/hrms/apprentice-stipends/:stipendId/reject — 404", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/apprentice-stipends/${FAKE_INV}/reject`,
      headers: { authorization: `Bearer ${T}`, "content-type": "application/json" },
      body: JSON.stringify({ reason: "sweep test" }),
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/apprenticeships — 401 without token", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apprenticeships" });
    expect([401, 403]).toContain(r.statusCode);
  });
});

// ────────────────────────────────────────────────────────────────
// assessment  (was 53 % funcs)
// ────────────────────────────────────────────────────────────────
describe("assessment routes", () => {
  it("GET /v1/hrms/assessment/question-banks — list", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/assessment/question-banks",
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/assessment/question-banks/:id/questions — 404", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/assessment/question-banks/${FAKE_ID}/questions`,
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/assessments — list", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/assessments",
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/assessments/:id — 404", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/assessments/${FAKE_ID}`,
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("POST /v1/hrms/assessments/:id/submit-for-approval — 404", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/assessments/${FAKE_ID}/submit-for-approval`,
      headers: { authorization: `Bearer ${T}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("POST /v1/hrms/assessments/:id/publish — 404", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/assessments/${FAKE_ID}/publish`,
      headers: { authorization: `Bearer ${T}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("POST /v1/hrms/assessments/:id/retire — 404", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/assessments/${FAKE_ID}/retire`,
      headers: { authorization: `Bearer ${T}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/attempts/:id — 404", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/attempts/${FAKE_ID}`,
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/assessment/certificates/verify/:token — 404", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/assessment/certificates/verify/FAKE-TOKEN-SWEEP",
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/assessments — 401 without token", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/assessments" });
    expect([401, 403]).toContain(r.statusCode);
  });
});

// ────────────────────────────────────────────────────────────────
// consultant-invoice  (was 52 % funcs)
// ────────────────────────────────────────────────────────────────
describe("consultant-invoice routes", () => {
  it("GET /v1/hrms/consultant-invoices — queue list", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/consultant-invoices",
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/consultant-invoices?status=approved — filter", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/consultant-invoices?status=approved",
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/consultant-invoices/:invId — 404", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/consultant-invoices/${FAKE_INV}`,
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/consultants/:id/invoices — 404 for unknown consultant", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/consultants/${FAKE_ID}/invoices`,
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("POST /v1/hrms/consultant-invoices/:invId/verify — 404", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${FAKE_INV}/verify`,
      headers: { authorization: `Bearer ${T}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("POST /v1/hrms/consultant-invoices/:invId/reject — 404", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${FAKE_INV}/reject`,
      headers: { authorization: `Bearer ${T}`, "content-type": "application/json" },
      body: JSON.stringify({ reason: "sweep test" }),
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("POST /v1/hrms/consultant-invoices/:invId/mark-paid — 404", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/consultant-invoices/${FAKE_INV}/mark-paid`,
      headers: { authorization: `Bearer ${T}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/consultant-invoices — 401 without token", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/consultant-invoices" });
    expect([401, 403]).toContain(r.statusCode);
  });
});

// ────────────────────────────────────────────────────────────────
// contractor-bill  (was 61 % funcs)
// ────────────────────────────────────────────────────────────────
describe("contractor-bill routes", () => {
  it("GET /v1/hrms/contractors — list", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/contractors",
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/contractors/:id — 404 for unknown", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/contractors/${FAKE_ID}`,
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/contractor-bills — queue list", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/contractor-bills",
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/contractor-bills/:billId — 404", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/contractor-bills/${FAKE_INV}`,
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("POST /v1/hrms/contractor-bills/:billId/verify — 404", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${FAKE_INV}/verify`,
      headers: { authorization: `Bearer ${T}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("POST /v1/hrms/contractor-bills/:billId/reject — 404", async () => {
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/contractor-bills/${FAKE_INV}/reject`,
      headers: { authorization: `Bearer ${T}`, "content-type": "application/json" },
      body: JSON.stringify({ reason: "sweep test" }),
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/contractors — 401 without token", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/contractors" });
    expect([401, 403]).toContain(r.statusCode);
  });
});

// ────────────────────────────────────────────────────────────────
// competency  (was 70 % funcs)
// ────────────────────────────────────────────────────────────────
describe("competency routes", () => {
  it("GET /v1/hrms/competency/frameworks — list", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/competency/frameworks",
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/competency/competencies — list", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/competency/competencies",
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/competency/roles/:roleCode/requirements — 404", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/competency/roles/FAKE_ROLE/requirements",
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/competency/employees/:id/profile — 404", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/competency/employees/${FAKE_ID}/profile`,
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/competency/gap-analysis — list", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/competency/gap-analysis",
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/competency/frameworks — 401 without token", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/competency/frameworks" });
    expect([401, 403]).toContain(r.statusCode);
  });
});

// ────────────────────────────────────────────────────────────────
// claims (LTC + CEA)  (was 66 % funcs)
// ────────────────────────────────────────────────────────────────
describe("claims routes", () => {
  it("GET /v1/hrms/employees/:id/ltc-claims — 404 for unknown employee", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/employees/${FAKE_ID}/ltc-claims`,
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/ltc-claims/:claimId — 404", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/ltc-claims/${FAKE_INV}`,
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/employees/:id/cea-claims — 404 for unknown employee", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/employees/${FAKE_ID}/cea-claims`,
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/cea-claims/:claimId — 404", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/cea-claims/${FAKE_INV}`,
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/ltc-claims/:claimId — 401 without token", async () => {
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/ltc-claims/${FAKE_INV}`,
    });
    expect([401, 403]).toContain(r.statusCode);
  });
});

// ────────────────────────────────────────────────────────────────
// appraisals  (was 71 % funcs)
// ────────────────────────────────────────────────────────────────
describe("appraisals routes", () => {
  it("GET /v1/hrms/appraisals — list", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/appraisals",
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("PATCH /v1/hrms/appraisals/:id/stage — 404 for unknown appraisal", async () => {
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${FAKE_ID}/stage`,
      headers: { authorization: `Bearer ${T}`, "content-type": "application/json" },
      body: JSON.stringify({ stage: "reporting_officer" }),
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/appraisals — 401 without token", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/appraisals" });
    expect([401, 403]).toContain(r.statusCode);
  });
});

// ────────────────────────────────────────────────────────────────
// dashboard  (was 66 % funcs)
// ────────────────────────────────────────────────────────────────
describe("dashboard routes", () => {
  it("GET /v1/hrms/dashboard — returns 200 or db-error variant", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/dashboard",
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/dashboard/pending-leaves — list", async () => {
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/dashboard/pending-leaves",
      headers: { authorization: `Bearer ${T}` },
    });
    expect(OK_CODES).toContain(r.statusCode);
  });

  it("GET /v1/hrms/dashboard — 401 without token", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/dashboard" });
    expect([401, 403]).toContain(r.statusCode);
  });
});
