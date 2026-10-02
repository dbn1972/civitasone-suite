/**
 * Recruitment queries unit tests — mock-based.
 *
 * HR-A deep-verify finding: listJobOpenings() collapsed every job-opening
 * status other than "closed"/"on_hold" to "open", including "cancelled"
 * (publication-repo.ts updateVacancy), and "rejected"/"approved"/
 * "pending_approval" (eoffice-consumer.ts updateJobOpening) — all real
 * statuses a hrms_job_openings row can hold. A cancelled or eOffice-rejected
 * vacancy would have displayed as "Open" on /hr/recruitment. These tests
 * pin the fixed mapping in queries.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { listJobOpeningsByTenantMock, countApplicationsByJobMock, findPublishedOpeningMock } = vi.hoisted(() => ({
  listJobOpeningsByTenantMock: vi.fn(),
  findPublishedOpeningMock: vi.fn(),
  countApplicationsByJobMock: vi.fn(async () => new Map()),
}));

vi.mock("../src/modules/recruitment/repo.js", () => ({
  listJobOpeningsByTenant: (...a: unknown[]) => listJobOpeningsByTenantMock(...a),
  countApplicationsByJob: (...a: unknown[]) => countApplicationsByJobMock(...a),
  findPublishedOpening: (...a: unknown[]) => findPublishedOpeningMock(...a),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    listOrLoad: async (_t: string, _ns: string, _k: string, fn: () => Promise<unknown>) => fn(),
  },
}));

vi.mock("../src/shared/db.js", () => ({ db: {} }));

vi.mock("@civitasone/db", () => ({
  withTenantScope: async (_db: unknown, _tenantId: string, fn: (tx: unknown) => unknown) =>
    fn({ select: () => ({ from: () => ({ where: async () => [] }) }) }),
}));

import { listJobOpenings, getPublishedVacancy } from "../src/modules/recruitment/queries.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";

function row(overrides: Partial<Record<string, unknown>>) {
  return {
    id: `job-${Math.random()}`,
    title: "Test Post",
    departmentId: "d1",
    vacancies: 1,
    closesAt: null,
    postedAt: "2026-01-01",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    status: "open",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  countApplicationsByJobMock.mockResolvedValue(new Map());
});

describe("listJobOpenings — status mapping (HR-A deep-verify)", () => {
  it("passes through a genuinely open vacancy as open", async () => {
    listJobOpeningsByTenantMock.mockResolvedValue([row({ id: "j1", status: "open" })]);
    const rows = await listJobOpenings(TENANT, 100);
    expect(rows[0].status).toBe("open");
  });

  it("passes through on_hold as on_hold", async () => {
    listJobOpeningsByTenantMock.mockResolvedValue([row({ id: "j2", status: "on_hold" })]);
    const rows = await listJobOpenings(TENANT, 100);
    expect(rows[0].status).toBe("on_hold");
  });

  it("maps a cancelled vacancy to closed, never open (publication-repo.ts updateVacancy sets status='cancelled')", async () => {
    listJobOpeningsByTenantMock.mockResolvedValue([row({ id: "j3", status: "cancelled" })]);
    const rows = await listJobOpenings(TENANT, 100);
    expect(rows[0].status).toBe("closed");
    expect(rows[0].status).not.toBe("open");
  });

  it("maps eOffice-rejected, eOffice-approved, and pending_approval vacancies to closed, never open", async () => {
    listJobOpeningsByTenantMock.mockResolvedValue([
      row({ id: "j4", status: "rejected" }),
      row({ id: "j5", status: "approved" }),
      row({ id: "j6", status: "pending_approval" }),
    ]);
    const rows = await listJobOpenings(TENANT, 100);
    for (const r of rows) {
      expect(r.status).toBe("closed");
      expect(r.status).not.toBe("open");
    }
  });
});

describe("listJobOpenings — refNo / vacancyType (GAP-RECRUITMENT-DETAIL-01)", () => {
  it("returns refNo and vacancyType, and the HTTP schema keeps them", async () => {
    listJobOpeningsByTenantMock.mockResolvedValue([row({ id: "j9", refNo: "HUD/2026/014", vacancyType: "internship" })]);
    const rows = await listJobOpenings(TENANT, 100);
    expect(rows[0]).toMatchObject({ refNo: "HUD/2026/014", vacancyType: "internship" });
    const { JobOpeningSummaryListSchema } = await import("@civitasone/schemas/web");
    const parsed = JobOpeningSummaryListSchema.parse(JSON.parse(JSON.stringify(rows)));
    expect(parsed[0]).toMatchObject({ refNo: "HUD/2026/014", vacancyType: "internship" });
  });
});

// ── GAP-RECRUITMENT-CAREERS-DETAIL-08: public vacancy payload carries the server's open/closed verdict ──
describe("getPublishedVacancy — applicationOpen", () => {
  const base = {
    id: "v1", title: "Assistant", refNo: "R1", vacancyType: "regular", location: null, qualification: null,
    payRange: null, vacancies: 2, description: null, postedAt: null, closesAt: null,
    status: "open", isPublished: true, applicationDeadline: null,
  };

  it("is open when published, open and no deadline", async () => {
    findPublishedOpeningMock.mockResolvedValue({ ...base });
    const v = await getPublishedVacancy("v1", TENANT);
    expect(v?.applicationOpen).toBe(true);
    expect(v?.closedReason).toBeUndefined();
  });

  it("is closed with a reason once the precise applicationDeadline has passed, even if closesAt (a date) is in the future", async () => {
    findPublishedOpeningMock.mockResolvedValue({ ...base, closesAt: "2099-01-01", applicationDeadline: new Date(Date.now() - 60_000) });
    const v = await getPublishedVacancy("v1", TENANT);
    expect(v?.applicationOpen).toBe(false);
    expect(v?.closedReason).toBe("the application deadline has passed");
  });

  it("returns null for an unpublished/unknown vacancy", async () => {
    findPublishedOpeningMock.mockResolvedValue(null);
    expect(await getPublishedVacancy("v1", TENANT)).toBeNull();
  });
});
