import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { RTIDetailClient } from "./RTIDetailClient";
import enMessages from "@/messages/en.json";
import type { RtiDetail } from "../../_data/loaders";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const mockRti: RtiDetail = {
  id: "rti-001",
  rtiNo: "RTI-001",
  subject: "Budget Expenditure Details FY 2024",
  description: "Seeking a breakdown of ward-level sanitation spend.",
  cpioRef: "CPIO-SANITATION-01",
  deadline: "2099-01-31T00:00:00Z",
  status: "received",
  statusLabel: "Received",
  isOverdue: false,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  responses: [],
  appeals: [],
};

function renderClient(props: Partial<Parameters<typeof RTIDetailClient>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RTIDetailClient id="rti-001" {...props} />
    </NextIntlClientProvider>,
  );
}

describe("RTIDetailClient -- PERF-009 tranche 3 (SSR loader integration)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the server-provided RTI application immediately and does NOT fetch on mount when the server loader succeeded", async () => {
    renderClient({ initialRti: mockRti, initialSource: "api" });

    // Real data is visible on the very first render -- no loading state.
    expect(screen.getByText("Budget Expenditure Details FY 2024")).toBeInTheDocument();

    // Give any effect a tick to (not) fire, then assert fetch was never called.
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });

  it("renders not-found immediately (no fetch) when the server loader succeeded with no record", async () => {
    renderClient({ initialRti: null, initialSource: "api" });

    expect(await screen.findByText(enMessages.citizenRti.notFoundTitle)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to the original client-side fetch on mount when the server loader errored (unchanged pre-existing behavior)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockRti,
    });

    renderClient({ initialSource: "error" });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    // UX-fetch-cancellation: the mount-time fetch is now threaded an
    // AbortSignal (cleaned up on unmount) -- see load()'s AbortController.
    expect(fetch).toHaveBeenCalledWith("/api/proxy/v1/citizen/rti/rti-001", { cache: "no-store", signal: expect.any(AbortSignal) });
    expect(await screen.findByText("Budget Expenditure Details FY 2024")).toBeInTheDocument();
  });

  it("falls back to fetching on mount when no initial props are given at all (default matches pre-existing behavior)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockRti,
    });

    renderClient();

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });
});
