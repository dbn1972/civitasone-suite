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

import TenderDetailPage from "./page";

// quotations result is fetched first, then the tender register.
function mockFetches(
  quotations: { data: unknown[]; source: string },
  tenders: { data: unknown[]; source: string },
) {
  fetchJsonMock.mockResolvedValueOnce(quotations).mockResolvedValueOnce(tenders);
}

describe("TenderDetailPage — reachability (L1)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    notFoundMock.mockClear();
  });

  it("404s a bogus tender id instead of rendering a shell for a non-existent tender", async () => {
    mockFetches(
      { data: [], source: "api" },
      { data: [{ id: "some-other-tender" }], source: "api" },
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
        data: [
          {
            id: "t-valid",
            workId: "w1",
            workNumber: "WRK-2026-001",
            tenderType: "open",
            tenderCategory: "civil",
            status: "open",
          },
        ],
        source: "api",
      },
    );

    const ui = await TenderDetailPage({ params: { id: "t-valid" } });
    render(<ToastProvider>{ui}</ToastProvider>);

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByText("Tender — WRK-2026-001")).toBeInTheDocument();
  });

  it("does NOT 404 when the register fails to load (transient error, not a missing record)", async () => {
    mockFetches(
      { data: [], source: "error" },
      { data: [], source: "error" },
    );

    const ui = await TenderDetailPage({ params: { id: "anything" } });
    render(<ToastProvider>{ui}</ToastProvider>);
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});
