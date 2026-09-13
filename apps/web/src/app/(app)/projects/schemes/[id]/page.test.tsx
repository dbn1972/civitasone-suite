import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getSchemeDetailMock = vi.fn();
// Mocked with the SAME relative specifier page.tsx itself imports (this test
// file is co-located with it), so the mock actually intercepts that import.
vi.mock("../../../../_data/loaders", () => ({
  getSchemeDetail: (...args: unknown[]) => getSchemeDetailMock(...args),
}));

import SchemeDetailPage from "./page";

const SCHEME = {
  id: "s1",
  schemeCode: "COMP016-TEST",
  name: "COMP-016 Regression Test Scheme",
  fundingType: "central" as const,
  fundingPattern: "Centre 75% : State 25%",
  sanctionRef: "SANC/TEST/001",
  totalOutlayMinor: "100000000",
  releasedMinor: "60000000",
  utilisedMinor: "25000000",
  utilisationPct: 25,
  status: "active" as const,
  projects: [
    { id: "p1", code: "PRJ-1", name: "Regression Linked Project", status: "active", budgetMinor: "30000000" },
  ],
};

// Regression test for COMP-016: this page used to look up `SCHEMES[id] ??
// DEFAULT_SCHEME` from an 11-entry hardcoded catalogue and never called any
// loader at all, regardless of the route's id. It must now call
// getSchemeDetail with the real route id and render ITS data -- and must
// never show any of the old fabricated constants (PM Awas Yojana, Smart City
// Mission, the National Highway Development default, their nodal officers,
// or their hardcoded sub-project rows).
describe("SchemeDetailPage", () => {
  beforeEach(() => {
    getSchemeDetailMock.mockReset();
  });

  it("fetches the scheme by the route id and renders real data, including a real project sub-list", async () => {
    getSchemeDetailMock.mockResolvedValue({ data: SCHEME, source: "api" });

    const ui = await SchemeDetailPage({ params: Promise.resolve({ id: "s1" }) });
    render(ui);

    expect(getSchemeDetailMock).toHaveBeenCalledWith("s1");
    expect(screen.getAllByText(SCHEME.name).length).toBeGreaterThan(0);
    expect(screen.getByText("COMP016-TEST")).toBeInTheDocument();
    expect(screen.getByText("Centre 75% : State 25%")).toBeInTheDocument();
    expect(screen.getByText("SANC/TEST/001")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("Regression Linked Project")).toBeInTheDocument();
    expect(screen.getByText("PRJ-1")).toBeInTheDocument();

    // None of the old hardcoded catalogue's fixture values should ever appear.
    expect(screen.queryByText("PM Awas Yojana (Urban)")).not.toBeInTheDocument();
    expect(screen.queryByText("Smart City Mission")).not.toBeInTheDocument();
    expect(screen.queryByText("National Highway Development")).not.toBeInTheDocument();
    expect(screen.queryByText("Shri R.K. Gautam, IAS")).not.toBeInTheDocument();
    expect(screen.queryByText("Smt. Priya Sharma, IAS")).not.toBeInTheDocument();
    expect(screen.queryByText(/₹2,450 Cr/)).not.toBeInTheDocument();
    expect(screen.queryByText("Lucknow")).not.toBeInTheDocument();
  });

  it("renders the fields with no backing column as an honest '—', never an invented value", async () => {
    getSchemeDetailMock.mockResolvedValue({ data: SCHEME, source: "api" });

    const ui = await SchemeDetailPage({ params: Promise.resolve({ id: "s1" }) });
    render(ui);

    // Beneficiaries stat, Department, Nodal Officer, Start Date, End Date:
    // none has a backing column anywhere in project-service's schema
    // (COMP-016) -- pending a product/schema decision, they render as "—",
    // never a fabricated value like the old fixture's 45200 beneficiaries or
    // "Shri R.K. Gautam, IAS".
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByText("45,200")).not.toBeInTheDocument();
    expect(screen.queryByText("45200")).not.toBeInTheDocument();
  });

  it("shows an honest empty state instead of fake data when no record is found", async () => {
    getSchemeDetailMock.mockResolvedValue({ data: null, source: "error" });

    const ui = await SchemeDetailPage({ params: Promise.resolve({ id: "does-not-exist" }) });
    render(ui);

    expect(getSchemeDetailMock).toHaveBeenCalledWith("does-not-exist");
    expect(screen.queryByText("PM Awas Yojana (Urban)")).not.toBeInTheDocument();
    expect(screen.queryByText("Shri R.K. Gautam, IAS")).not.toBeInTheDocument();
    expect(screen.queryByText(SCHEME.name)).not.toBeInTheDocument();
  });
});
