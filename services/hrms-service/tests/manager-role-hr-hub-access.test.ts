/**
 * Regression coverage for a High finding from the HRMS role-based review:
 * live testing as a user with ONLY the `manager` realm role showed
 * /hr/recruitment, /hr/recruitment/talent-pool, and /hr/onboarding all
 * rendering as broken/blocked.
 *
 * The finding's working hypothesis (by analogy with the earlier HR
 * Dashboard bug, PR #1488/#1494) was that these pages combine multiple
 * fetches under one shared OR'd error flag, so a `manager`'s legitimate
 * rejection from ONE endpoint blanks a DIFFERENT, unrelated, otherwise-
 * successful section. Traced against the actual current route code, that
 * turned out not to be the mechanism here:
 *
 *  - /hr/recruitment fetches GET /job-openings (manager IS included below)
 *    and GET /recruitment/dashboard (manager is NOT, by design — HR-only
 *    stats). Its list section was already correctly gated on the openings
 *    result alone; the only real bug was the page's top DataSourceBadge
 *    claiming "Couldn't load -- showing nothing" off the OR'd flag even
 *    though the openings table genuinely renders real data (fixed in
 *    page.tsx: the badge now gets an accurate message in that case).
 *
 *  - /hr/recruitment/talent-pool and /hr/onboarding each make exactly ONE
 *    fetch, so a shared-OR-flag bug is structurally impossible there.
 *    `manager` gets a real, deliberate, permanent 403 from both endpoints
 *    (HR_ROLES only) -- the bug was the FRONTEND treating that 403
 *    identically to a transient failure (network/500), offering a "try
 *    again" that can never succeed instead of an honest access-restricted
 *    state (fixed in both page.tsx files via the `status` field).
 *
 * This file locks in the route-level half of that: the actual, current
 * role gate on each of the four endpoints these three pages call, for both
 * `manager` and `hr_admin`. It doesn't change any backend authorization —
 * expanding `manager`'s access to talent-pool/onboarding is a real product
 * decision (see PR description), not something this fix makes unilaterally.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-7777-4000-8000-000000000f01";
const ACTOR = "00000000-7777-4000-8000-000000000f02";

function authFor(role: string) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: [role], sid: "s" }, JWT_SECRET, 3600)}` };
}

afterAll(async () => {
  await sqlClient.end();
});

describe("manager-role access across /hr/recruitment, /hr/recruitment/talent-pool, /hr/onboarding's backing routes", () => {
  it("GET /v1/hrms/job-openings — manager IS granted (recruitment page's list section)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/job-openings?limit=100", headers: authFor("manager") });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("GET /v1/hrms/recruitment/dashboard — manager is correctly denied (HR-only stats, not a bug)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/recruitment/dashboard", headers: authFor("manager") });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    await app.close();
  });

  it("GET /v1/hrms/talent-pool — manager is denied (HR-only; page now shows PermissionDenied, not a retry-suggesting error)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/talent-pool?limit=200", headers: authFor("manager") });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    await app.close();
  });

  it("GET /v1/hrms/onboarding — manager is denied (HR-only; page now shows PermissionDenied, not a retry-suggesting error)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/onboarding", headers: authFor("manager") });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    await app.close();
  });

  it("hr_admin (unlike manager) is granted all four — the fix doesn't touch legitimate HR access", async () => {
    const app = await buildApp();
    const urls = [
      "/v1/hrms/job-openings?limit=100",
      "/v1/hrms/recruitment/dashboard",
      "/v1/hrms/talent-pool?limit=200",
      "/v1/hrms/onboarding",
    ];
    for (const url of urls) {
      const res = await app.inject({ method: "GET", url, headers: authFor("hr_admin") });
      expect(res.statusCode, `${url} should be 200 for hr_admin`).toBe(200);
    }
    await app.close();
  });
});
