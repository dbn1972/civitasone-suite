/**
 * hrms-service — GAP-HR-WORKFORCE-07 regression test.
 *
 * Retirement age used to be two independent `const retirementAge = 60`
 * literals (one in vacancy-forecast, one in retirement-forecast) plus a
 * THIRD hardcoded copy as the literal SQL string '60 years' inside
 * retirement-forecast's `groupExpr` -- three places that could silently
 * diverge if only one were ever edited, with no tenant-configurability.
 *
 * Both endpoints now derive the value they report from the SAME
 * module-level `RETIREMENT_AGE_YEARS` constant (see routes.ts), exposed as
 * `meta.retirementAge`. This test can't literally "change the constant and
 * observe both responses move" from outside the module, so it asserts the
 * next best thing: both endpoints report the identical value, across every
 * `groupExpr` branch (month/quarter/year) -- which only stays true for as
 * long as all of them actually read from one shared source.
 *
 * (Consolidating the duplicated literal is the code-quality part of
 * WORKFORCE-07, done here. Whether different tenant editions or employee
 * categories should retire at a different, tenant-configurable age is a
 * genuine business-policy call left open -- not implemented.)
 */
import { describe, it, expect } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "0a1a5e00-4000-4000-8000-000000000803";
const ACTOR = "0a1a5e00-5000-4000-8000-000000000803";

function authHeader(roles = ["hr_officer", "super_admin"]) {
  const token = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-wfp-age" }, SECRET, 3600);
  return { authorization: `Bearer ${token}` };
}

describe("workforce-planning retirement age constant (GAP-HR-WORKFORCE-07)", () => {
  it("vacancy-forecast and retirement-forecast report the identical retirementAge in meta", async () => {
    const app = await buildApp();
    try {
      const [vacancy, retirement] = await Promise.all([
        app.inject({ method: "GET", url: "/v1/hrms/workforce/vacancy-forecast", headers: authHeader() }),
        app.inject({ method: "GET", url: "/v1/hrms/workforce/retirement-forecast", headers: authHeader() }),
      ]);

      expect(vacancy.statusCode).toBe(200);
      expect(retirement.statusCode).toBe(200);

      const vacancyMeta = vacancy.json().meta as { retirementAge: number };
      const retirementMeta = retirement.json().meta as { retirementAge: number };

      expect(vacancyMeta.retirementAge).toBe(60);
      expect(retirementMeta.retirementAge).toBe(60);
      expect(vacancyMeta.retirementAge).toBe(retirementMeta.retirementAge);
    } finally {
      await app.close();
    }
  });

  it("retirement-forecast reports the same retirementAge across every groupExpr branch (month/quarter/year)", async () => {
    const app = await buildApp();
    try {
      const [month, quarter, year] = await Promise.all([
        app.inject({ method: "GET", url: "/v1/hrms/workforce/retirement-forecast?granularity=month", headers: authHeader() }),
        app.inject({ method: "GET", url: "/v1/hrms/workforce/retirement-forecast?granularity=quarter", headers: authHeader() }),
        app.inject({ method: "GET", url: "/v1/hrms/workforce/retirement-forecast?granularity=year", headers: authHeader() }),
      ]);

      for (const res of [month, quarter, year]) {
        expect(res.statusCode).toBe(200);
        expect(res.json().meta.retirementAge).toBe(60);
      }
    } finally {
      await app.close();
    }
  });
});
