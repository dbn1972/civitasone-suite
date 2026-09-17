import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { PlanAuditButton } from "./PlanAuditButton";

describe("PlanAuditButton", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  function openAndFillDialog() {
    fireEvent.click(screen.getByRole("button", { name: "+ Plan Audit" }));
    fireEvent.change(screen.getByLabelText("Plan no."), { target: { value: "PLAN-FY26-03" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Procurement compliance audit" } });
    fireEvent.change(screen.getByLabelText("Audit area / unit"), { target: { value: "Procurement Wing" } });
    fireEvent.change(screen.getByLabelText("Planned from"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Planned to"), { target: { value: "2026-10-31" } });
  }

  it("submits the plan to the correct proxied endpoint and refreshes on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 201 }));

    render(<PlanAuditButton />);
    openAndFillDialog();
    fireEvent.click(screen.getByRole("button", { name: "Plan audit" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/audit/plans");
  });

  // UX-016: this used to build the error from `Could not plan audit
  // (${status}). ${rawResponseText}` verbatim. It must now show only the
  // catalogued, clerk-safe copy — never the raw server text.
  it("shows a clerk-safe error, not the raw server text, on a failed submit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("plan_no already exists for this fiscal year", { status: 409 }),
    );

    render(<PlanAuditButton />);
    openAndFillDialog();
    fireEvent.click(screen.getByRole("button", { name: "Plan audit" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't save/i);
    expect(screen.queryByText(/already exists for this fiscal year/)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
