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

import { InstallmentsTable } from "./InstallmentsTable";
import type { GrantInstallmentSummary } from "@civitasone/types";

const ROW: GrantInstallmentSummary = {
  id: "inst-1",
  grantNo: "GR-2026-04",
  granteeName: "District Panchayat, Nashik",
  installmentNo: 1,
  amount: "500000",
  scheduledDate: "2026-10-01",
  releasedDate: null,
  status: "pending",
} as unknown as GrantInstallmentSummary;

describe("InstallmentsTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("releases a pending installment against the correct proxied endpoint and refreshes on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    render(<InstallmentsTable installments={[ROW]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Release" }));
    await waitFor(() => expect(screen.getByText(/Release installment #1\?/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Reason \/ approval reference/), { target: { value: "Sanctioned per GO 441" } });
    fireEvent.click(screen.getByRole("button", { name: "Release funds" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/grants/installments/inst-1/disburse");
  });

  // UX-016: postAction used to build the error from `Action failed
  // (${status}). ${rawResponseText}` verbatim. It must now show only the
  // catalogued, clerk-safe copy — never the raw server text.
  it("shows a clerk-safe error, not the raw server text, when the release fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("pfms-gateway: beneficiary bank account frozen (code PFMS_ACC_FROZEN)", { status: 422 }),
    );

    render(<InstallmentsTable installments={[ROW]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Release" }));
    await waitFor(() => expect(screen.getByText(/Release installment #1\?/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Reason \/ approval reference/), { target: { value: "Sanctioned per GO 441" } });
    fireEvent.click(screen.getByRole("button", { name: "Release funds" }));

    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText(/PFMS_ACC_FROZEN/)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
