import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import PolicyDetailPage from "./page";
import { mapPolicyDetail } from "./policyDetail";

const policyDetail = {
  id: "p1",
  assetId: "a1",
  policyNo: "POL-2026-001",
  insurer: "National Insurance Co",
  coverageMinor: "50000000",
  premiumMinor: "1250000",
  currency: "INR",
  startDate: "2026-04-01",
  endDate: "2027-03-31",
  renewalReminderDays: 30,
  status: "active",
};

const claimRow = {
  id: "c1",
  policyId: "p1",
  assetId: "a1",
  claimDate: "2026-06-15",
  claimAmountMinor: "800000",
  settledAmountMinor: "0",
  status: "pending",
};

describe("PolicyDetailPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the policy details and its claims", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: policyDetail, source: "api" })
      .mockResolvedValueOnce({ data: [claimRow], source: "api" })
      .mockResolvedValueOnce({ data: "AST-1 · Laptop", source: "api" });

    const ui = await PolicyDetailPage({ params: { id: "p1" } });
    render(ui);

    expect(screen.getAllByText(/POL-2026-001/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("National Insurance Co").length).toBeGreaterThan(0);
  });

  it("renders empty state for claims when none exist", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: policyDetail, source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: null, source: "api" });

    const ui = await PolicyDetailPage({ params: { id: "p1" } });
    render(ui);

    expect(screen.getByText("No claims filed")).toBeInTheDocument();
  });

  // GAP-ASSETS-INSURANCE-DETAIL-03
  it("renders not-found copy WITHOUT the word 'lapsed' for a real 404", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: null, source: "error", status: 404 })
      .mockResolvedValueOnce({ data: [], source: "api" });

    render(await PolicyDetailPage({ params: { id: "missing" } }));

    expect(screen.getByText("This policy does not exist or the link is incorrect.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/lapsed/i);
  });

  it("renders a retry error state (not not-found) for a 500, titled 'Policy'", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: null, source: "error", status: 500 })
      .mockResolvedValueOnce({ data: [], source: "api" });

    render(await PolicyDetailPage({ params: { id: "p1" } }));

    expect(screen.queryByText("This policy does not exist or the link is incorrect.")).not.toBeInTheDocument();
    expect(screen.queryByText("Policy not found")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry|try again/i })).toBeInTheDocument();
  });

  it("renders access-restricted (no retry) for a 403", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: null, source: "error", status: 403, errorMessage: "insufficient role" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    render(await PolicyDetailPage({ params: { id: "p1" } }));

    expect(screen.queryByRole("button", { name: /retry|try again/i })).not.toBeInTheDocument();
    expect(screen.getByText(/You don't have permission to do this\. Ask your administrator if you need access\./)).toBeInTheDocument();
  });

  it("still renders the full detail page for a lapsed (expired) policy", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: { ...policyDetail, status: "expired" }, source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: null, source: "api" });
    render(await PolicyDetailPage({ params: { id: "p1" } }));
    expect(screen.getAllByText(/POL-2026-001/).length).toBeGreaterThan(0);
  });

  // GAP-ASSETS-INSURANCE-DETAIL-04
  it("mapper yields null for an absent renewalReminderDays and a missing amount (no fabricated 30 / 0)", () => {
    const { renewalReminderDays: _omit, coverageMinor: _c, ...rest } = policyDetail;
    const mapped = mapPolicyDetail(rest);
    expect(mapped?.renewalReminderDays).toBeNull();
    expect(mapped?.coverageMinor).toBeNull();
    expect(mapPolicyDetail({ ...policyDetail, renewalReminderDays: 15 })?.renewalReminderDays).toBe(15);
  });

  it("shows 'Not set' when no reminder is saved and '15 days before expiry' when it is", async () => {
    const { renewalReminderDays: _omit, ...rest } = policyDetail;
    fetchJsonMock
      .mockResolvedValueOnce({ data: rest, source: "api", status: 200 })
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: null, source: "api" });
    const first = render(await PolicyDetailPage({ params: { id: "p1" } }));
    // fetchJson is mocked, so the mapper is not applied -- feed the mapped shape.
    first.unmount();
    fetchJsonMock.mockReset();
    fetchJsonMock
      .mockResolvedValueOnce({ data: { ...policyDetail, renewalReminderDays: null }, source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: null, source: "api" });
    const second = render(await PolicyDetailPage({ params: { id: "p1" } }));
    expect(screen.getByText("Not set")).toBeInTheDocument();
    second.unmount();
    fetchJsonMock.mockReset();
    fetchJsonMock
      .mockResolvedValueOnce({ data: { ...policyDetail, renewalReminderDays: 15 }, source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: null, source: "api" });
    render(await PolicyDetailPage({ params: { id: "p1" } }));
    expect(screen.getByText("15 days before expiry")).toBeInTheDocument();
  });

  // GAP-ASSETS-INSURANCE-DETAIL-02
  it("makes claim rows link to the claim detail page", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: policyDetail, source: "api" })
      .mockResolvedValueOnce({ data: [claimRow], source: "api" })
      .mockResolvedValueOnce({ data: null, source: "api" });
    render(await PolicyDetailPage({ params: { id: "p1" } }));
    const links = screen.getAllByRole("link").filter((l) => l.getAttribute("href") === "/assets/insurance/claims/c1");
    expect(links.length).toBeGreaterThan(0);
  });

  it("shows ONE error region in the claims card when only the claims load fails", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: policyDetail, source: "api" })
      .mockResolvedValueOnce({ data: [], source: "error", status: 500 })
      .mockResolvedValueOnce({ data: null, source: "api" });
    render(await PolicyDetailPage({ params: { id: "p1" } }));
    expect(screen.getAllByRole("button", { name: /retry|try again/i })).toHaveLength(1);
    expect(screen.queryByText("No claims filed")).not.toBeInTheDocument();
  });

  // GAP-ASSETS-INSURANCE-DETAIL-01
  it("links the insured asset by its code · name", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: policyDetail, source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: "AST-1 · Laptop", source: "api" });
    render(await PolicyDetailPage({ params: { id: "p1" } }));
    const link = screen.getByRole("link", { name: "AST-1 · Laptop" });
    expect(link).toHaveAttribute("href", "/assets/a1");
  });

  it("still renders the policy with a fallback asset link when the asset lookup fails", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({ data: policyDetail, source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: null, source: "error", status: 500 });
    render(await PolicyDetailPage({ params: { id: "p1" } }));
    expect(screen.getAllByText(/POL-2026-001/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "View asset" })).toHaveAttribute("href", "/assets/a1");
  });
});
