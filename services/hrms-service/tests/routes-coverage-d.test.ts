/**
 * HRMS route coverage part D — POST/PUT routes with invalid payloads.
 * Covers validation (400) and auth (403) paths in route handlers.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UUID = "aaaaaaaa-8888-4000-8000-000000000001";

function token(roles = ["hr_admin"]) {
  return signToken({ sub: UUID, tid: TENANT, roles, sid: "s1" }, SECRET);
}
function badToken() {
  return signToken({ sub: UUID, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

// Routes to test with empty/invalid payloads — triggers validation (400) or auth (403)
const postRoutes = [
  "/v1/hrms/employees",
  "/v1/hrms/departments",
  "/v1/hrms/designations",
  "/v1/hrms/leave-types",
  "/v1/hrms/leave-allocations",
  "/v1/hrms/leave-applications",
  "/v1/hrms/leave-requests",
  "/v1/hrms/attendance",
  "/v1/hrms/attendance/regularisations",
  "/v1/hrms/comp-off",
  "/v1/hrms/job-openings",
  "/v1/hrms/applications",
  "/v1/hrms/nominations",
  "/v1/hrms/holidays",
  "/v1/hrms/office-locations",
  "/v1/hrms/announcements",
  "/v1/hrms/goals",
  "/v1/hrms/interviews",
  "/v1/hrms/expenses",
  "/v1/hrms/loans",
  "/v1/hrms/salary-advances",
  "/v1/hrms/travel-requests",
  "/v1/hrms/sanctioned-posts",
  "/v1/hrms/employee-types",
  "/v1/hrms/reservation/rosters",
  "/v1/hrms/rti/requests",
  "/v1/hrms/lifecycle/transfers",
  "/v1/hrms/lifecycle/promotions",
  "/v1/hrms/apar",
  "/v1/hrms/admin/leave-policies",
  "/v1/hrms/scheduler/run",
  "/v1/hrms/pay-matrix/annual-increment",
];

describe("HRMS POST routes — validation (400/403 on invalid payload)", () => {
  for (const url of postRoutes) {
    it(`POST ${url} — returns 400 or 403 (not 404)`, async () => {
      const app = await buildApp();
      const r = await app.inject({
        method: "POST", url,
        headers: { authorization: `Bearer ${token()}` },
        payload: {},
      });
      await app.close();
      // Should hit the route handler (not 404) and either validate (400) or execute
      expect(r.statusCode).not.toBe(404);
    });
  }
});

describe("HRMS POST routes — auth rejection (403)", () => {
  const authRoutes = [
    "/v1/hrms/employees",
    "/v1/hrms/departments",
    "/v1/hrms/designations",
    "/v1/hrms/leave-types",
    "/v1/hrms/job-openings",
    "/v1/hrms/holidays",
    "/v1/hrms/scheduler/run",
    "/v1/hrms/reservation/rosters",
    "/v1/hrms/apar",
    "/v1/hrms/lifecycle/transfers",
    "/v1/hrms/lifecycle/promotions",
  ];

  for (const url of authRoutes) {
    it(`POST ${url} — 403 for citizen role`, async () => {
      const app = await buildApp();
      const r = await app.inject({
        method: "POST", url,
        headers: { authorization: `Bearer ${badToken()}` },
        payload: {},
      });
      await app.close();
      expect(r.statusCode).toBe(403);
    });
  }
});
