/**
 * JD Template — end-to-end HTTP contract + validator tests
 *
 * Note: QUEUE_DRIVER=memory means the consumer runs in-memory and does not
 * commit to Postgres; lifecycle steps assert the API contract (202/200/404)
 * not DB state. DB persistence is verified by the running production process.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000011";
const DEPT_ID = "cccccccc-3333-4000-8000-000000000001";
const FAKE_JO_ID = "ffffffff-ffff-4fff-bfff-ffffffffffff";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

function tok(roles: string[] = ["hr_admin"]) {
  return signToken({ sub: "u001", tid: TENANT, roles, sid: "s001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("JD Template HTTP contract", () => {
  it("POST /jd-templates → 202 with id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/jd-templates",
      headers: { authorization: `Bearer ${tok()}`, "content-type": "application/json" },
      payload: { name: "Integration Test Template", vacancyType: "internship" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBeTruthy();
    expect(res.json().status).toBe("accepted");
    await app.close();
  });

  it("GET /jd-templates → 200 with data array", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/jd-templates",
      headers: { authorization: `Bearer ${tok()}` } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
    await app.close();
  });

  it("GET /jd-templates?vacancyType=internship → 200 filtered list", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/jd-templates?vacancyType=internship",
      headers: { authorization: `Bearer ${tok()}` } });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as { vacancyType: string }[];
    for (const t of data) expect(t.vacancyType).toBe("internship");
    await app.close();
  });

  it("GET /jd-templates/:unknownId → 404", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/hrms/jd-templates/${UNKNOWN_ID}`,
      headers: { authorization: `Bearer ${tok()}` } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("PATCH /jd-templates/:unknownId → 404", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: `/v1/hrms/jd-templates/${UNKNOWN_ID}`,
      headers: { authorization: `Bearer ${tok()}`, "content-type": "application/json" },
      payload: { name: "X" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("DELETE /jd-templates/:unknownId → 404", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: `/v1/hrms/jd-templates/${UNKNOWN_ID}`,
      headers: { authorization: `Bearer ${tok()}` } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("POST /jd-templates/:unknownId/use → 404", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/hrms/jd-templates/${UNKNOWN_ID}/use`,
      headers: { authorization: `Bearer ${tok()}`, "content-type": "application/json" },
      payload: { departmentId: DEPT_ID } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("POST /jd-templates → 400 missing departmentId on use (wrong endpoint path)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/jd-templates",
      headers: { authorization: `Bearer ${tok()}`, "content-type": "application/json" },
      payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("Multi-vacancy-type: publicApplicationBody validator", () => {
  it("accepts internship fields (institutionName, graduationYear, semester, stipendExpectedMinor)", async () => {
    const { publicApplicationBody } = await import("../src/modules/recruitment/validators.js");
    const r = publicApplicationBody.safeParse({
      jobOpeningId: FAKE_JO_ID, applicantName: "Rahul Kumar", email: "rahul@college.edu",
      institutionName: "BITS Pilani", graduationYear: 2025, semester: "8th", stipendExpectedMinor: 1000000,
    });
    expect(r.success).toBe(true);
  });

  it("accepts apprenticeship fields (tradeCategory, itiCertNo, availabilityHoursPerWeek)", async () => {
    const { publicApplicationBody } = await import("../src/modules/recruitment/validators.js");
    const r = publicApplicationBody.safeParse({
      jobOpeningId: FAKE_JO_ID, applicantName: "Suresh Yadav", email: "suresh@example.com",
      tradeCategory: "Electrician", itiCertNo: "ITI/2022/DEL/001234", availabilityHoursPerWeek: 40,
    });
    expect(r.success).toBe(true);
  });

  it("accepts volunteership fields (availabilityHoursPerWeek)", async () => {
    const { publicApplicationBody } = await import("../src/modules/recruitment/validators.js");
    const r = publicApplicationBody.safeParse({
      jobOpeningId: FAKE_JO_ID, applicantName: "Anita Sharma", email: "anita@ngo.org",
      availabilityHoursPerWeek: 20,
    });
    expect(r.success).toBe(true);
  });

  it("rejects non-integer graduationYear", async () => {
    const { publicApplicationBody } = await import("../src/modules/recruitment/validators.js");
    const r = publicApplicationBody.safeParse({ jobOpeningId: FAKE_JO_ID, applicantName: "T", email: "t@t.com", graduationYear: 20.5 });
    expect(r.success).toBe(false);
  });

  it("rejects availabilityHoursPerWeek > 168", async () => {
    const { publicApplicationBody } = await import("../src/modules/recruitment/validators.js");
    const r = publicApplicationBody.safeParse({ jobOpeningId: FAKE_JO_ID, applicantName: "T", email: "t@t.com", availabilityHoursPerWeek: 200 });
    expect(r.success).toBe(false);
  });
});
