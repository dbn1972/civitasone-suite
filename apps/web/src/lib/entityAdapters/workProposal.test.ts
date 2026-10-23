import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  searchWorkProposals,
  resolveWorkProposals,
  isTsEligibleStatus,
  TS_ELIGIBLE_STATUSES,
} from "./workProposal";

// GAP-WORKS-APPROVALS-TS-NEW-01: the work picker lists a work that is not eligible for the step as a DISABLED option
// with a reason (instead of dropping it), and matches on the server rather than inside the first 200 proposals.

const FINAL = { id: "11111111-1111-4111-8111-111111111111", workNumber: "WK/1", description: "Road", status: "dao_finalized" };
const DRAFT = { id: "22222222-2222-4222-8222-222222222222", workNumber: "WK/2", description: "Bridge", status: "draft" };

function ok(rows: unknown[]) {
  return new Response(JSON.stringify({ data: rows }), { status: 200 });
}

describe("workProposal adapter", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("search() asks the server (q and a limit), never a fixed first page", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok([FINAL]));
    await searchWorkProposals("  WK  ", new AbortController().signal);
    const url = String(spy.mock.calls[0]![0]);
    expect(url).toBe("/api/proxy/v1/works/proposals?q=WK&limit=50");
  });

  it("search() with eligible statuses sends them as the server-side preference", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok([FINAL]));
    await searchWorkProposals("WK", new AbortController().signal, { eligibleStatuses: TS_ELIGIBLE_STATUSES });
    expect(decodeURIComponent(String(spy.mock.calls[0]![0]))).toContain("prefer=dao_finalized,ts_eligible");
  });

  it("an ineligible work stays in the list, disabled, with the caller's reason; an eligible one is selectable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok([FINAL, DRAFT]));
    const out = await searchWorkProposals("WK", new AbortController().signal, {
      eligibleStatuses: TS_ELIGIBLE_STATUSES,
      ineligibleReason: (status) => `Not DAO-finalized (${status})`,
    });
    expect(out.map((o) => o.id)).toEqual([FINAL.id, DRAFT.id]);
    expect(out[0]!.disabledReason).toBeUndefined();
    expect(out[0]!.status).toBe("dao_finalized");
    expect(out[1]!.disabledReason).toBe("Not DAO-finalized (draft)");
  });

  it("without eligible statuses nothing is disabled", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok([FINAL, DRAFT]));
    const out = await searchWorkProposals("WK", new AbortController().signal);
    expect(out.every((o) => o.disabledReason === undefined)).toBe(true);
  });

  it("a non-ok response is 'No matches' by default and a thrown error in strict mode", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    await expect(searchWorkProposals("WK", new AbortController().signal)).resolves.toEqual([]);
    await expect(searchWorkProposals("WK", new AbortController().signal, { strict: true })).rejects.toThrow();
  });

  it("resolve() de-duplicates ids and asks in batches of 50, so a long id list is never silently truncated", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ok([]));
    await resolveWorkProposals([...ids, ids[0]!, ""]);
    expect(spy).toHaveBeenCalledTimes(3);
    const sizes = spy.mock.calls.map(([u]) => decodeURIComponent(String(u).split("ids=")[1]!).split(",").length);
    expect(sizes).toEqual([50, 50, 20]);
  });

  it("resolve() with no ids makes no request", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(resolveWorkProposals([])).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("isTsEligibleStatus mirrors the server allow-list (dao_finalized, ts_eligible)", () => {
    expect(isTsEligibleStatus("dao_finalized")).toBe(true);
    expect(isTsEligibleStatus("ts_eligible")).toBe(true);
    expect(isTsEligibleStatus("draft")).toBe(false);
    expect(isTsEligibleStatus(null)).toBe(false);
    expect(isTsEligibleStatus(undefined)).toBe(false);
  });
});
