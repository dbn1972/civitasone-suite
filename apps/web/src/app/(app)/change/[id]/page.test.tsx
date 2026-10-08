import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ChangeDetail, ChangeRequest } from "../_data/types";

const getChangeRequest = vi.fn();
vi.mock("../_data/loaders", () => ({ getChangeRequest: (id: string) => getChangeRequest(id) }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
}));

import Page from "./page";

const REQ = "aaaaaaaa-0000-4000-8000-000000000001";

function detail(over: Partial<ChangeRequest> = {}, audit: ChangeDetail["audit"] = []): ChangeDetail {
  return {
    data: {
      id: "cccccccc-0000-4000-8000-000000000009", title: "Gateway v2", type: "normal", risk: "high",
      affectedServices: ["finance-service"], description: "roll out", rollbackPlan: "revert",
      status: "approved", requestedBy: REQ, approvedBy: null, approvedAt: null, rejectedReason: null,
      windowStart: null, windowEnd: null, releaseNotes: null, pirOutcome: null, pirNotes: null,
      pirAt: null, createdAt: "", updatedAt: "", ...over,
    },
    audit,
  };
}

describe("change detail page (GAP-CHANGE-DETAIL-03 / -04)", () => {
  beforeEach(() => getChangeRequest.mockReset());

  it("DETAIL-03: requester renders via UserRef (short id with full id in a tooltip)", async () => {
    getChangeRequest.mockResolvedValue({ data: detail(), source: "api" });
    render(await Page({ params: { id: "x" } }));
    expect(screen.getByText("aaaaaaaa")).toBeInTheDocument();
    expect(screen.getByTitle(REQ)).toBeInTheDocument();
  });

  it("DETAIL-03: warns when the approver is the same person as the requester", async () => {
    getChangeRequest.mockResolvedValue({ data: detail({ approvedBy: REQ, status: "scheduled" }), source: "api" });
    render(await Page({ params: { id: "x" } }));
    expect(screen.getByText(/maker-checker not satisfied/i)).toBeInTheDocument();
  });

  it("DETAIL-04: a 22:00->02:00 next-day window renders date+time in IST (not a same-day date)", async () => {
    getChangeRequest.mockResolvedValue({
      data: detail({ status: "scheduled", windowStart: "2026-09-14T16:30:00.000Z", windowEnd: "2026-09-14T20:30:00.000Z" }),
      source: "api",
    });
    render(await Page({ params: { id: "x" } }));
    // 16:30Z = 22:00 IST on the 14th; 20:30Z = 02:00 IST on the 15th.
    expect(screen.getByText(/14 Sep 2026, 10:00 pm.*15 Sep 2026, 02:00 am/)).toBeInTheDocument();
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("change/[id] page — DS theme tokens, no hex literals (GAP2-CHANGE-DETAIL-02)", () => {
  it("contains no #rrggbb colour literal", () => {
    const src = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const hexMatches = src.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    expect(hexMatches).toEqual([]);
  });
});
