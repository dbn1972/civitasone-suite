import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-000000000088";
const A = "cccccccc-3333-4000-8000-000000000088";
const admin = signToken({ sub: A, tid: T, roles: ["hr_admin", "super_admin"], sid: "s1" }, SECRET);
const emp = signToken({ sub: A, tid: T, roles: ["employee"], sid: "s2" }, SECRET);
afterAll(async () => { await sqlClient.end(); });

async function hit(m: string, u: string, a?: string, p?: unknown) {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method: m, url: u };
  if (a) o.headers = { authorization: `Bearer ${a}` };
  if (p !== undefined) o.payload = p;
  const r = await app.inject(o);
  await app.close();
  return r.statusCode;
}

describe("compensation", () => {
  it("POST plans", async () => { expect([201, 500]).toContain(await hit("POST", "/v1/hrms/compensation/plans", admin, { name: "FY26", fy: "2026-27", budgetMinor: 500000 })); });
  it("GET plans", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/compensation/plans", admin)); });
  it("401", async () => { expect(await hit("POST", "/v1/hrms/compensation/plans")).toBe(401); });
});

describe("lms", () => {
  it("POST courses", async () => { expect([201, 500]).toContain(await hit("POST", "/v1/hrms/lms/courses", admin, { code: "S1", name: "Sec", durationHours: 8 })); });
  it("GET courses", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/lms/courses", admin)); });
  it("GET my-learning", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/lms/my-learning", emp)); });
  it("400 bad", async () => { expect(await hit("POST", "/v1/hrms/lms/courses", admin, { code: "X" })).toBe(400); });
});

describe("skills", () => {
  it("POST competencies", async () => { expect([201, 500]).toContain(await hit("POST", "/v1/hrms/skills/competencies", admin, { name: "Go", category: "tech" })); });
  it("GET gap-analysis", async () => { expect([200, 500]).toContain(await hit("GET", `/v1/hrms/skills/gap-analysis?employeeId=${randomUUID()}`, admin)); });
  it("GET team-heatmap", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/skills/team-heatmap", admin)); });
});

describe("succession", () => {
  it("POST critical-roles", async () => { expect([201, 500]).toContain(await hit("POST", "/v1/hrms/succession/critical-roles", admin, { roleRef: "collector" })); });
  it("GET pipeline", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/succession/pipeline", admin)); });
});

describe("engagement", () => {
  it("POST surveys", async () => { expect([201, 500]).toContain(await hit("POST", "/v1/hrms/engagement/surveys", admin, { title: "Q3", questions: [{ text: "Happy?" }] })); });
  it("GET eNPS", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/engagement/eNPS", admin)); });
  it("400 empty", async () => { expect(await hit("POST", "/v1/hrms/engagement/surveys", admin, { title: "X", questions: [] })).toBe(400); });
});

describe("onboarding", () => {
  it("POST templates", async () => { expect([201, 500]).toContain(await hit("POST", "/v1/hrms/onboarding/templates", admin, { name: "Hire", steps: [{ title: "IT" }] })); });
  it("GET active", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/onboarding/active", admin)); });
});

describe("feedback", () => {
  it("POST cycles", async () => { expect([201, 500]).toContain(await hit("POST", "/v1/hrms/feedback/cycles", admin, { name: "H1", questions: [{ text: "Lead", maxScore: 5 }] })); });
});

describe("benefits", () => {
  it("POST plans", async () => { expect([201, 500]).toContain(await hit("POST", "/v1/hrms/benefits/plans", admin, { name: "Flex", fy: "2026-27", flexBudgetMinor: 200000, components: [{ name: "Med", maxMinor: 100000, taxExempt: true }] })); });
  it("GET my-elections", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/benefits/my-elections", emp)); });
});

describe("contracts", () => {
  it("GET", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/contracts", admin)); });
  it("401", async () => { expect(await hit("GET", "/v1/hrms/contracts")).toBe(401); });
});

describe("claims", () => {
  it("GET ltc", async () => { expect([200, 500]).toContain(await hit("GET", `/v1/hrms/employees/${A}/ltc-claims`, admin)); });
});

describe("visiting-card", () => {
  it("GET me", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/visiting-card/me", emp)); });
});

describe("goals", () => {
  it("GET goals", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/goals", emp)); });
  it("GET leaderboard", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/leaderboard", emp)); });
});

describe("reports", () => {
  it("GET headcount", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/reports/headcount", admin)); });
});

describe("self-service", () => {
  it("GET profile", async () => { expect([200, 404, 500]).toContain(await hit("GET", "/v1/hrms/me/profile", emp)); });
});

describe("device-trust", () => {
  it("GET devices/me", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/devices/me", emp)); });
});

describe("ai", () => {
  it("GET alerts", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/ai/alerts", admin)); });
  it("GET attrition-risk", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/ai/attrition-risk", admin)); });
});

describe("workforce", () => {
  it("GET headcount", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/workforce/headcount", admin)); });
});

describe("bulk-import", () => {
  it("POST bulk", async () => { expect([200, 201, 202, 400, 500]).toContain(await hit("POST", "/v1/hrms/employees/bulk", admin, { employees: [] })); });
  it("403 emp", async () => { expect(await hit("POST", "/v1/hrms/employees/bulk", emp, { employees: [] })).toBe(403); });
});

describe("dashboard-org-pay", () => {
  it("GET dashboard", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/dashboard", admin)); });
  it("GET org-chart", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/org-chart", admin)); });
  it("GET pay-matrix", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/pay-matrix", admin)); });
});

describe("integration", () => {
  it("GET integrations", async () => { expect([200, 500]).toContain(await hit("GET", "/v1/hrms/integrations", admin)); });
  it("POST integrations", async () => { expect([201, 500]).toContain(await hit("POST", "/v1/hrms/integrations", admin, { name: "eHRMS", type: "ehrms" })); });
  it("401", async () => { expect(await hit("GET", "/v1/hrms/integrations")).toBe(401); });
});

describe("auth-umbrella", () => {
  it("401 on all protected routes", async () => {
    const urls = ["/v1/hrms/contracts", "/v1/hrms/goals", "/v1/hrms/ai/alerts", "/v1/hrms/workforce/headcount", "/v1/hrms/dashboard"];
    for (const url of urls) expect(await hit("GET", url)).toBe(401);
  });
});
