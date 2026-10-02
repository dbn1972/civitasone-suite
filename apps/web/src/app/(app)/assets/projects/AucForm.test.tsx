import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AucForm, parseOpeningCost } from "./AucForm";

describe("AucForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a project code and name before opening the confirm dialog", () => {
    render(<AucForm />);
    fireEvent.click(screen.getByRole("button", { name: "Create AUC project" }));
    expect(screen.getByText("Project code is required.")).toBeInTheDocument();
    expect(screen.queryByText("Create this AUC project?")).not.toBeInTheDocument();
  });

  it("rejects an amount with more than two decimal places", () => {
    render(<AucForm />);
    fireEvent.change(screen.getByLabelText(/Project code/), { target: { value: "AUC-010" } });
    fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: "New Wing" } });
    fireEvent.change(screen.getByLabelText(/Accumulated cost/), { target: { value: "100.005" } });
    fireEvent.click(screen.getByRole("button", { name: "Create AUC project" }));
    expect(screen.getByText(/Enter a valid amount in rupees/)).toBeInTheDocument();
  });

  it("creates an AUC project on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "auc-1" }), { status: 202 }),
    );

    render(<AucForm />);
    fireEvent.change(screen.getByLabelText(/Project code/), { target: { value: "AUC-010" } });
    fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: "New Wing" } });
    fireEvent.change(screen.getByLabelText(/Accumulated cost/), { target: { value: "15000.50" } });

    fireEvent.click(screen.getByRole("button", { name: "Create AUC project" }));
    await waitFor(() => expect(screen.getByText("Create this AUC project?")).toBeInTheDocument());
    // GAP-ASSETS-PROJECTS-05: the confirm button stays disabled until a reason is typed.
    expect(screen.getByRole("button", { name: "Confirm & create" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Sanctioned vide order 12/2026" } });
    fireEvent.click(screen.getByText("Confirm & create"));

    await waitFor(() => {
      expect(screen.getByText(/AUC project "AUC-010" created\./)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string) as { amountMinor: number; reason?: string };
    expect(body.reason).toBe("Sanctioned vide order 12/2026");
    // 15000.50 rupees -> 1500050 paise via rupeesToMinorString (no float 100x drift).
    expect(body.amountMinor).toBe(1500050);
  });

  it("surfaces a clerk-safe message on the confirm dialog, never the server's raw code/message (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "VALIDATION_FAILED", message: "invalid request" }), { status: 400 }),
    );

    render(<AucForm />);
    fireEvent.change(screen.getByLabelText(/Project code/), { target: { value: "AUC-011" } });
    fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: "Depot Extension" } });

    fireEvent.click(screen.getByRole("button", { name: "Create AUC project" }));
    await waitFor(() => expect(screen.getByText("Create this AUC project?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Board approval" } });
    fireEvent.click(screen.getByText("Confirm & create"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/VALIDATION_FAILED: invalid request/)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("accepts an explicit 0 / 0.00 and a blank opening cost, and records zero (GAP-ASSETS-PROJECTS-03)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "auc-0" }), { status: 202 }));
    render(<AucForm />);
    fireEvent.change(screen.getByLabelText(/Project code/), { target: { value: "AUC-020" } });
    fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: "Zero start" } });
    fireEvent.change(screen.getByLabelText(/Accumulated cost/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Create AUC project" }));
    await waitFor(() => expect(screen.getByText("Create this AUC project?")).toBeInTheDocument());
    expect(screen.queryByText(/Enter a valid amount/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Opening WIP" } });
    fireEvent.click(screen.getByText("Confirm & create"));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((JSON.parse((call[1] as RequestInit).body as string) as { amountMinor: number }).amountMinor).toBe(0);
  });

  it("parseOpeningCost: zero ok, negatives / sub-paise / unsafe-integer rejected (GAP-ASSETS-PROJECTS-03/-04)", () => {
    expect(parseOpeningCost("")).toEqual({ ok: true, minor: "0" });
    expect(parseOpeningCost("0")).toEqual({ ok: true, minor: "0" });
    expect(parseOpeningCost("0.00")).toEqual({ ok: true, minor: "0" });
    expect(parseOpeningCost("15000.50")).toEqual({ ok: true, minor: "1500050" });
    expect(parseOpeningCost("-1")).toEqual({ ok: false, reason: "invalid" });
    expect(parseOpeningCost("1.005")).toEqual({ ok: false, reason: "invalid" });
    expect(parseOpeningCost("99999999999999999")).toEqual({ ok: false, reason: "too_large" });
    expect(parseOpeningCost("90071992547409.91")).toEqual({ ok: true, minor: "9007199254740991" });
    expect(parseOpeningCost("90071992547409.92")).toEqual({ ok: false, reason: "too_large" });
  });

  it("blocks an amount above the safe-integer paise limit instead of posting a rounded value (GAP-ASSETS-PROJECTS-04)", () => {
    vi.spyOn(globalThis, "fetch");
    render(<AucForm />);
    fireEvent.change(screen.getByLabelText(/Project code/), { target: { value: "AUC-030" } });
    fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: "Huge" } });
    fireEvent.change(screen.getByLabelText(/Accumulated cost/), { target: { value: "99999999999999999" } });
    fireEvent.click(screen.getByRole("button", { name: "Create AUC project" }));
    expect(screen.getByText(/too large to record/)).toBeInTheDocument();
    expect(screen.queryByText("Create this AUC project?")).not.toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("is disabled with a notice while the register could not be loaded (GAP-ASSETS-PROJECTS-01)", () => {
    render(<AucForm disabledReason="The AUC register could not be loaded." />);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.getByRole("button", { name: "Create AUC project" })).toBeDisabled();
  });
});
