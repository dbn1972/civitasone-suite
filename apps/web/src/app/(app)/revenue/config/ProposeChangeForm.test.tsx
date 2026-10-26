import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ProposeChangeForm, type ChangeTarget } from "./ProposeChangeForm";

const TARGETS: ChangeTarget[] = [
  { id: "s1", kind: "rate_slab", label: "Flat slab ₹1,000.00 from 1 Apr 2026", slabType: "flat" },
  { id: "a1", kind: "rate_slab", label: "Ad valorem 12% from 1 Apr 2026", slabType: "ad_valorem" },
  { id: "p1", kind: "penalty_rule", label: "Simple 12% p.a." },
  { id: "r1", kind: "rebate_rule", label: "Early payment 5%" },
  { id: "h1", kind: "rate_head", label: "PT — Property tax" },
];

describe("ProposeChangeForm (owner decision #2: edits are new versions, deactivation is an end-date)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("proposes an END-DATE (deactivation) for a row", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { id: "prop-1" } }), { status: 202 }));
    render(<ProposeChangeForm targets={TARGETS} />);
    fireEvent.change(screen.getByLabelText(/^Row to change/), { target: { value: "p1" } });
    fireEvent.click(screen.getByLabelText("End-date (deactivate)"));
    fireEvent.change(screen.getByLabelText(/^Effective from/), { target: { value: "2099-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const env = JSON.parse(String((spy.mock.calls[0]![1] as RequestInit).body));
    expect(env).toEqual({ kind: "penalty_rule", action: "end_date", effectiveFrom: "2099-12-31", targetId: "p1", payload: {} });
    await waitFor(() => expect(screen.getByText(/submitted for approval/)).toBeInTheDocument());
    expect(refreshMock).toHaveBeenCalled();
  });

  it("proposes a NEW VERSION of a flat slab with the new rate in paise", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { id: "prop-2" } }), { status: 202 }));
    render(<ProposeChangeForm targets={TARGETS} />);
    fireEvent.change(screen.getByLabelText(/^Row to change/), { target: { value: "s1" } });
    fireEvent.click(screen.getByLabelText("New version"));
    fireEvent.change(screen.getByLabelText(/^New rate/), { target: { value: "1500" } });
    fireEvent.change(screen.getByLabelText(/^Effective from/), { target: { value: "2099-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const env = JSON.parse(String((spy.mock.calls[0]![1] as RequestInit).body));
    expect(env).toMatchObject({ kind: "rate_slab", action: "revise", targetId: "s1", effectiveFrom: "2099-04-01", payload: { rateValue: "150000" } });
  });

  it("converts a percent for an ad valorem slab and for penalty/rebate rules to basis points", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { id: "x" } }), { status: 202 }));
    const { unmount } = render(<ProposeChangeForm targets={TARGETS} />);
    fireEvent.change(screen.getByLabelText(/^Row to change/), { target: { value: "a1" } });
    fireEvent.click(screen.getByLabelText("New version"));
    fireEvent.change(screen.getByLabelText(/^New rate/), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText(/^Effective from/), { target: { value: "2099-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String((spy.mock.calls[0]![1] as RequestInit).body)).payload.rateValue).toBe("1500");
    unmount();
    render(<ProposeChangeForm targets={TARGETS} />);
    fireEvent.change(screen.getByLabelText(/^Row to change/), { target: { value: "p1" } });
    fireEvent.click(screen.getByLabelText("New version"));
    fireEvent.change(screen.getByLabelText(/^New annual rate/), { target: { value: "18" } });
    fireEvent.change(screen.getByLabelText(/^Effective from/), { target: { value: "2099-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String((spy.mock.calls[1]![1] as RequestInit).body)).payload.annualRateBps).toBe(1800);
  });

  it("offers only end-date for a rate head (a head is an identity, not versioned)", () => {
    render(<ProposeChangeForm targets={TARGETS} />);
    fireEvent.change(screen.getByLabelText(/^Row to change/), { target: { value: "h1" } });
    expect(screen.queryByLabelText("New version")).not.toBeInTheDocument();
    expect(screen.getByLabelText("End-date (deactivate)")).toBeChecked();
  });

  it("requires a row and an effective date before submitting", () => {
    render(<ProposeChangeForm targets={TARGETS} />);
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    expect(screen.getByText("Select the row to change.")).toBeInTheDocument();
    expect(screen.getByText("Enter the date the change takes effect.")).toBeInTheDocument();
  });

  it("surfaces a clerk-safe error, never the raw server code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { code: "EFFECTIVE_DATE_IN_PAST", message: "no" } }), { status: 422 }));
    render(<ProposeChangeForm targets={TARGETS} />);
    fireEvent.change(screen.getByLabelText(/^Row to change/), { target: { value: "p1" } });
    fireEvent.click(screen.getByLabelText("End-date (deactivate)"));
    fireEvent.change(screen.getByLabelText(/^Effective from/), { target: { value: "2099-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText(/EFFECTIVE_DATE_IN_PAST/)).not.toBeInTheDocument();
  });
});
