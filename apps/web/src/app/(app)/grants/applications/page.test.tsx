import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const getGrantApplicationsMock = vi.fn();
vi.mock("../_data", () => ({
  getGrantApplications: () => getGrantApplicationsMock(),
}));

import GrantApplicationsPage from "./page";

describe("GrantApplicationsPage", () => {
  beforeEach(() => {
    getGrantApplicationsMock.mockReset();
    getGrantApplicationsMock.mockResolvedValue({
      data: [
        {
          id: "app-1",
          grantNo: "GNT-2026-27-00001",
          title: "Community water supply project",
          totalAmount: 45000,
          disbursedAmount: 0,
          pendingAmount: 45000,
          sanctionDate: "2026-08-12",
          status: "active",
        },
      ],
      source: "api",
    });
  });

  // Regression: this page used to render its own manual
  // <nav aria-label="Breadcrumb"> AND pass back/backLabel to PageHeader
  // (which renders an identical back link), doubling the breadcrumb into
  // "← Grants ← Grants". Only PageHeader's own back link should render.
  it("renders exactly one breadcrumb back-link to /grants, not two", async () => {
    render(await GrantApplicationsPage());

    const backLinks = screen.getAllByRole("link", { name: "Grants" });
    expect(backLinks).toHaveLength(1);
    expect(backLinks[0]).toHaveAttribute("href", "/grants");

    // No leftover manual breadcrumb <nav> alongside PageHeader's own back span.
    expect(document.querySelectorAll('nav[aria-label="Breadcrumb"]')).toHaveLength(0);
    expect(document.querySelectorAll("span.back")).toHaveLength(1);
  });

  it("still renders the page heading and applications table", async () => {
    render(await GrantApplicationsPage());
    expect(screen.getByRole("heading", { level: 1, name: "Grant Applications" })).toBeInTheDocument();
    expect(screen.getByText("Community water supply project")).toBeInTheDocument();
  });
});
