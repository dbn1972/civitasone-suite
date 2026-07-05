/**
 * World-class gap features — route coverage tests for compensation, LMS,
 * skills, succession, engagement, onboarding, 360° feedback, benefits.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-7777-4000-8000-000000000099";
const ACTOR = "00000000-0001-4000-8000-000000000001";

function makeToken(roles: string[] = ["hr_admin"], sub = ACTOR) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-001" }, SECRET);
}
afterAll(async () => { await sqlClient.end(); });

// ── Gap 1: Compensation Planning ──────────────────────────────────────────────
describe("POST /v1/hrms/compensation/plans", () => {
  it("returns 401 without auth", async () => { const app = await buildApp(); const res = await app.inject({ method: "POST", url: "/v1/hrms/compensation/plans", payload: {} }); await app.close(); expect(res.statusCode).toBe(401); });
  it("returns 403 for employee role", async () => { const app = await buildApp(); const res = await app.inject({ method: "POST", url: "/v1/hrms/compensation/plans", headers: { authorization: `Bearer ${makeToken(["employee"])}` }, payload: {} }); await app.close(); expect(res.statusCode).toBe(403); });
  it("returns 400 for invalid body", async () => { const app = await buildApp(); const res = await app.inject({ method: "POST", url: "/v1/hrms/compensation/plans", headers: { authorization: `Bearer ${makeToken()}` }, payload: {} }); await app.close(); expect(res.statusCode).toBe(400); });
});
describe("GET /v1/hrms/compensation/plans", () => {
  it("returns 200", async () => { const app = await buildApp(); const res = await app.inject({ method: "GET", url: "/v1/hrms/compensation/plans", headers: { authorization: `Bearer ${makeToken()}` } }); await app.close(); expect(res.statusCode).toBe(200); expect(res.json().data).toBeDefined(); });
});

// ── Gap 2: LMS ────────────────────────────────────────────────────────────────
describe("POST /v1/hrms/lms/courses", () => {
  it("returns 401 without auth", async () => { const app = await buildApp(); const res = await app.inject({ method: "POST", url: "/v1/hrms/lms/courses", payload: {} }); await app.close(); expect(res.statusCode).toBe(401); });
  it("returns 400 for invalid body", async () => { const app = await buildApp(); const res = await app.inject({ method: "POST", url: "/v1/hrms/lms/courses", headers: { authorization: `Bearer ${makeToken()}` }, payload: {} }); await app.close(); expect(res.statusCode).toBe(400); });
});
describe("GET /v1/hrms/lms/courses", () => {
  it("returns 200", async () => { const app = await buildApp(); const res = await app.inject({ method: "GET", url: "/v1/hrms/lms/courses", headers: { authorization: `Bearer ${makeToken()}` } }); await app.close(); expect(res.statusCode).toBe(200); });
});
describe("GET /v1/hrms/lms/my-learning", () => {
  it("returns 200", async () => { const app = await buildApp(); const res = await app.inject({ method: "GET", url: "/v1/hrms/lms/my-learning", headers: { authorization: `Bearer ${makeToken()}` } }); await app.close(); expect(res.statusCode).toBe(200); });
});
describe("GET /v1/hrms/lms/compliance", () => {
  it("returns 200", async () => { const app = await buildApp(); const res = await app.inject({ method: "GET", url: "/v1/hrms/lms/compliance", headers: { authorization: `Bearer ${makeToken()}` } }); await app.close(); expect(res.statusCode).toBe(200); });
});

// ── Gap 3: Skills Matrix ──────────────────────────────────────────────────────
describe("POST /v1/hrms/skills/competencies", () => {
  it("returns 401 without auth", async () => { const app = await buildApp(); const res = await app.inject({ method: "POST", url: "/v1/hrms/skills/competencies", payload: {} }); await app.close(); expect(res.statusCode).toBe(401); });
  it("returns 400 for invalid body", async () => { const app = await buildApp(); const res = await app.inject({ method: "POST", url: "/v1/hrms/skills/competencies", headers: { authorization: `Bearer ${makeToken()}` }, payload: {} }); await app.close(); expect(res.statusCode).toBe(400); });
});
describe("GET /v1/hrms/skills/gap-analysis", () => {
  it("returns 400 for missing employeeId", async () => { const app = await buildApp(); const res = await app.inject({ method: "GET", url: "/v1/hrms/skills/gap-analysis", headers: { authorization: `Bearer ${makeToken()}` } }); await app.close(); expect(res.statusCode).toBe(400); });
  it("returns 200 with employeeId", async () => { const app = await buildApp(); const res = await app.inject({ method: "GET", url: `/v1/hrms/skills/gap-analysis?employeeId=${ACTOR}`, headers: { authorization: `Bearer ${makeToken()}` } }); await app.close(); expect(res.statusCode).toBe(200); });
});

// ── Gap 4: Succession Planning ────────────────────────────────────────────────
describe("POST /v1/hrms/succession/critical-roles", () => {
  it("returns 401 without auth", async () => { const app = await buildApp(); const res = await app.inject({ method: "POST", url: "/v1/hrms/succession/critical-roles", payload: {} }); await app.close(); expect(res.statusCode).toBe(401); });
  it("returns 400 for invalid body", async () => { const app = await buildApp(); const res = await app.inject({ method: "POST", url: "/v1/hrms/succession/critical-roles", headers: { authorization: `Bearer ${makeToken()}` }, payload: {} }); await app.close(); expect(res.statusCode).toBe(400); });
});
describe("GET /v1/hrms/succession/pipeline", () => {
  it("returns 200", async () => { const app = await buildApp(); const res = await app.inject({ method: "GET", url: "/v1/hrms/succession/pipeline", headers: { authorization: `Bearer ${makeToken()}` } }); await app.close(); expect(res.statusCode).toBe(200); });
});
describe("GET /v1/hrms/succession/risk", () => {
  it("returns 200", async () => { const app = await buildApp(); const res = await app.inject({ method: "GET", url: "/v1/hrms/succession/risk", headers: { authorization: `Bearer ${makeToken()}` } }); await app.close(); expect(res.statusCode).toBe(200); });
});

// ── Gap 5: Engagement Surveys ─────────────────────────────────────────────────
describe("POST /v1/hrms/engagement/surveys", () => {
  it("returns 401 without auth", async () => { const app = await buildApp(); const res = await app.inject({ method: "POST", url: "/v1/hrms/engagement/surveys", payload: {} }); await app.close(); expect(res.statusCode).toBe(401); });
  it("returns 400 for invalid body", async () => { const app = await buildApp(); const res = await app.inject({ method: "POST", url: "/v1/hrms/engagement/surveys", headers: { authorization: `Bearer ${makeToken()}` }, payload: {} }); await app.close(); expect(res.statusCode).toBe(400); });
});
describe("GET /v1/hrms/engagement/eNPS", () => {
  it("returns 200 with eNPS score", async () => { const app = await buildApp(); const res = await app.inject({ method: "GET", url: "/v1/hrms/engagement/eNPS", headers: { authorization: `Bearer ${makeToken()}` } }); await app.close(); expect(res.statusCode).toBe(200); expect(res.json().data.enps).toBeDefined(); });
});

// ── Gap 6: Onboarding ─────────────────────────────────────────────────────────
describe("POST /v1/hrms/onboarding/templates", () => {
  it("returns 401 without auth", async () => { const app = await buildApp(); const res = await app.inject({ method: "POST", url: "/v1/hrms/onboarding/templates", payload: {} }); await app.close(); expect(res.statusCode).toBe(401); });
  it("returns 400 for invalid body", async () => { const app = await buildApp(); const res = await app.inject({ method: "POST", url: "/v1/hrms/onboarding/templates", headers: { authorization: `Bearer ${makeToken()}` }, payload: {} }); await app.close(); expect(res.statusCode).toBe(400); });
});
describe("GET /v1/hrms/onboarding/active", () => {
  it("returns 200", async () => { const app = await buildApp(); const res = await app.inject({ method: "GET", url: "/v1/hrms/onboarding/active", headers: { authorization: `Bearer ${makeToken()}` } }); await app.close(); expect(res.statusCode).toBe(200); });
});

// ── Gap 7: 360° Feedback ──────────────────────────────────────────────────────
describe("POST /v1/hrms/feedback/cycles", () => {
  it("returns 401 without auth", async () => { const app = await buildApp(); const res = await app.inject({ method: "POST", url: "/v1/hrms/feedback/cycles", payload: {} }); await app.close(); expect(res.statusCode).toBe(401); });
  it("returns 400 for invalid body", async () => { const app = await buildApp(); const res = await app.inject({ method: "POST", url: "/v1/hrms/feedback/cycles", headers: { authorization: `Bearer ${makeToken()}` }, payload: {} }); await app.close(); expect(res.statusCode).toBe(400); });
});

// ── Gap 8: Benefits Administration ────────────────────────────────────────────
describe("POST /v1/hrms/benefits/plans", () => {
  it("returns 401 without auth", async () => { const app = await buildApp(); const res = await app.inject({ method: "POST", url: "/v1/hrms/benefits/plans", payload: {} }); await app.close(); expect(res.statusCode).toBe(401); });
  it("returns 400 for invalid body", async () => { const app = await buildApp(); const res = await app.inject({ method: "POST", url: "/v1/hrms/benefits/plans", headers: { authorization: `Bearer ${makeToken()}` }, payload: {} }); await app.close(); expect(res.statusCode).toBe(400); });
});
describe("GET /v1/hrms/benefits/my-elections", () => {
  it("returns 200", async () => { const app = await buildApp(); const res = await app.inject({ method: "GET", url: "/v1/hrms/benefits/my-elections", headers: { authorization: `Bearer ${makeToken()}` } }); await app.close(); expect(res.statusCode).toBe(200); });
});
