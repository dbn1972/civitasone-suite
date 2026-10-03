import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ActiveToggle, type ActiveToggleCopy } from "./ActiveToggle";

const COPY: ActiveToggleCopy = {
  deactivateBtn: "Deactivate DDO",
  reactivateBtn: "Reactivate DDO",
  deactivateTitle: "Deactivate this DDO?",
  reactivateTitle: "Reactivate this DDO?",
  deactivateDescription: "No new runs.",
  reactivateDescription: "Runs allowed again.",
  reasonLabel: "Reason",
  deactivatedMessage: "DDO deactivated.",
  reactivatedMessage: "DDO reactivated.",
  conflictMessage: "Still has active pensioners.",
  networkError: "Network error.",
};

describe("ActiveToggle (GAP-PAYROLL-DDOS-03 / PAY-GROUPS-03)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("deactivates with a reason via PATCH <path> { active:false, reason }", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    render(<ActiveToggle path="v1/payroll/ddos/DDO01/status" active copy={COPY} />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate DDO" }));
    await screen.findByText("Deactivate this DDO?");
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Merged into DDO02" } });
    const buttons = screen.getAllByRole("button", { name: "Deactivate DDO" });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("v1/payroll/ddos/DDO01/status");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ active: false, reason: "Merged into DDO02" });
    await waitFor(() => expect(screen.getByText("DDO deactivated.")).toBeInTheDocument());
    expect(refreshMock).toHaveBeenCalled();
  });

  it("will not confirm without a reason of at least 10 characters", async () => {
    render(<ActiveToggle path="v1/payroll/ddos/DDO01/status" active copy={COPY} />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate DDO" }));
    await screen.findByText("Deactivate this DDO?");
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "short" } });
    const buttons = screen.getAllByRole("button", { name: "Deactivate DDO" });
    expect((buttons[buttons.length - 1] as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows one plain sentence for a 409 DDO_IN_USE, never the backend text", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "DDO_IN_USE", message: "DDO D1 still has 3 active pensioner(s)" }), { status: 409 }));
    render(<ActiveToggle path="v1/payroll/ddos/DDO01/status" active copy={COPY} />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate DDO" }));
    await screen.findByText("Deactivate this DDO?");
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Merged into DDO02" } });
    const buttons = screen.getAllByRole("button", { name: "Deactivate DDO" });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(screen.getByText("Still has active pensioners.")).toBeInTheDocument());
    expect(screen.queryByText(/3 active pensioner/)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("offers Reactivate for an inactive record and sends active:true", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    render(<ActiveToggle path="v1/payroll/pay-groups/g1/status" active={false} copy={COPY} />);
    fireEvent.click(screen.getByRole("button", { name: "Reactivate DDO" }));
    await screen.findByText("Reactivate this DDO?");
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Needed again in FY27" } });
    const buttons = screen.getAllByRole("button", { name: "Reactivate DDO" });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).active).toBe(true);
  });
});
