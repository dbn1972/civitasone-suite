/**
 * ml-recruitment-03 route contracts (mock-based; the SQL itself is covered by
 * recruitment-ml03-real-db.test.ts):
 *  - GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-05/06: GET /v1/hrms/applications/:id
 *    (HR only, tenant-scoped, DOB for hr_admin/super_admin only, never mobile)
 *  - GAP-RECRUITMENT-TALENT-POOL-05: talent-pool pagination (total / limit / offset)
 *  - GAP-RECRUITMENT-NEW-02: structured pay validation on createJobOpeningBody
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const H = vi.hoisted(() => ({ audit: vi.fn(), roles: ["hr_admin"] as string[], tenant: "aaaaaaaa-0001-4000-8000-00000000a001", findApp: vi.fn(), search: vi.fn() }));

vi.mock("../src/shared/context.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  resolveContext: () => ({ tenantId: H.tenant, roles: H.roles, userId: "u1", actorId: "u1", correlationId: "c1" }),
}));
vi.mock("../src/shared/audit.js", () => ({ writeAuditLog: (...a: unknown[]) => H.audit(...a) }));
vi.mock("../src/modules/recruitment/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findApplicationById: (...a: unknown[]) => H.findApp(...a),
  searchApplications: (...a: unknown[]) => H.search(...a),
}));

import { recruitmentRoutes } from "../src/modules/recruitment/routes.js";
import { createJobOpeningBody } from "../src/modules/recruitment/validators.js";
import { escapeLikePattern } from "../src/modules/recruitment/repo.js";

const APP_ID = "11111111-0001-4000-8000-000000000001";
const JOB_ID = "22222222-0001-4000-8000-000000000002";
const ROW = {
  id: APP_ID, jobOpeningId: JOB_ID, applicationNo: "REC/2026/0042", applicantName: "Asha Verma", email: "asha@example.com",
  mobile: "9876543210", resumeRef: "ref", resumeFileKey: null, qualification: "B.Com", experienceYears: 3, skills: ["tally"],
  source: "public_portal", stage: "applied", status: "active", screeningDecision: "pending",
  appliedAt: new Date("2026-03-01T10:00:00Z"), category: "OBC", dateOfBirth: "1995-04-12",
};

async function build() {
  const app = Fastify();
  await app.register(recruitmentRoutes);
  return app;
}

beforeEach(() => {
  H.roles = ["hr_admin"];
  H.findApp.mockReset();
  H.search.mockReset();
  H.audit.mockReset();
});

describe("GET /v1/hrms/applications/:id", () => {
  it("returns one application to an HR user, scoped to the caller's tenant, without mobile", async () => {
    H.findApp.mockResolvedValue(ROW);
    const app = await build();
    const res = await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP_ID}` });
    expect(res.statusCode).toBe(200);
    expect(H.findApp).toHaveBeenCalledWith(APP_ID, H.tenant);
    const body = res.json();
    expect(body).toMatchObject({ id: APP_ID, jobOpeningId: JOB_ID, applicationNo: "REC/2026/0042", category: "OBC", hasResume: true, stage: "applied" });
    expect(res.body).not.toContain("9876543210");
    expect(body).not.toHaveProperty("mobile");
    expect(body).not.toHaveProperty("resumeRef");
    await app.close();
  });

  it("returns dateOfBirth to hr_admin and super_admin", async () => {
    H.findApp.mockResolvedValue(ROW);
    for (const role of ["hr_admin", "super_admin"]) {
      H.roles = [role];
      const app = await build();
      const res = await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP_ID}` });
      expect(res.json().dateOfBirth).toBe("1995-04-12");
      await app.close();
    }
  });

  it("withholds dateOfBirth (null) from hr_officer", async () => {
    H.findApp.mockResolvedValue(ROW);
    H.roles = ["hr_officer"];
    const app = await build();
    const res = await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP_ID}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().dateOfBirth).toBeNull();
    expect(res.body).not.toContain("1995-04-12");
    await app.close();
  });

  it("writes a read-audit entry with actor, application id and whether DOB was included", async () => {
    H.findApp.mockResolvedValue(ROW);
    for (const [role, dob] of [["hr_admin", "included"], ["hr_officer", "withheld"]]) {
      H.roles = [role];
      const app = await build();
      await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP_ID}` });
      await app.close();
      expect(H.audit).toHaveBeenLastCalledWith(expect.objectContaining({
        tenantId: H.tenant, actorId: "u1", actorRoles: [role], method: "GET", statusCode: 200,
        path: `/v1/hrms/applications/${APP_ID}?dob=${dob}`,
      }));
    }
  });

  it("writes no audit entry for a 404 or a 403", async () => {
    H.findApp.mockResolvedValue(null);
    let app = await build();
    await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP_ID}` });
    await app.close();
    H.roles = ["manager"];
    app = await build();
    await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP_ID}` });
    await app.close();
    expect(H.audit).not.toHaveBeenCalled();
  });

  it("is 403 for non-HR roles (manager, employee) and never reads the record", async () => {
    for (const role of ["manager", "employee"]) {
      H.roles = [role];
      const app = await build();
      const res = await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP_ID}` });
      expect(res.statusCode).toBe(403);
      await app.close();
    }
    expect(H.findApp).not.toHaveBeenCalled();
  });

  it("is 404 when the application is not in the caller's tenant (repo returns null)", async () => {
    H.findApp.mockResolvedValue(null);
    const app = await build();
    const res = await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP_ID}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("is 400 for a non-UUID id", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/applications/not-a-uuid" });
    expect(res.statusCode).toBe(400);
    expect(H.findApp).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("GET /v1/hrms/talent-pool pagination (TALENT-POOL-05)", () => {
  it("passes limit/offset to the repo and returns total, limit, offset", async () => {
    H.search.mockResolvedValue({ rows: [ROW], total: 137 });
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/talent-pool?limit=50&offset=100&skill=excel&minExp=2&source=internal" });
    expect(res.statusCode).toBe(200);
    expect(H.search).toHaveBeenCalledWith(
      H.tenant,
      expect.objectContaining({ skill: "excel", minExp: 2, source: "internal" }),
      50,
      100,
    );
    expect(res.json()).toMatchObject({ total: 137, limit: 50, offset: 100 });
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0]).not.toHaveProperty("mobile");
    await app.close();
  });

  it("defaults to limit 100 / offset 0 and caps limit at 200", async () => {
    H.search.mockResolvedValue({ rows: [], total: 0 });
    const app = await build();
    await app.inject({ method: "GET", url: "/v1/hrms/talent-pool" });
    expect(H.search.mock.calls[0].slice(2)).toEqual([100, 0]);
    await app.inject({ method: "GET", url: "/v1/hrms/talent-pool?limit=9999" });
    expect(H.search.mock.calls[1][2]).toBe(200);
    await app.close();
  });

  it("minExp accepts 1-3 digits only", async () => {
    H.search.mockResolvedValue({ rows: [], total: 0 });
    const app = await build();
    expect((await app.inject({ method: "GET", url: "/v1/hrms/talent-pool?minExp=999" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/hrms/talent-pool?minExp=1000" })).statusCode).toBe(400);
    await app.close();
  });

  it("rejects a non-numeric offset (400)", async () => {
    const app = await build();
    const res = await app.inject({ method: "GET", url: "/v1/hrms/talent-pool?offset=abc" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("createJobOpeningBody structured pay (NEW-02)", () => {
  const base = { refNo: "R-1", title: "T", departmentId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" };
  it("accepts level + paise strings", () => {
    const r = createJobOpeningBody.parse({ ...base, payLevel: "10", payMinMinor: "5610000", payMaxMinor: "17750000" });
    expect(r.payMinMinor).toBe("5610000");
  });
  it("rejects min above max", () => {
    expect(() => createJobOpeningBody.parse({ ...base, payMinMinor: "900", payMaxMinor: "100" })).toThrow(/must not exceed/);
  });
  it("rejects JS numbers, decimals and negatives for paise (strings of digits only)", () => {
    expect(() => createJobOpeningBody.parse({ ...base, payMinMinor: 100 })).toThrow();
    expect(() => createJobOpeningBody.parse({ ...base, payMinMinor: "10.5" })).toThrow();
    expect(() => createJobOpeningBody.parse({ ...base, payMaxMinor: "-5" })).toThrow();
  });
  it("accepts min == max and a one-sided range", () => {
    expect(() => createJobOpeningBody.parse({ ...base, payMinMinor: "500", payMaxMinor: "500" })).not.toThrow();
    expect(() => createJobOpeningBody.parse({ ...base, payMinMinor: "500" })).not.toThrow();
  });
});

describe("escapeLikePattern", () => {
  it("escapes %, _ and backslash so a skill search is a literal substring match", () => {
    expect(escapeLikePattern("100%_a\\b")).toBe("100\\%\\_a\\\\b");
    expect(escapeLikePattern("excel")).toBe("excel");
  });
});
