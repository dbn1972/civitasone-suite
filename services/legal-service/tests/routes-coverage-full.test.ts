import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

const ACTOR = "00000000-aaaa-4000-8000-000000000099";
const TENANT = "11111111-aaaa-4000-8000-000000000099";
const CASE_UUID = "22222222-bbbb-4000-8000-000000000099";
const HEARING_UUID = "33333333-cccc-4000-8000-000000000099";
const SECRET = "test_secret_for_civitasone_32chr";

function token(roles: string[] = ["legal_officer"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles }, SECRET, 3600);
}

function authHeader(roles?: string[]) {
  return { authorization: `Bearer ${token(roles)}` };
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); });

// ══════════════════════════════════════════════════════════════════════════════
// CASES
// ══════════════════════════════════════════════════════════════════════════════
describe("Cases routes", () => {
  it("POST /v1/legal/cases → 202 with valid body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/cases",
      headers: authHeader(),
      payload: { caseNo: "WP-2026-TEST", title: "Test case", court: "High Court" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("POST /v1/legal/cases → 400 empty body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/cases",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/cases → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/cases",
      headers: authHeader(["citizen"]),
      payload: { caseNo: "WP-X", title: "X", court: "X" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/legal/cases → 401 no token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/legal/cases", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("PATCH /v1/legal/cases/:id/dispose → 202 with valid body", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/legal/cases/${CASE_UUID}/dispose`,
      headers: authHeader(),
      payload: { disposition: "Disposed by consent" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/legal/cases/:id/dispose → 400 empty body", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/legal/cases/${CASE_UUID}/dispose`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/legal/cases/:id/dispose → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/legal/cases/not-a-uuid/dispose",
      headers: authHeader(),
      payload: { disposition: "test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/legal/cases/:id → 404 not found", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/legal/cases/${CASE_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/legal/cases → 200 list", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/cases",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("items");
  });

  it("GET /v1/legal/cases?status=pending → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/cases?status=pending",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/legal/cases → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/cases",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// HEARINGS
// ══════════════════════════════════════════════════════════════════════════════
describe("Hearings routes", () => {
  it("POST /v1/legal/cases/:id/hearings → 202", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/legal/cases/${CASE_UUID}/hearings`,
      headers: authHeader(),
      payload: { hearingDate: "2026-08-01", court: "High Court Delhi" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/legal/cases/:id/hearings → 400 missing fields", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/legal/cases/${CASE_UUID}/hearings`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/cases/:id/hearings → 400 bad uuid param", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/cases/bad-uuid/hearings",
      headers: authHeader(),
      payload: { hearingDate: "2026-08-01", court: "X" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/cases/:id/hearings → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/legal/cases/${CASE_UUID}/hearings`,
      headers: authHeader(["audit_officer"]),
      payload: { hearingDate: "2026-08-01", court: "X" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /v1/legal/cases/:id/hearings/:hId/adjourn → 202", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/legal/cases/${CASE_UUID}/hearings/${HEARING_UUID}/adjourn`,
      headers: authHeader(),
      payload: { nextDate: "2026-09-15" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/legal/cases/:id/hearings/:hId/adjourn → 400 bad params", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/legal/cases/bad/hearings/bad/adjourn",
      headers: authHeader(),
      payload: { nextDate: "2026-09-15" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/legal/cases/:id/hearings/:hId/adjourn → 400 missing body", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/legal/cases/${CASE_UUID}/hearings/${HEARING_UUID}/adjourn`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/cases/:id/orders → 202", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/legal/cases/${CASE_UUID}/orders`,
      headers: authHeader(),
      payload: { orderType: "interim", summary: "Stay granted", orderDate: "2026-08-01" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/legal/cases/:id/orders → 400 missing fields", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/legal/cases/${CASE_UUID}/orders`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/cases/:id/orders → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/cases/not-uuid/orders",
      headers: authHeader(),
      payload: { orderType: "interim", summary: "x", orderDate: "2026-08-01" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/legal/hearings → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/hearings",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/legal/hearings → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/hearings",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/legal/court-orders → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/court-orders",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/legal/court-orders → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/court-orders",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// NOTICES
// ══════════════════════════════════════════════════════════════════════════════
describe("Notices routes", () => {
  it("POST /v1/legal/notices → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/notices",
      headers: authHeader(),
      payload: { noticeNo: "NOT-001", subject: "Notice to show cause", partyRef: "ABC Corp", direction: "sent" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/legal/notices → 400 bad body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/notices",
      headers: authHeader(),
      payload: { noticeNo: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/notices → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/notices",
      headers: authHeader(["citizen"]),
      payload: { noticeNo: "NOT-001", subject: "x", partyRef: "y", direction: "sent" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/legal/notices/:id/respond → 202", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/legal/notices/${CASE_UUID}/respond`,
      headers: authHeader(),
      payload: { responseBody: "We deny all allegations" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/legal/notices/:id/respond → 400 missing body", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/legal/notices/${CASE_UUID}/respond`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/notices/:id/respond → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/notices/bad-uuid/respond",
      headers: authHeader(),
      payload: { responseBody: "test" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CONTRACTS
// ══════════════════════════════════════════════════════════════════════════════
describe("Contract review routes", () => {
  it("POST /v1/legal/contract-reviews → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/contract-reviews",
      headers: authHeader(),
      payload: { contractRef: "PO-2026-001", subject: "IT Equipment", valueMinor: 5000000, currency: "INR" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/legal/contract-reviews → 400 bad body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/contract-reviews",
      headers: authHeader(),
      payload: { contractRef: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/contract-reviews → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/contract-reviews",
      headers: authHeader(["citizen"]),
      payload: { contractRef: "PO-X", subject: "x", valueMinor: 100, currency: "INR" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /v1/legal/contract-reviews/:id/clear → 202", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/legal/contract-reviews/${CASE_UUID}/clear`,
      headers: authHeader(),
      payload: { clearanceType: "legal_opinion", notes: "All good" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/legal/contract-reviews/:id/clear → 400 missing body", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/legal/contract-reviews/${CASE_UUID}/clear`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/legal/contract-reviews/:id/clear → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/legal/contract-reviews/not-uuid/clear",
      headers: authHeader(),
      payload: { clearanceType: "opinion" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SETTLEMENTS
// ══════════════════════════════════════════════════════════════════════════════
describe("Settlement routes", () => {
  it("POST /v1/legal/settlements → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/settlements",
      headers: authHeader(),
      payload: { settlementNo: "SET-001", amountMinor: 100000, currency: "INR" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/legal/settlements → 202 with lokAdalat", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/settlements",
      headers: authHeader(),
      payload: {
        settlementNo: "SET-002", amountMinor: 50000, currency: "INR",
        lokAdalat: { lokAdalatDate: "2026-07-15", venue: "National Lok Adalat, Delhi" },
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/legal/settlements → 400 missing fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/settlements",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/settlements → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/settlements",
      headers: authHeader(["citizen"]),
      payload: { settlementNo: "S", amountMinor: 1, currency: "INR" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════
describe("Dashboard routes", () => {
  it("GET /v1/legal/dashboard → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/dashboard",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("activeCases");
    expect(body).toHaveProperty("hearingsThisWeek");
  });

  it("GET /v1/legal/dashboard → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/dashboard",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/legal/dashboard → 401 no token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/legal/dashboard" });
    expect(res.statusCode).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// REMINDERS
// ══════════════════════════════════════════════════════════════════════════════
describe("Reminders routes", () => {
  it("GET /v1/legal/hearings/upcoming → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/hearings/upcoming",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("data");
  });

  it("GET /v1/legal/hearings/upcoming → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/hearings/upcoming",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/legal/cases/:id/reminder → 201", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/legal/cases/${CASE_UUID}/reminder`,
      headers: authHeader(),
      payload: { remindAt: "2026-07-20T08:00:00Z", message: "Follow up on hearing" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toHaveProperty("id");
  });

  it("POST /v1/legal/cases/:id/reminder → 400 invalid body", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/legal/cases/${CASE_UUID}/reminder`,
      headers: authHeader(),
      payload: { remindAt: "not-a-date", message: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/cases/:id/reminder → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/cases/bad-uuid/reminder",
      headers: authHeader(),
      payload: { remindAt: "2026-07-20T08:00:00Z", message: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/cases/:id/reminder → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/legal/cases/${CASE_UUID}/reminder`,
      headers: authHeader(["citizen"]),
      payload: { remindAt: "2026-07-20T08:00:00Z", message: "x" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// OPINIONS
// ══════════════════════════════════════════════════════════════════════════════
describe("Opinions routes", () => {
  it("POST /v1/legal/opinions → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/opinions",
      headers: authHeader(),
      payload: { opinionNo: "OP-TEST-1", subject: "Validity of clause", question: "Is it valid?" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/legal/opinions → 400 bad body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/opinions",
      headers: authHeader(),
      payload: { opinionNo: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/opinions → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/opinions",
      headers: authHeader(["audit_officer"]),
      payload: { opinionNo: "OP-X", subject: "x", question: "?" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PATCH /v1/legal/opinions/:id/draft → 202", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/legal/opinions/${CASE_UUID}/draft`,
      headers: authHeader(),
      payload: { counselName: "Sr. Adv. Test", opinionText: "In my opinion..." },
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/legal/opinions/:id/draft → 400 bad body", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/legal/opinions/${CASE_UUID}/draft`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/legal/opinions/:id/draft → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/legal/opinions/not-uuid/draft",
      headers: authHeader(),
      payload: { counselName: "x", opinionText: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /v1/legal/opinions/:id/issue → 202", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/legal/opinions/${CASE_UUID}/issue`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(202);
  });

  it("PATCH /v1/legal/opinions/:id/issue → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "PATCH", url: "/v1/legal/opinions/not-uuid/issue",
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/opinions/:id/submit-approval → 202", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/legal/opinions/${CASE_UUID}/submit-approval`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/legal/opinions/:id/submit-approval → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/opinions/not-uuid/submit-approval",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/opinions/:id/submit-approval → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/legal/opinions/${CASE_UUID}/submit-approval`,
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/legal/opinions/:id → 404", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/legal/opinions/${CASE_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/legal/opinions/:id → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/opinions/not-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/legal/opinions → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/opinions",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("items");
  });

  it("GET /v1/legal/opinions?status=sought → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/opinions?status=sought",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/legal/opinions → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/opinions",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// COUNSEL BRIEFS
// ══════════════════════════════════════════════════════════════════════════════
describe("Counsel brief routes", () => {
  it("POST /v1/legal/counsel-briefs → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/counsel-briefs",
      headers: authHeader(),
      payload: {
        caseId: CASE_UUID, counselName: "Adv. Test",
        counselType: "advocate", briefSummary: "Argue maintainability of the writ petition",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/legal/counsel-briefs → 400 bad body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/counsel-briefs",
      headers: authHeader(),
      payload: { caseId: "not-uuid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/counsel-briefs → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/counsel-briefs",
      headers: authHeader(["citizen"]),
      payload: { caseId: CASE_UUID, counselName: "x", briefSummary: "x" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/legal/counsel-briefs/:id → 404", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/legal/counsel-briefs/${CASE_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/legal/counsel-briefs/:id → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/counsel-briefs/not-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/legal/counsel-briefs → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/counsel-briefs",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("items");
  });

  it("GET /v1/legal/counsel-briefs?status=assigned → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/counsel-briefs?status=assigned",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/legal/counsel-briefs → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/counsel-briefs",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// FILINGS
// ══════════════════════════════════════════════════════════════════════════════
describe("Filings routes", () => {
  it("POST /v1/legal/filings → 202", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/filings",
      headers: authHeader(),
      payload: {
        caseId: CASE_UUID, filingType: "affidavit", title: "Counter affidavit",
        court: "High Court Delhi", filingDate: "2026-07-01",
      },
    });
    expect(res.statusCode).toBe(202);
  });

  it("POST /v1/legal/filings → 400 bad body", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/filings",
      headers: authHeader(),
      payload: { caseId: "not-uuid", filingType: "invalid" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/legal/filings → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/filings",
      headers: authHeader(["citizen"]),
      payload: { caseId: CASE_UUID, filingType: "affidavit", title: "x", court: "x", filingDate: "2026-07-01" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/legal/filings/:id → 404", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/legal/filings/${CASE_UUID}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/legal/filings/:id → 400 bad uuid", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/filings/not-uuid",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/legal/filings → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/filings",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("items");
  });

  it("GET /v1/legal/filings?filingType=affidavit → 200", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/filings?filingType=affidavit",
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
  });

  it("GET /v1/legal/filings → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/filings",
      headers: authHeader(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SUPER_ADMIN ACCESS
// ══════════════════════════════════════════════════════════════════════════════
describe("super_admin role access", () => {
  it("POST /v1/legal/cases → 202 with super_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/cases",
      headers: authHeader(["super_admin"]),
      payload: { caseNo: "SA-001", title: "Super admin case", court: "SC" },
    });
    expect(res.statusCode).toBe(202);
  });

  it("GET /v1/legal/dashboard → 200 with super_admin", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/legal/dashboard",
      headers: authHeader(["super_admin"]),
    });
    expect(res.statusCode).toBe(200);
  });

  it("POST /v1/legal/settlements → 202 with super_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/legal/settlements",
      headers: authHeader(["super_admin"]),
      payload: { settlementNo: "SA-SET", amountMinor: 1000, currency: "INR" },
    });
    expect(res.statusCode).toBe(202);
  });
});
