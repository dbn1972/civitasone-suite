/**
 * h8-recruitment batch route contracts:
 *  - GAP-RECRUITMENT-TALENT-POOL-02: talent-pool response carries no mobile number
 *  - GAP-RECRUITMENT-DETAIL-APPLICATIONS-APPLICATION-02: applications list exposes applicationNo
 */
import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";

const H = vi.hoisted(() => ({ search: vi.fn(), list: vi.fn() }));

vi.mock("../src/shared/context.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  resolveContext: () => ({ tenantId: "aaaaaaaa-0001-4000-8000-00000000a001", roles: ["hr_admin"], userId: "u1" }),
  requireRole: () => undefined,
}));
vi.mock("../src/modules/recruitment/settings-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  getSettings: async () => ({ organisationName: null, departmentName: null, emblemUrl: null, offerWorkflowRequired: true, applicantPurposeNote: "Held for 12 months." }),
}));
vi.mock("../src/modules/recruitment/settings-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  getSettings: async () => ({ organisationName: null, departmentName: null, emblemUrl: null, offerWorkflowRequired: true, applicantPurposeNote: "Held for 12 months." }),
}));
vi.mock("../src/modules/recruitment/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  searchApplications: (...a: unknown[]) => H.search(...a),
}));
vi.mock("../src/modules/recruitment/screening-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  listApplicationsForVacancy: (...a: unknown[]) => H.list(...a),
}));

import { recruitmentRoutes } from "../src/modules/recruitment/routes.js";

const ROW = {
  id: "11111111-0001-4000-8000-000000000001", applicationNo: "REC/2026/0042", applicantName: "Asha Verma", email: "asha@example.com",
  mobile: "9876543210", qualification: "B.Com", experienceYears: 3, skills: ["tally"], source: "public_portal", stage: "applied",
  screeningDecision: "pending", jobOpeningId: "22222222-0001-4000-8000-000000000002", appliedAt: new Date("2026-03-01T10:00:00Z"), category: null,
};

describe("recruitment routes (h8 batch)", () => {
  it("GET /v1/hrms/talent-pool never returns mobile", async () => {
    H.search.mockResolvedValue({ rows: [ROW], total: 1 });
    const app = Fastify();
    await app.register(recruitmentRoutes);
    const res = await app.inject({ method: "GET", url: "/v1/hrms/talent-pool?limit=10" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("9876543210");
    expect(res.json().data[0]).not.toHaveProperty("mobile");
    // GAP-RECRUITMENT-TALENT-POOL-02: the full address is not in the payload any more (audited reveal only).
    expect(res.json().data[0].email).toBe("a***@e***.com");
    expect(res.json().purposeNote).toBe("Held for 12 months.");
    expect(res.json().purposeNote).toBe("Held for 12 months.");
    expect(res.body).not.toContain("asha@example.com");
    await app.close();
  });

  it("GET /v1/hrms/job-openings/:id/applications includes applicationNo", async () => {
    H.list.mockResolvedValue([ROW]);
    const app = Fastify();
    await app.register(recruitmentRoutes);
    const res = await app.inject({ method: "GET", url: "/v1/hrms/job-openings/22222222-0001-4000-8000-000000000002/applications" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].applicationNo).toBe("REC/2026/0042");
    await app.close();
  });
});
