import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const rolesMock = vi.fn(() => ["grant_officer"] as string[]);
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => rolesMock() };
});

const getSchemeByIdMock = vi.fn();
vi.mock("../../_data", () => ({
  getSchemeById: (id: string) => getSchemeByIdMock(id),
}));

import SchemeDetailPage from "./page";

const OPEN_SCHEME = {
  id: "scheme-1",
  code: "PM-KISAN-2026",
  name: "PM Farmer Support Scheme",
  budgetMinor: 100000000,
  disbursedMinor: 25000000,
  minAmountMinor: 0,
  maxAmountMinor: 500000,
  currency: "INR",
  status: "open",
  openAt: "2020-04-01",
  closeAt: "2099-03-31",
  reportingFrequencyDays: 90,
  sanctionRef: "SAN-2026-001",
};

describe("SchemeDetailPage", () => {
  beforeEach(() => {
    getSchemeByIdMock.mockReset();
    rolesMock.mockReset();
    rolesMock.mockReturnValue(["grant_officer"]);
    getSchemeByIdMock.mockResolvedValue({ data: OPEN_SCHEME, source: "api" });
  });

  it("renders exactly one breadcrumb back-link to /grants/schemes, not two", async () => {
    render(await SchemeDetailPage({ params: { id: "scheme-1" } }));
    const backLinks = screen.getAllByRole("link", { name: "Schemes" });
    expect(backLinks).toHaveLength(1);
    expect(backLinks[0]).toHaveAttribute("href", "/grants/schemes");
    expect(document.querySelectorAll('nav[aria-label="Breadcrumb"]')).toHaveLength(0);
    expect(document.querySelectorAll("span.back")).toHaveLength(1);
  });

  it("still renders the page heading", async () => {
    render(await SchemeDetailPage({ params: { id: "scheme-1" } }));
    expect(screen.getByRole("heading", { level: 1, name: "PM Farmer Support Scheme" })).toBeInTheDocument();
  });

  // GAP-GRANTS-SCHEMES-DETAIL-03: a non-404 error shows retry, not notFound.
  it("shows a retry error state on a server error (not 'page not found')", async () => {
    getSchemeByIdMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    const page = await SchemeDetailPage({ params: { id: "scheme-1" } });
    render(page);
    // RefreshErrorState renders a Retry affordance; notFound() would have thrown.
    expect(screen.getByRole("heading", { level: 1, name: "Scheme" })).toBeInTheDocument();
  });

  it("calls notFound() on a genuine 404", async () => {
    getSchemeByIdMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(SchemeDetailPage({ params: { id: "missing" } })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  // GAP-GRANTS-SCHEMES-DETAIL-01
  it("hides management actions (Close Scheme) for a read-only role", async () => {
    rolesMock.mockReturnValue(["grant_viewer"]);
    render(await SchemeDetailPage({ params: { id: "scheme-1" } }));
    expect(screen.queryByRole("button", { name: "Close Scheme" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "+ New Application" })).not.toBeInTheDocument();
  });

  it("shows Close Scheme for a maker role", async () => {
    rolesMock.mockReturnValue(["grant_admin"]);
    render(await SchemeDetailPage({ params: { id: "scheme-1" } }));
    expect(screen.getByRole("button", { name: "Close Scheme" })).toBeInTheDocument();
  });

  // GAP-GRANTS-SCHEMES-DETAIL-05: window closed in the past -> no live apply CTA.
  it("disables New Application when the close date has passed", async () => {
    getSchemeByIdMock.mockResolvedValue({
      data: { ...OPEN_SCHEME, openAt: "2020-01-01", closeAt: "2020-12-31" },
      source: "api",
    });
    render(await SchemeDetailPage({ params: { id: "scheme-1" } }));
    expect(screen.queryByRole("link", { name: "+ New Application" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Closed/ })).toBeDisabled();
  });

  // GAP-GRANTS-SCHEMES-DETAIL-06: reportingFrequencyDays 0 renders no stray "0".
  it("does not render a stray '0' for reportingFrequencyDays 0", async () => {
    getSchemeByIdMock.mockResolvedValue({
      data: { ...OPEN_SCHEME, reportingFrequencyDays: 0 },
      source: "api",
    });
    render(await SchemeDetailPage({ params: { id: "scheme-1" } }));
    expect(screen.queryByText("Reporting Cycle")).not.toBeInTheDocument();
  });

  // GAP-GRANTS-SCHEMES-DETAIL-06: only one New Application entry.
  it("renders at most one '+ New Application' control", async () => {
    render(await SchemeDetailPage({ params: { id: "scheme-1" } }));
    expect(screen.getAllByRole("link", { name: "+ New Application" })).toHaveLength(1);
  });

  // GAP-GRANTS-SCHEMES-DETAIL-04: utilisation reflects disbursed vs budget.
  it("shows budget utilisation (25%)", async () => {
    render(await SchemeDetailPage({ params: { id: "scheme-1" } }));
    expect(screen.getAllByText(/25\.0%/).length).toBeGreaterThan(0);
  });
});
