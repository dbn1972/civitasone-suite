import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "@/app/_components/ds/Toast";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Session roles come from the JWT cookie via next/headers; stub them so the
// (server) detail page can compute canDaoFinalize/canDoFinalize in jsdom.
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => ["works_admin"],
  hasAnyRole: (roles: string[], allowed: string[]) => allowed.some((r) => roles.includes(r)),
}));

import TenderDetailPage from "./page";

// quotations result is fetched first, then the single tender by id.
function mockFetches(
  quotations: { data: unknown[]; source: string },
  tender: { data: unknown | null; source: string },
) {
  fetchJsonMock.mockResolvedValueOnce(quotations).mockResolvedValueOnce(tender);
}

describe("TenderDetailPage — reachability (L1)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    notFoundMock.mockClear();
  });

  it("404s a bogus tender id instead of rendering a shell for a non-existent tender", async () => {
    mockFetches(
      { data: [], source: "api" },
      { data: null, source: "api" },
    );

    await expect(TenderDetailPage({ params: { id: "does-not-exist" } })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("renders the detail for a real tender id (no 404)", async () => {
    mockFetches(
      { data: [], source: "api" },
      {
        data: {
          id: "t-valid",
          workId: "w1",
          workNumber: "WRK-2026-001",
          tenderType: "open",
          tenderCategory: "civil",
          status: "open",
        },
        source: "api",
      },
    );

    const ui = await TenderDetailPage({ params: { id: "t-valid" } });
    render(<ToastProvider>{ui}</ToastProvider>);

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByText("Tender — WRK-2026-001")).toBeInTheDocument();
  });

  it("exposes a #quotations anchor the Awarded stat links to (GAP-WORKS-TENDERS-05)", async () => {
    mockFetches(
      { data: [], source: "api" },
      {
        data: { id: "t-valid", workId: "w1", workNumber: "WRK-2026-001", tenderType: "open", status: "open" },
        source: "api",
      },
    );
    const ui = await TenderDetailPage({ params: { id: "t-valid" } });
    const { container } = render(<ToastProvider>{ui}</ToastProvider>);
    expect(container.querySelector("#quotations")).not.toBeNull();
    const awarded = screen.getByText("Awarded").closest("a");
    expect(awarded).toHaveAttribute("href", "#quotations");
  });

  it("does NOT 404 when the by-id read fails (transient error, not a missing record)", async () => {
    mockFetches(
      { data: [], source: "error" },
      { data: null, source: "error" },
    );

    const ui = await TenderDetailPage({ params: { id: "anything" } });
    render(<ToastProvider>{ui}</ToastProvider>);
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});
