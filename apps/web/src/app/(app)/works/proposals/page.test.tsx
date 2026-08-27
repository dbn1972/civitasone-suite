import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Regression test: the proposals list used to offer "Submitted" and
 * "TS Eligible" status filter tabs (and a "TS Eligible" stat card) that can
 * never match a real row. work_proposals.status is only ever "draft" or
 * "dao_finalized" — see services/works-service/src/modules/proposal/consumer.ts,
 * the sole writer of that column. Confirmed live during the works
 * deep-verify pass: no code path anywhere in works-service ever sets
 * "submitted" or "ts_eligible" on a proposal. A clerk filtering by either
 * dead tab would always see an empty list with no way to tell that from a
 * genuine "nothing in that state right now" — L3 truthfulness defect.
 */

const getProposalsMock = vi.fn();
vi.mock("../_data/loaders", () => ({
  getProposals: (...args: unknown[]) => getProposalsMock(...args),
}));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_key: string, initialData: unknown[]) => ({
    data: initialData,
    fromCache: false,
    offline: false,
    cachedAt: null,
  }),
}));

import ProposalsPage from "./page";

const rows = [
  { id: "p1", workNumber: "WRK/2026/001", description: "Culvert", category: "Regular", type: "t1", estimatedCost: "5000000", status: "draft", office: "o1" },
  { id: "p2", workNumber: "WRK/2026/002", description: "Road", category: "Regular", type: "t1", estimatedCost: "9000000", status: "dao_finalized", office: "o1" },
];

describe("ProposalsPage — status filter tabs only offer reachable statuses (L3)", () => {
  beforeEach(() => {
    getProposalsMock.mockReset();
    getProposalsMock.mockResolvedValue({ data: rows, source: "api" });
  });

  it("does not render a 'Submitted' or 'TS Eligible' tab — those statuses never occur on a real proposal", async () => {
    const ui = await ProposalsPage({ searchParams: {} });
    render(ui);

    expect(screen.queryByRole("link", { name: /^Submitted/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^TS Eligible/i })).not.toBeInTheDocument();
    // The two real, reachable statuses stay.
    expect(screen.getByRole("link", { name: /^Draft/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^DAO Finalized/i })).toBeInTheDocument();
  });

  it("does not render a dead 'TS Eligible' stat card that would always read 0", async () => {
    const ui = await ProposalsPage({ searchParams: {} });
    render(ui);
    expect(screen.queryByText("TS Eligible")).not.toBeInTheDocument();
  });

  it("still counts and links the real statuses correctly", async () => {
    const ui = await ProposalsPage({ searchParams: {} });
    render(ui);
    expect(screen.getByRole("link", { name: "Draft (1)" })).toHaveAttribute("href", "/works/proposals?status=draft");
    expect(screen.getByRole("link", { name: "DAO Finalized (1)" })).toHaveAttribute(
      "href",
      "/works/proposals?status=dao_finalized",
    );
  });
});
