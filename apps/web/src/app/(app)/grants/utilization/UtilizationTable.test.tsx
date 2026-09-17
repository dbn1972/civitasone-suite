import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: <T,>(_key: string, initialData: T) => ({
    data: initialData,
    provenance: "live",
    offline: false,
    cachedAt: null,
  }),
}));

import { UtilizationTable } from "./UtilizationTable";
import type { GrantUtilization } from "@civitasone/types";

const ROW: GrantUtilization = {
  id: "uc-1",
  ucNo: "UC-2026-11",
  grantNo: "GR-2026-04",
  granteeName: "District Panchayat, Nashik",
  amount: "500000",
  periodFrom: "2026-04-01",
  periodTo: "2026-09-30",
  submittedDate: "2026-10-01",
  status: "submitted",
} as unknown as GrantUtilization;

describe("UtilizationTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("verifies a submitted UC against the correct proxied endpoint and refreshes on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    render(<UtilizationTable ucs={[ROW]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(screen.getByText(/Verify UC UC-2026-11\?/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Verification remarks/), { target: { value: "Matches vouchers." } });
    fireEvent.click(screen.getByRole("button", { name: "Verify UC" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/grants/utilization-certs/uc-1/validate");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ status: "validated", remarks: "Matches vouchers." });
  });

  // UX-016: postAction used to build the error from `Action failed
  // (${status}). ${rawResponseText}` verbatim. It must now show only the
  // catalogued, clerk-safe copy — never the raw server text.
  it("shows a clerk-safe error, not the raw server text, when the verify fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("grant-service: uc already validated by another officer", { status: 409 }),
    );

    render(<UtilizationTable ucs={[ROW]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(screen.getByText(/Verify UC UC-2026-11\?/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Verification remarks/), { target: { value: "Matches vouchers." } });
    fireEvent.click(screen.getByRole("button", { name: "Verify UC" }));

    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText(/already validated by another officer/)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
