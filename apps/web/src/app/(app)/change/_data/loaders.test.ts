import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * GAP-CHANGE-HOME-06: the loaders now zod-validate each row and DROP invalid
 * ones instead of coercing an unknown status to a misleading "draft". We drive
 * the real mapResponse by capturing it from the fetchJson mock and running it
 * on hand-built payloads.
 */
let captured: { path: string; empty: unknown; options: { mapResponse: (p: unknown) => unknown } } | null = null;
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (path: string, empty: unknown, options: { mapResponse: (p: unknown) => unknown }) => {
    captured = { path, empty, options };
    return Promise.resolve({ data: empty, source: "api" });
  },
}));
vi.mock("@/app/_data/loaderTelemetry", () => ({ recordLoaderFallback: vi.fn() }));

import { getChangeRequests, getChangeRequest, getChangeFreezes } from "./loaders";

const UUID = "11111111-2222-4333-8444-555555555555";
const validRow = {
  id: UUID, title: "Gateway v2", type: "normal", risk: "high",
  affectedServices: ["finance-service"], description: "roll out",
  rollbackPlan: null, status: "submitted", requestedBy: "req", approvedBy: null,
  approvedAt: null, rejectedReason: null, windowStart: null, windowEnd: null,
  releaseNotes: null, pirOutcome: null, pirNotes: null, pirAt: null,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
};

async function mapRequests(payload: unknown): Promise<unknown[]> {
  await getChangeRequests();
  return captured!.options.mapResponse(payload) as unknown[];
}

describe("getChangeRequests mapResponse (GAP-CHANGE-HOME-06)", () => {
  beforeEach(() => { captured = null; });

  it("keeps a well-formed row with its real status (not defaulted to draft)", async () => {
    const rows = await mapRequests({ data: [validRow] }) as Array<{ status: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("submitted");
  });

  it("DROPS a row whose status is unknown rather than showing it as 'draft'", async () => {
    const rows = await mapRequests({ data: [{ ...validRow, status: "in-review" }] }) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it("DROPS a row with no/invalid id", async () => {
    const rows = await mapRequests({ data: [{ ...validRow, id: "" }, { ...validRow, id: "not-a-uuid" }] }) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it("keeps valid rows and drops invalid ones in a mixed payload", async () => {
    const rows = await mapRequests({ data: [validRow, { ...validRow, status: "frozen" }] }) as unknown[];
    expect(rows).toHaveLength(1);
  });
});

describe("getChangeRequest detail mapResponse (GAP-CHANGE-HOME-06)", () => {
  beforeEach(() => { captured = null; });
  it("returns null (triggers error state) when the row fails validation", async () => {
    await getChangeRequest(UUID);
    const mapped = captured!.options.mapResponse({ data: { ...validRow, status: "bogus" }, audit: [] });
    expect(mapped).toBeNull();
  });
  it("parses a valid detail with its audit entries", async () => {
    await getChangeRequest(UUID);
    const mapped = captured!.options.mapResponse({
      data: validRow,
      audit: [{ id: "a1", fromStatus: null, toStatus: "submitted", actorId: "x", note: null, at: "2026-09-01T00:00:00.000Z" }],
    }) as { data: { status: string }; audit: unknown[] };
    expect(mapped.data.status).toBe("submitted");
    expect(mapped.audit).toHaveLength(1);
  });
});

describe("getChangeFreezes mapResponse", () => {
  beforeEach(() => { captured = null; });
  it("maps freeze rows", async () => {
    await getChangeFreezes();
    const mapped = captured!.options.mapResponse({ data: [{ id: "f1", name: "YE", startsAt: "a", endsAt: "b", reason: "r" }] }) as unknown[];
    expect(mapped).toHaveLength(1);
  });
});
