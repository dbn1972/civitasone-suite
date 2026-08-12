/**
 * Smoke tests for 6 gap backend routes added 2026-08-12.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000011";

function makeToken(roles: string[] = ["hr_admin"]) {
  return signToken({ sub: "user-hrms-001", tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

const GAP_ROUTES = [
  { path: "/v1/hrms/certifications", role: "hr_admin" },
  { path: "/v1/hrms/grievances", role: "hr_admin" },
  { path: "/v1/hrms/skills", role: "hr_admin" },
  { path: "/v1/hrms/staffing-plan", role: "hr_admin" },
  { path: "/v1/hrms/vigilance", role: "hr_admin" },
  { path: "/v1/hrms/work-summaries", role: "hr_admin" },
];

for (const { path } of GAP_ROUTES) {
  describe(`GET ${path}`, () => {
    it("returns 200 with data array", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET", url: path,
        headers: { authorization: `Bearer ${makeToken()}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("data");
      expect(Array.isArray(body.data)).toBe(true);
    });

    it("returns 401 without token", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: path });
      expect(res.statusCode).toBe(401);
    });
  });
}
