import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  assignReviewer,
  scoreApplication,
  approveApplication,
  rejectApplication,
  withdrawApplication,
} from "./application";

function mockFetchOnce(status: number, body: unknown = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone() {
      return this;
    },
  }) as unknown as typeof fetch;
}

describe("grant application actions (COMP-012)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("assignReviewer PATCHes the real assign-reviewer route", async () => {
    mockFetchOnce(202);
    await assignReviewer("app-1", { reviewerRef: "rev-1" });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/proxy/v1/grants/applications/app-1/assign-reviewer",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ reviewerRef: "rev-1" }) }),
    );
  });

  it("scoreApplication PATCHes the real score route with reviewer + both scores", async () => {
    mockFetchOnce(202);
    const req = { reviewerRef: "rev-1", technicalScore: 80, financialScore: 70 };
    await scoreApplication("app-1", req);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/proxy/v1/grants/applications/app-1/score",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify(req) }),
    );
  });

  it("approveApplication PATCHes the real approve route with the sanctioned amount", async () => {
    mockFetchOnce(202);
    await approveApplication("app-1", { amountApprovedMinor: 500000 });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/proxy/v1/grants/applications/app-1/approve",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ amountApprovedMinor: 500000 }) }),
    );
  });

  it("rejectApplication PATCHes the real reject route with a reason", async () => {
    mockFetchOnce(202);
    await rejectApplication("app-1", { reason: "Incomplete documentation submitted." });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/proxy/v1/grants/applications/app-1/reject",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("withdrawApplication PATCHes the real withdraw route with a reason", async () => {
    mockFetchOnce(202);
    await withdrawApplication("app-1", { reason: "No longer needed." });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/proxy/v1/grants/applications/app-1/withdraw",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("surfaces the server's code:message on failure instead of swallowing it", async () => {
    mockFetchOnce(422, { code: "VALIDATION_FAILED", message: "financialScore must be <= 100" });
    await expect(
      scoreApplication("app-1", { reviewerRef: "rev-1", technicalScore: 80, financialScore: 999 }),
    ).rejects.toThrow("VALIDATION_FAILED: financialScore must be <= 100");
  });
});
