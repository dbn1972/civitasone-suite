/**
 * UAT #2445 review item 7: GET /v1/payroll/tax-declarations from a user with no linked
 * employee record answered 403 FORBIDDEN, the same code as a role refusal, so the tax
 * declaration screen showed "no employee record" for every 403. The no-record case now
 * carries its own code (NO_EMPLOYEE_RECORD); a role refusal stays a plain 403.
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveActorEmployeeId: vi.fn(async () => null) };
});

afterAll(async () => { await sqlClient.end(); });

const tok = (roles: string[]) => `Bearer ${signToken({ sub: randomUUID(), tid: TENANT, roles, sid: "s-2445-7" }, SECRET)}`;

describe("tax declaration: no linked employee record (UAT #2445 review item 7)", () => {
  it("answers 403 NO_EMPLOYEE_RECORD for a self-service user with no employee record", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/payroll/tax-declarations?fy=2026-27", headers: { authorization: tok(["employee"]) } });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { code: string }).code).toBe("NO_EMPLOYEE_RECORD");
    } finally {
      await app.close();
    }
  });

  it("a caller without any reader role still gets a plain 403, not NO_EMPLOYEE_RECORD", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/payroll/tax-declarations?fy=2026-27", headers: { authorization: tok(["visitor_officer"]) } });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { code: string }).code).not.toBe("NO_EMPLOYEE_RECORD");
    } finally {
      await app.close();
    }
  });
});
