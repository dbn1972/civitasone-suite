import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ObservationActions } from "./ObservationActions";

const OBS_ID = "3d5f9c1a-0000-4444-8888-000000000001";

describe("ObservationActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("records a reply against the correct proxied endpoint and refreshes on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    render(<ObservationActions obsId={OBS_ID} department="Finance Wing" />);
    fireEvent.click(screen.getByRole("button", { name: "Record Reply" }));
    fireEvent.change(screen.getByLabelText("Compliance reply"), { target: { value: "Vouchers now attached." } });
    fireEvent.click(screen.getByRole("button", { name: "Record reply" }));

    await waitFor(() => expect(screen.getByText("Record auditee reply?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Reason \/ ATN reference/), { target: { value: "ATN-441" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm & record" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/audit/observations/${OBS_ID}/reply`);
  });

  // UX-016: this used to build the error from `Action failed (${status}).
  // ${rawResponseText}` verbatim. It must now show only the catalogued,
  // clerk-safe copy — never the raw server text.
  it("shows a clerk-safe error, not the raw server text, when the confirmed action fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("workflow_service: observation already closed", { status: 409 }),
    );

    render(<ObservationActions obsId={OBS_ID} department="Finance Wing" />);
    fireEvent.click(screen.getByRole("button", { name: "Record Reply" }));
    fireEvent.change(screen.getByLabelText("Compliance reply"), { target: { value: "Vouchers now attached." } });
    fireEvent.click(screen.getByRole("button", { name: "Record reply" }));
    await waitFor(() => expect(screen.getByText("Record auditee reply?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Reason \/ ATN reference/), { target: { value: "ATN-441" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm & record" }));

    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText(/observation already closed/)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
