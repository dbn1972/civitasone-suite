import { describe, it, expect, vi } from "vitest";
import type { ProjectRow } from "./schema.js";
import { listProjectSummaries } from "./queries.js";

// listProjectSummaries()/mapProjectRow() are exercised here against their
// REAL implementation, with only their direct data-access dependencies
// stubbed out. tests/all-routes.test.ts (the route-inject coverage suite)
// mocks ../src/modules/project/queries.js wholesale, so it can only ever
// prove routing/auth wiring for GET /v1/projects/projects -- it structurally
// cannot exercise this mapping logic, which is exactly where the ISSUE-8
// bugs lived: totalBudget/expenditure read the wrong column AND were
// converted to the wrong units, and rag was never sent to callers at all.
const mockListProjects = vi.fn();
vi.mock("./repo.js", () => ({
  listProjects: (...args: unknown[]) => mockListProjects(...args),
}));
vi.mock("../scheme/repo.js", () => ({
  findSchemesByIds: async () => [],
}));
vi.mock("../../shared/infra.js", () => ({
  cache: {
    getOrLoad: async <T,>(_k: string, loader: () => Promise<T>) => loader(),
    makeKey: (...args: string[]) => args.join(":"),
  },
}));

function projectRow(overrides: Partial<ProjectRow>): ProjectRow {
  return {
    id: "p1", tenantId: "t1", code: "PRJ-1", name: "Highway Project",
    schemeId: null, agencyRef: null,
    // Rs 50,000 DPR estimate vs Rs 45,000 sanctioned -- deliberately
    // different so a regression back to dprCostMinor is caught, not just
    // coincidentally equal.
    dprCostMinor: 5000000n, sanctionedMinor: 4500000n, sanctionRef: null,
    currency: "INR", status: "active",
    startDate: "2026-01-01", endDate: "2027-12-31",
    physicalPct: "0.00", financialPct: "0.00",
    rag: "green",
    createdAt: new Date("2026-08-12T19:17:08.654Z"),
    updatedAt: new Date("2026-08-12T19:17:08.654Z"),
    createdBy: "u1", updatedBy: "u1", version: 1,
    ...overrides,
  } satisfies ProjectRow;
}

describe("listProjectSummaries / mapProjectRow", () => {
  it("maps totalBudget from the sanctioned amount, in minor units (paise) -- not the pre-sanction DPR estimate, and not converted to rupees", async () => {
    mockListProjects.mockResolvedValueOnce([projectRow({ rag: "amber" })]);
    const summaries = await listProjectSummaries("t1", 20);
    expect(summaries).toHaveLength(1);
    // sanctionedMinor is 4500000 paise (Rs 45,000). A regression to
    // dprCostMinor would read 5000000; a regression to the old
    // minorToAmount()-to-rupees conversion would read 45000 -- both wrong
    // in a way this exact value catches. Every consumer (ProjectsTable.tsx,
    // DashboardProjectsTable.tsx, projects/[id]/page.tsx) feeds this
    // straight into formatMoney(), which expects minor units and does the
    // one paise->rupee conversion itself.
    expect(summaries[0]!.totalBudget).toBe(4500000);
  });

  it("computes expenditure in minor units too, consistent with totalBudget", async () => {
    // 4500000 paise sanctioned * 20% financial progress = 900000 paise
    // (Rs 9,000) spent -- not 9000 (rupees).
    mockListProjects.mockResolvedValueOnce([projectRow({ financialPct: "20.00" })]);
    const summaries = await listProjectSummaries("t1", 20);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.expenditure).toBe(900000);
  });

  it("passes the real RAG signal through to the wire, without disturbing an unaffected (non-red) lifecycle status", async () => {
    mockListProjects.mockResolvedValueOnce([projectRow({ status: "active", rag: "amber" })]);
    const summaries = await listProjectSummaries("t1", 20);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.rag).toBe("amber");
    expect(summaries[0]!.status).toBe("active");
  });

  it("still flips status to \"delayed\" for a red, active project (pre-existing behaviour) while still exposing the raw rag", async () => {
    mockListProjects.mockResolvedValueOnce([projectRow({ status: "active", rag: "red" })]);
    const summaries = await listProjectSummaries("t1", 20);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.status).toBe("delayed");
    expect(summaries[0]!.rag).toBe("red");
  });
});
