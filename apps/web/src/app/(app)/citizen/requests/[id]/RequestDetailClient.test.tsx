import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { RequestDetailClient } from "./RequestDetailClient";
import enMessages from "@/messages/en.json";
import type { Grievance } from "../../_data/loaders";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const mockGrievance: Grievance = {
  id: "gr1",
  category: "sanitation",
  subject: "Garbage not collected",
  description: "5 days uncollected",
  priority: "high",
  status: "open",
  departmentRef: "Sanitation Dept",
  assignedTo: null,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-02T00:00:00Z",
  actions: [],
};

function renderClient(props: Partial<Parameters<typeof RequestDetailClient>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RequestDetailClient id="gr1" {...props} />
    </NextIntlClientProvider>,
  );
}

describe("RequestDetailClient -- PERF-009 tranche 2 (SSR loader integration)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the server-provided grievance immediately and does NOT fetch on mount when the server loader succeeded", async () => {
    renderClient({ initialGrievance: mockGrievance, initialSource: "api" });

    // Real data is visible on the very first render -- no loading state.
    expect(screen.getByText("Garbage not collected")).toBeInTheDocument();

    // Give any effect a tick to (not) fire, then assert fetch was never called.
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
  });

  it("renders not-found immediately (no fetch) when the server loader succeeded with no record", async () => {
    renderClient({ initialGrievance: null, initialSource: "api" });

    expect(await screen.findByText(enMessages.citizenRequests.notFoundTitle)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to the original client-side fetch on mount when the server loader errored (unchanged pre-existing behavior)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockGrievance,
    });

    renderClient({ initialSource: "error" });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    // UX-fetch-cancellation: the mount-time fetch is now threaded an
    // AbortSignal (cleaned up on unmount) -- see load()'s AbortController.
    expect(fetch).toHaveBeenCalledWith("/api/proxy/v1/citizen/grievances/gr1", { cache: "no-store", signal: expect.any(AbortSignal) });
    expect(await screen.findByText("Garbage not collected")).toBeInTheDocument();
  });

  it("falls back to fetching on mount when no initial props are given at all (default matches pre-existing behavior)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockGrievance,
    });

    renderClient();

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });
});
