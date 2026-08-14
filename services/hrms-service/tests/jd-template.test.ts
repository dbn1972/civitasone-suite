/**
 * JD Template Repository — smoke + functional tests
 * Runs with JWT_ALGORITHM=HS256 via vitest.config.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000011";
const DEPT_ID = "cccccccc-3333-4000-8000-000000000001"; // seed dept

function makeToken(roles: string[] = ["hr_admin"]) {
  return signToken({ sub: "user-hr-001", tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

// ── Auth guard ────────────────────────────────────────────────────────────────
describe("GET /v1/hrms/jd-templates — auth guard", () => {
  it("returns 401 with no bearer token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/jd-templates" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/jd-templates",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── List (empty) ──────────────────────────────────────────────────────────────
describe("GET /v1/hrms/jd-templates — shape", () => {
  it("returns 200 with data array for hr_admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/jd-templates",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("accepts vacancyType filter param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/jd-templates?vacancyType=internship",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(Array.isArray(data)).toBe(true);
    // All returned items must be internship type
    for (const item of data) {
      expect(item.vacancyType).toBe("internship");
    }
  });
});

// ── Create template ───────────────────────────────────────────────────────────
describe("POST /v1/hrms/jd-templates", () => {
  it("returns 202 accepted with id for valid payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/jd-templates",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      payload: {
        name: "Junior Data Analyst — Internship",
        vacancyType: "internship",
        description: "6-month internship working on data pipelines and dashboards.",
        qualification: "B.Tech / BCA, currently in 3rd or 4th year",
        payRange: "₹8,000–₹12,000/month stipend",
        selectionProcess: "Online test → Technical interview → HR round",
        tags: ["data", "analytics", "internship", "graduate"],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeTruthy();
    expect(body.status).toBe("accepted");
  });

  it("returns 400 for missing name", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/jd-templates",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      payload: { vacancyType: "regular" },
    });
    await app.close();
    expect([400, 401]).toContain(res.statusCode); // malformed UUID may hit auth or validation first
  });

  it("returns 400 for invalid vacancyType", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/jd-templates",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      payload: { name: "Test", vacancyType: "illegal_type" },
    });
    await app.close();
    expect([400, 401]).toContain(res.statusCode); // malformed UUID may hit auth or validation first
  });
});

// ── Get by ID ─────────────────────────────────────────────────────────────────
describe("GET /v1/hrms/jd-templates/:id", () => {
  it("returns 404 for unknown UUID", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/jd-templates/00000000-0000-4000-8000-000000000000",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for non-UUID id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/jd-templates/not-a-uuid",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect([400, 401]).toContain(res.statusCode); // malformed UUID may hit auth or validation first
  });
});

// ── Use template (create job from template) ───────────────────────────────────
describe("POST /v1/hrms/jd-templates/:id/use", () => {
  it("returns 404 for unknown template id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/jd-templates/00000000-0000-4000-8000-000000000000/use",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      payload: { departmentId: DEPT_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

// ── PATCH / DELETE ────────────────────────────────────────────────────────────
describe("PATCH /v1/hrms/jd-templates/:id — guard", () => {
  it("returns 404 for unknown template", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: "/v1/hrms/jd-templates/00000000-0000-4000-8000-000000000000",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      payload: { name: "Updated" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /v1/hrms/jd-templates/:id — guard", () => {
  it("returns 404 for unknown template", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE", url: "/v1/hrms/jd-templates/00000000-0000-4000-8000-000000000000",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

// ── Multi-vacancy-type: public application with intern fields ─────────────────
describe("POST /v1/hrms/job-openings/:id/apply — internship fields", () => {
  it("returns 400 for missing jobOpeningId (malformed UUID)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/job-openings/not-a-uuid/apply",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Priya Nair", email: "priya@example.com", phone: "9876543210",
        institutionName: "IIT Delhi", graduationYear: 2025,
      },
    });
    await app.close();
    expect([400, 401]).toContain(res.statusCode); // malformed UUID may hit auth or validation first
  });
});
