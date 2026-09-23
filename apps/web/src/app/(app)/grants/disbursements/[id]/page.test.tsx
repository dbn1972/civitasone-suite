import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getGrantDisbursementByIdMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getGrantDisbursementById: (id: string) => getGrantDisbursementByIdMock(id),
}));

// Unrelated to breadcrumb rendering and side-effect-heavy (eOffice status
// polling) — stubbed out so this test stays focused on header structure.
vi.mock("@/app/_components/RaiseEOfficeNote", () => ({
  RaiseEOfficeNote: () => null,
}));

import GrantDisbursementDetailPage from "./page";

describe("GrantDisbursementDetailPage", () => {
  beforeEach(() => {
    getGrantDisbursementByIdMock.mockReset();
  });

  // Regression: both the "not found" branch and the main render branch used
  // to render their own manual <nav aria-label="Breadcrumb"> AND pass `back`
  // to PageHeader (which renders an identical back link), doubling the
  // breadcrumb in each branch. Only PageHeader's own back link should render.
  it("renders exactly one breadcrumb back-link when the disbursement is found", async () => {
    getGrantDisbursementByIdMock.mockResolvedValue({
      data: {
        id: "disb-1",
        releaseNo: "REL-2026-00001",
        grantId: "grant-1",
        grantNo: "GNT-2026-27-00001",
        granteeName: "Gram Panchayat Alpha",
        amount: 10000,
        releaseDate: "2026-08-20",
        bankRef: "UTR123456",
        status: "credited",
      },
      source: "api",
    });

    render(await GrantDisbursementDetailPage({ params: { id: "disb-1" } }));

    const backLinks = screen.getAllByRole("link", { name: "Back" });
    expect(backLinks).toHaveLength(1);
    expect(backLinks[0]).toHaveAttribute("href", "/grants/releases");
    expect(document.querySelectorAll('nav[aria-label="Breadcrumb"]')).toHaveLength(0);
    expect(document.querySelectorAll("span.back")).toHaveLength(1);
  });

  it("renders exactly one breadcrumb back-link on the not-found branch", async () => {
    getGrantDisbursementByIdMock.mockResolvedValue({ data: null, source: "api" });

    render(await GrantDisbursementDetailPage({ params: { id: "missing" } }));

    const backLinks = screen.getAllByRole("link", { name: "Back" });
    expect(backLinks).toHaveLength(1);
    expect(backLinks[0]).toHaveAttribute("href", "/grants/releases");
    expect(document.querySelectorAll('nav[aria-label="Breadcrumb"]')).toHaveLength(0);
    expect(document.querySelectorAll("span.back")).toHaveLength(1);
  });
});
