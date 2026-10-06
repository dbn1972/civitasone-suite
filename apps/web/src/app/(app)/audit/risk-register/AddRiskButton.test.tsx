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

    expect(await screen.findByRole("alert")).toHaveTextContent(/This risk was changed by someone else\. Refresh to see the latest version, then try again\./);
    expect(screen.queryByText(/risk_code already exists/)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // GAP-AUDIT-RISK-REGISTER-01: the dialog must preview score = L x I live,
  // matching the server formula (default possible x moderate = 9, Medium).
  it("previews the score and band live, matching the server formula", () => {
    render(<AddRiskButton />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Risk" }));

    // Default possible(3) x moderate(3) = 9 => Medium.
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText(/Medium/)).toBeInTheDocument();

    // Change to almost_certain x catastrophic = 25 => High.
    fireEvent.change(screen.getByLabelText("Likelihood"), { target: { value: "almost_certain" } });
    fireEvent.change(screen.getByLabelText("Impact"), { target: { value: "catastrophic" } });
    expect(screen.getByText("25")).toBeInTheDocument();
    expect(screen.getByText(/High/)).toBeInTheDocument();
  });

  // GAP-AUDIT-RISK-REGISTER-04: option text is human-readable, not raw enums.
  it("renders human-readable category / likelihood / impact option labels", () => {
    render(<AddRiskButton />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Risk" }));

    expect(screen.getByRole("option", { name: "IT" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Almost certain" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Catastrophic" })).toBeInTheDocument();
  });
});
