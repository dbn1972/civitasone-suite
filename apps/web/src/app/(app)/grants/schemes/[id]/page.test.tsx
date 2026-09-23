import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const getSchemeByIdMock = vi.fn();
vi.mock("../../_data", () => ({
  getSchemeById: (id: string) => getSchemeByIdMock(id),
}));

import SchemeDetailPage from "./page";

describe("SchemeDetailPage", () => {
  beforeEach(() => {
    getSchemeByIdMock.mockReset();
    getSchemeByIdMock.mockResolvedValue({
      data: {
        id: "scheme-1",
        code: "PM-KISAN-2026",
        name: "PM Farmer Support Scheme",
        budgetMinor: 100000000,
        minAmountMinor: 0,
        maxAmountMinor: 500000,
        currency: "INR",
        status: "open",
        openAt: "2026-04-01",
        closeAt: "2027-03-31",
        reportingFrequencyDays: 90,
        sanctionRef: "SAN-2026-001",
      },
      source: "api",
    });
  });

  // Regression: this page used to render its own manual
  // <nav aria-label="Breadcrumb"> AND pass back/backLabel to PageHeader
  // (which renders an identical back link), doubling the breadcrumb.
  // Only PageHeader's own back link should render.
  it("renders exactly one breadcrumb back-link to /grants/schemes, not two", async () => {
    render(await SchemeDetailPage({ params: { id: "scheme-1" } }));

    const backLinks = screen.getAllByRole("link", { name: "Schemes" });
    expect(backLinks).toHaveLength(1);
    expect(backLinks[0]).toHaveAttribute("href", "/grants/schemes");

    // No leftover manual breadcrumb <nav> alongside PageHeader's own back span.
    expect(document.querySelectorAll('nav[aria-label="Breadcrumb"]')).toHaveLength(0);
    expect(document.querySelectorAll("span.back")).toHaveLength(1);
  });

  it("still renders the page heading", async () => {
    render(await SchemeDetailPage({ params: { id: "scheme-1" } }));
    expect(
      screen.getByRole("heading", { level: 1, name: "PM Farmer Support Scheme" })
    ).toBeInTheDocument();
  });
});
