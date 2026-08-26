import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
let searchParamsMock = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsMock,
}));

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

import RecordProgressPage from "./page";

describe("RecordProgressPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
    searchParamsMock = new URLSearchParams();
  });

  it("describes progress as a per-period increment added to the running total, not a cumulative replacement", () => {
    render(<RecordProgressPage />);
    // The field is now labelled as this period's progress...
    expect(screen.getByLabelText(/Progress this period/i)).toBeInTheDocument();
    // ...and the guidance says it is ADDED to the cumulative total (matching the
    // backend, which treats currentAchievement as a delta).
    expect(screen.getByText(/added to the running cumulative total/i)).toBeInTheDocument();
    // The previous, incorrect instruction ("enter the cumulative ... not the
    // period increment") must be gone — following it double-counted progress.
    expect(
      screen.queryByText(/cumulative achievement to date, not the period increment/i),
    ).toBeNull();
  });

  it("loads the work's scopes into a dropdown when arriving with ?workId", async () => {
    searchParamsMock = new URLSearchParams("workId=work-123");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: "scope-abc", scopeName: "Earthwork", targetQuantity: "100", unit: "cum" }] }),
        { status: 200 },
      ),
    );

    render(<RecordProgressPage />);

    // Consumes the workId param to fetch that work's scopes.
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/proxy/v1/works/execution/work-123/scopes",
        expect.anything(),
      ),
    );
    // Renders the scope as a selectable option (no raw-UUID paste needed).
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /Earthwork/i })).toBeInTheDocument(),
    );
  });

  it("falls back to manual scope-id entry when the work has no scopes", async () => {
    searchParamsMock = new URLSearchParams("workId=work-123");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );

    render(<RecordProgressPage />);

    await waitFor(() =>
      expect(
        screen.getByPlaceholderText(/123e4567-e89b-12d3-a456-426614174000/),
      ).toBeInTheDocument(),
    );
  });
});
