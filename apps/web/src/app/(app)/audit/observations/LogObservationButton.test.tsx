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
    // GAP-AUDIT-OBSERVATIONS-05: a confirm gate now stands between the form and
    // the POST. Clicking "Log observation" opens it; "Confirm & log" submits.
    fireEvent.click(screen.getByRole("button", { name: "Log observation" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm & log" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/audit/observations");
    expect((init as RequestInit).method).toBe("POST");
  });

  // GAP-AUDIT-OBSERVATIONS-05: clicking Log observation shows a confirm first;
  // no network call happens until the user confirms.
  it("does not POST until the confirm dialog is confirmed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 201 }));
    render(<LogObservationButton />);
    openAndFillDialog();
    fireEvent.click(screen.getByRole("button", { name: "Log observation" }));
    // Confirm dialog visible, but nothing sent yet.
    expect(await screen.findByRole("button", { name: "Confirm & log" })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // GAP-AUDIT-OBSERVATIONS-04: money is parsed with integer paise math. 250000.10
  // → "25000010" (never 25000010.000001 from float). >2dp is rejected.
  it("converts rupees to paise with integer math and sends amountInvolvedMinor", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 201 }));
    render(<LogObservationButton />);
    openAndFillDialog();
    fireEvent.change(screen.getByLabelText(/Money value/i), { target: { value: "250000.10" } });
    fireEvent.click(screen.getByRole("button", { name: "Log observation" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm & log" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body.amountInvolvedMinor).toBe("25000010");
  });

  it("rejects a money value with more than two decimal places (no float rounding)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 201 }));
    render(<LogObservationButton />);
    openAndFillDialog();
    fireEvent.change(screen.getByLabelText(/Money value/i), { target: { value: "1.005" } });
    fireEvent.click(screen.getByRole("button", { name: "Log observation" }));
    expect(await screen.findByText(/at most two decimal places/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
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
    fireEvent.click(await screen.findByRole("button", { name: "Confirm & log" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/This observation was changed by someone else\. Refresh to see the latest version, then try again\./);
    expect(screen.queryByText(/unique constraint/)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
