import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AddRiskButton } from "./AddRiskButton";

describe("AddRiskButton", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  function openAndFillDialog() {
    fireEvent.click(screen.getByRole("button", { name: "+ Add Risk" }));
    fireEvent.change(screen.getByLabelText("Risk code"), { target: { value: "RISK-2026-007" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Vendor concentration in payments" } });
  }

  it("submits the risk to the correct proxied endpoint and refreshes on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 201 }));

    render(<AddRiskButton />);
    openAndFillDialog();
    fireEvent.click(screen.getByRole("button", { name: "Add risk" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/audit/risks");
  });

  // UX-016: this used to build the error from `Could not add risk
  // (${status}). ${rawResponseText}` verbatim. It must now show only the
  // catalogued, clerk-safe copy — never the raw server text.
  it("shows a clerk-safe error, not the raw server text, on a failed submit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("risk_code already exists", { status: 409 }),
    );

    render(<AddRiskButton />);
    openAndFillDialog();
    fireEvent.click(screen.getByRole("button", { name: "Add risk" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't save/i);
    expect(screen.queryByText(/risk_code already exists/)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
