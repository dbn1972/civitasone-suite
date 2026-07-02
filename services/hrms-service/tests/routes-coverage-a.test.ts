/**
 * Route coverage tests — Part A
 *
 * Covers: employee, attendance, leave, appraisals, orgchart, dashboard,
 *         training, recruitment, reports modules.
 *
 * Each route is tested for:
 *   - 200 with valid token (or 404 for entity-specific routes with unknown IDs)
 *   - 401 without token
 *   - 403 with wrong role
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const FAKE_UUID = "00000000-0000-4000-8000-ffffffffffff";

function makeToken(roles: string[] = ["hr_admin"], sub = "user-cov-001") {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-cov-a" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

// ═══════════════════════════════════════════════════════════════════════
// EMPLOYEE MODULE
// ═══════════════════════════════════════════════════════════════════════

describe("GET /v1/hrms/employees", () => {
  it("returns 200 with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/employees",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/employees" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/employees",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/hrms/employees/:id", () => {
  it("returns 404 for unknown employee id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/hrms/employees/${FAKE_UUID}`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/hrms/employees/${FAKE_UUID}` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/hrms/employees/${FAKE_UUID}`,
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/hrms/departments", () => {
  it("returns 200 with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/departments",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/departments" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/departments",
      headers: { authorization: `Bearer ${makeToken(["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/hrms/designations", () => {
  it("returns 200 with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/designations",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/designations" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/designations",
      headers: { authorization: `Bearer ${makeToken(["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ATTENDANCE MODULE
// ═══════════════════════════════════════════════════════════════════════

describe("GET /v1/hrms/attendance", () => {
  it("returns 200 with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/attendance",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/attendance" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/attendance",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/hrms/attendance/summary", () => {
  it("returns 200 with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/attendance/summary",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/attendance/summary" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/attendance/summary",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// LEAVE MODULE
// ═══════════════════════════════════════════════════════════════════════

describe("GET /v1/hrms/leave-applications", () => {
  it("returns 200 with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/leave-applications",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/leave-applications" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/leave-applications",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/hrms/leave-allocations", () => {
  it("returns 200 with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/leave-allocations",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/leave-allocations" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/leave-allocations",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/hrms/leave-types", () => {
  it("returns 200 with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/leave-types",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/leave-types" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/leave-types",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// APPRAISALS MODULE
// ═══════════════════════════════════════════════════════════════════════

describe("GET /v1/hrms/appraisals", () => {
  it("returns 200 with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/appraisals",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/appraisals" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/appraisals",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ORGCHART MODULE
// ═══════════════════════════════════════════════════════════════════════

describe("GET /v1/hrms/org-chart", () => {
  it("returns 200 with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/org-chart",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/org-chart" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/org-chart",
      headers: { authorization: `Bearer ${makeToken(["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DASHBOARD MODULE
// ═══════════════════════════════════════════════════════════════════════

describe("GET /v1/hrms/dashboard", () => {
  it("returns 200 with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/dashboard",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/dashboard" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/dashboard",
      headers: { authorization: `Bearer ${makeToken(["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TRAINING MODULE
// ═══════════════════════════════════════════════════════════════════════

describe("GET /v1/hrms/training-programs", () => {
  it("returns 200 with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/training-programs",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 200 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/training-programs",
      headers: { authorization: `Bearer ${makeToken(["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/training-programs" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/training-programs",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// RECRUITMENT MODULE
// ═══════════════════════════════════════════════════════════════════════

describe("GET /v1/hrms/job-openings", () => {
  it("returns 200 with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/job-openings",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/job-openings" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/job-openings",
      headers: { authorization: `Bearer ${makeToken(["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/hrms/talent-pool", () => {
  it("returns 200 with valid token (hr_admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/talent-pool",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/talent-pool" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for manager role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/talent-pool",
      headers: { authorization: `Bearer ${makeToken(["manager"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/hrms/recruitment/dashboard", () => {
  it("returns 200 with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/recruitment/dashboard",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/recruitment/dashboard" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/recruitment/dashboard",
      headers: { authorization: `Bearer ${makeToken(["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// REPORTS MODULE
// ═══════════════════════════════════════════════════════════════════════

describe("GET /v1/hrms/reports/headcount", () => {
  it("returns 200 with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/reports/headcount",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/reports/headcount" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/reports/headcount",
      headers: { authorization: `Bearer ${makeToken(["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/hrms/reports/leave-balance", () => {
  it("returns 200 with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/reports/leave-balance",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/reports/leave-balance" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/reports/leave-balance",
      headers: { authorization: `Bearer ${makeToken(["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/hrms/reports/absentees", () => {
  it("returns 200 with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/reports/absentees",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/reports/absentees" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/reports/absentees",
      headers: { authorization: `Bearer ${makeToken(["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/hrms/reports/seniority", () => {
  it("returns 200 with valid token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/reports/seniority",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/reports/seniority" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/hrms/reports/seniority",
      headers: { authorization: `Bearer ${makeToken(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
