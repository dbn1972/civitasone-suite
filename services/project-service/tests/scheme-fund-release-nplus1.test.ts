/**
 * listFundReleaseSummaries must resolve project names with ONE batched lookup, not one query per row
 * (CLOS3-S5-20; repo.findSchemesByIds already exists for this).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  listFundReleasesByTenant: vi.fn(),
  findSchemeById: vi.fn(async () => null),
  findSchemesByIds: vi.fn(),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    makeKey: (...p: string[]) => p.join(":"),
    getOrLoad: async (_k: string, loader: () => Promise<unknown>) => loader(),
  },
}));
vi.mock("../src/modules/scheme/repo.js", () => ({
  listFundReleasesByTenant: (...a: unknown[]) => H.listFundReleasesByTenant(...a),
  findSchemeById: (...a: unknown[]) => H.findSchemeById(...(a as [])),
  findSchemesByIds: (...a: unknown[]) => H.findSchemesByIds(...a),
}));

import { listFundReleaseSummaries } from "../src/modules/scheme/queries.js";

const TENANT = "5c040000-dead-4000-8000-00000000c004";
const rel = (id: string, schemeId: string) => ({
  id, releaseNo: `R-${id}`, schemeId, amountMinor: 250000n, status: "disbursed",
  disbursedAt: new Date("2026-10-01T00:00:00Z"), createdAt: new Date("2026-09-01T00:00:00Z"), sanctionedBy: "u1",
});

describe("listFundReleaseSummaries batching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    H.findSchemesByIds.mockResolvedValue([]);
  });

  it("uses one findSchemesByIds call with the distinct ids and never findSchemeById", async () => {
    H.listFundReleasesByTenant.mockResolvedValue([rel("1", "s1"), rel("2", "s1"), rel("3", "s2")]);
    H.findSchemesByIds.mockResolvedValue([{ id: "s1", name: "Scheme One" }, { id: "s2", name: "Scheme Two" }]);
    const out = await listFundReleaseSummaries(TENANT, 50);
    expect(H.findSchemeById).toHaveBeenCalledTimes(0);
    expect(H.findSchemesByIds).toHaveBeenCalledTimes(1);
    expect(H.findSchemesByIds).toHaveBeenCalledWith(["s1", "s2"], TENANT);
    expect(out.map((r) => r.projectName)).toEqual(["Scheme One", "Scheme One", "Scheme Two"]);
    expect(out[0]).toMatchObject({ id: "1", releaseNo: "R-1", projectId: "s1", amount: 2500, status: "released", releasedBy: "u1", releaseDate: "2026-10-01" });
  });

  it("falls back to the scheme id when a scheme is missing", async () => {
    H.listFundReleasesByTenant.mockResolvedValue([rel("1", "s1"), rel("2", "gone")]);
    H.findSchemesByIds.mockResolvedValue([{ id: "s1", name: "Scheme One" }]);
    const out = await listFundReleaseSummaries(TENANT, 50);
    expect(out.map((r) => r.projectName)).toEqual(["Scheme One", "gone"]);
  });

  it("returns [] for no rows", async () => {
    H.listFundReleasesByTenant.mockResolvedValue([]);
    expect(await listFundReleaseSummaries(TENANT, 50)).toEqual([]);
    expect(H.findSchemeById).toHaveBeenCalledTimes(0);
  });
});
