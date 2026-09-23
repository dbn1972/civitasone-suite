import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const getGrantSchemesMock = vi.fn();
vi.mock("../_data", () => ({
  getGrantSchemes: () => getGrantSchemesMock(),
}));

import GrantSchemesPage from "./page";

describe("GrantSchemesPage", () => {
  beforeEach(() => {
    getGrantSchemesMock.mockReset();
    getGrantSchemesMock.mockResolvedValue({
      data: [
        {
          id: "scheme-1",
          code: "PM-KISAN-2026",
          name: "PM Farmer Support Scheme",
          budgetMinor: 100000000,
          disbursedMinor: 25000000,
          currency: "INR",
          status: "open",
          openAt: "2026-04-01",
          closeAt: "2027-03-31",
          applicationCount: 12,
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
    render(await GrantSchemesPage());

    const backLinks = screen.getAllByRole("link", { name: "Grants" });
    expect(backLinks).toHaveLength(1);
    expect(backLinks[0]).toHaveAttribute("href", "/grants");

    // No leftover manual breadcrumb <nav> alongside PageHeader's own back span.
    expect(document.querySelectorAll('nav[aria-label="Breadcrumb"]')).toHaveLength(0);
    expect(document.querySelectorAll("span.back")).toHaveLength(1);
  });

  it("still renders the page heading", async () => {
    render(await GrantSchemesPage());
    expect(screen.getByRole("heading", { level: 1, name: "Grant Schemes" })).toBeInTheDocument();
  });
});
