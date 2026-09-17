import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { LogObservationButton } from "./LogObservationButton";

describe("LogObservationButton", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  function openAndFillDialog() {
    fireEvent.click(screen.getByRole("button", { name: "+ Log Observation" }));
    fireEvent.change(screen.getByLabelText("Observation no."), { target: { value: "OBS-2026-001" } });
    fireEvent.change(screen.getByLabelText("Auditee (dept / unit ref)"), { target: { value: "Finance Wing" } });
    fireEvent.change(screen.getByLabelText("Finding"), { target: { value: "Missing supporting vouchers." } });
  }

  it("submits the observation to the correct proxied endpoint and refreshes on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 201 }));

    render(<LogObservationButton />);
    openAndFillDialog();
    fireEvent.click(screen.getByRole("button", { name: "Log observation" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/audit/observations");
    expect((init as RequestInit).method).toBe("POST");
  });

  // UX-016: this used to build the error from `Could not log observation
  // (${status}). ${rawResponseText}` verbatim. It must now show only the
  // catalogued, clerk-safe copy — never the raw server text.
  it("shows a clerk-safe error, not the raw server text, on a failed submit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("duplicate key value violates unique constraint \"obs_no_idx\"", { status: 409 }),
    );

    render(<LogObservationButton />);
    openAndFillDialog();
    fireEvent.click(screen.getByRole("button", { name: "Log observation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't save/i);
    expect(screen.queryByText(/unique constraint/)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
