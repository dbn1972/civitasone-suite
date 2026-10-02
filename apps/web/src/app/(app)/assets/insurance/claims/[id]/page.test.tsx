import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const rolesMock = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));

import ClaimDetailPage from "./page";
import { mapClaimDetail } from "./claimDetail";

const claim = {
  id: "c1", policyId: "p1", assetId: "a1", claimDate: "2026-06-15",
  claimAmountMinor: "800000", settledAmountMinor: "0", status: "pending", notes: "Water damage",
};

function load(status = "pending") {
  fetchJsonMock
    .mockResolvedValueOnce({ data: { ...claim, status }, source: "api" })
    .mockResolvedValueOnce({ data: "POL-1 · National", source: "api" })
    .mockResolvedValueOnce({ data: "AST-1 · Laptop", source: "api" });
}

// GAP-ASSETS-INSURANCE-DETAIL-02 / CLAIMS-03
describe("ClaimDetailPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReset();
  });

  it("maps a claim and links its policy and asset", async () => {
    rolesMock.mockReturnValue(["asset_admin"]);
    load();
    render(await ClaimDetailPage({ params: { id: "c1" } }));
    expect(screen.getByRole("link", { name: "POL-1 · National" })).toHaveAttribute("href", "/assets/insurance/p1");
    expect(screen.getByRole("link", { name: "AST-1 · Laptop" })).toHaveAttribute("href", "/assets/a1");
    expect(screen.getByText("Water damage")).toBeInTheDocument();
  });

  it("offers Settle / Reject to an asset_admin on a pending claim", async () => {
    rolesMock.mockReturnValue(["asset_admin"]);
    load();
    render(await ClaimDetailPage({ params: { id: "c1" } }));
    expect(screen.getByRole("button", { name: "Settle claim" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject claim" })).toBeInTheDocument();
  });

  it("hides the decision controls from a role the service would refuse", async () => {
    rolesMock.mockReturnValue(["asset_manager"]);
    load();
    render(await ClaimDetailPage({ params: { id: "c1" } }));
    expect(screen.queryByRole("button", { name: "Settle claim" })).not.toBeInTheDocument();
  });

  it("hides the controls once the claim is settled", async () => {
    rolesMock.mockReturnValue(["super_admin"]);
    load("settled");
    render(await ClaimDetailPage({ params: { id: "c1" } }));
    expect(screen.queryByRole("button", { name: "Settle claim" })).not.toBeInTheDocument();
  });

  it("renders not-found for a 404 and a retry error state for a 500", async () => {
    rolesMock.mockReturnValue([]);
    fetchJsonMock.mockResolvedValueOnce({ data: null, source: "error", status: 404 });
    const { unmount } = render(await ClaimDetailPage({ params: { id: "x" } }));
    expect(screen.getByText("This claim does not exist or the link is incorrect.")).toBeInTheDocument();
    unmount();
    fetchJsonMock.mockResolvedValueOnce({ data: null, source: "error", status: 500 });
    render(await ClaimDetailPage({ params: { id: "x" } }));
    expect(screen.queryByText("This claim does not exist or the link is incorrect.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry|try again/i })).toBeInTheDocument();
  });

  it("mapClaimDetail rejects a payload without ids and zeroes malformed amounts", () => {
    expect(mapClaimDetail({ id: "c" })).toBeNull();
    expect(mapClaimDetail({ id: "c", policyId: "p", claimAmountMinor: "abc" })?.claimAmountMinor).toBe("0");
  });
});
