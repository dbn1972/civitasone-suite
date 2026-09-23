import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const getGrantByIdMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getGrantById: (id: string) => getGrantByIdMock(id),
}));

import GrantDetailPage from "./page";

describe("GrantDetailPage", () => {
  beforeEach(() => {
    getGrantByIdMock.mockReset();
    getGrantByIdMock.mockResolvedValue({
      data: {
        id: "grant-1",
        grantNo: "GNT-2026-27-00001",
        title: "Community water supply project",
        grantor: "Ministry of Jal Shakti",
        granteeName: "Gram Panchayat Alpha",
        totalAmount: 45000,
        disbursedAmount: 10000,
        pendingAmount: 35000,
        sanctionDate: "2026-08-12",
        status: "active",
        installments: [],
        ucs: [],
      },
      source: "api",
    });
  });

  // Regression: this page used to render its own manual
  // <nav aria-label="Breadcrumb"> AND pass back/backLabel to PageHeader
  // (which renders an identical back link), doubling the breadcrumb into
  // "← All grants ← All grants". Only PageHeader's own back link should render.
  it("renders exactly one breadcrumb back-link to /grants/list, not two", async () => {
    render(await GrantDetailPage({ params: { id: "grant-1" } }));

    const backLinks = screen.getAllByRole("link", { name: "All grants" });
    expect(backLinks).toHaveLength(1);
    expect(backLinks[0]).toHaveAttribute("href", "/grants/list");

    // No leftover manual breadcrumb <nav> alongside PageHeader's own back span.
    expect(document.querySelectorAll('nav[aria-label="Breadcrumb"]')).toHaveLength(0);
    expect(document.querySelectorAll("span.back")).toHaveLength(1);
  });

  it("still renders the page heading", async () => {
    render(await GrantDetailPage({ params: { id: "grant-1" } }));
    expect(
      screen.getByRole("heading", { level: 1, name: "Community water supply project" })
    ).toBeInTheDocument();
  });
});
