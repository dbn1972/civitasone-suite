import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const getApplicationByIdMock = vi.fn();
vi.mock("../../_data", () => ({
  getApplicationById: (id: string) => getApplicationByIdMock(id),
}));

import ApplicationDetailPage from "./page";

describe("ApplicationDetailPage", () => {
  beforeEach(() => {
    getApplicationByIdMock.mockReset();
    getApplicationByIdMock.mockResolvedValue({
      data: {
        id: "app-1",
        grantNo: "GNT-2026-27-00001",
        schemeId: "scheme-1",
        beneficiaryId: "ben-1",
        status: "submitted",
        purpose: "Community water supply project for the eastern ward",
        amountRequestedMinor: 4500000,
        amountApprovedMinor: null,
        submittedBy: "clerk-1",
        approvedBy: null,
        submittedAt: "2026-08-01",
        approvedAt: null,
        createdAt: "2026-08-01",
      },
      source: "api",
    });
  });

  // Regression: this page used to render its own manual
  // <nav aria-label="Breadcrumb"> AND pass back/backLabel to PageHeader
  // (which renders an identical back link), doubling the breadcrumb.
  // Only PageHeader's own back link should render.
  it("renders exactly one breadcrumb back-link to /grants/applications, not two", async () => {
    render(await ApplicationDetailPage({ params: { id: "app-1" } }));

    const backLinks = screen.getAllByRole("link", { name: "Applications" });
    expect(backLinks).toHaveLength(1);
    expect(backLinks[0]).toHaveAttribute("href", "/grants/applications");

    // No leftover manual breadcrumb <nav> alongside PageHeader's own back span.
    expect(document.querySelectorAll('nav[aria-label="Breadcrumb"]')).toHaveLength(0);
    expect(document.querySelectorAll("span.back")).toHaveLength(1);
  });

  it("still renders the page heading", async () => {
    render(await ApplicationDetailPage({ params: { id: "app-1" } }));
    expect(
      screen.getByRole("heading", { level: 1, name: "GNT-2026-27-00001" })
    ).toBeInTheDocument();
  });
});
