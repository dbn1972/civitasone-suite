import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ClaimActions } from "./ClaimActions";

describe("ClaimActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("blocks a settlement above the claim amount client-side and sends nothing", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    render(<ClaimActions claimId="c1" claimAmountMinor="800000" />);
    fireEvent.change(screen.getByLabelText(/Settled amount/), { target: { value: "9000" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle claim" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot be more than the claim amount/);
    expect(screen.queryByText("Settle this claim?")).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("settles after confirm: PATCH with integer paise and the x-idempotency-key header, then refreshes", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "c1" }), { status: 200 }));
    render(<ClaimActions claimId="c1" claimAmountMinor="800000" />);
    fireEvent.change(screen.getByLabelText(/Settled amount/), { target: { value: "7500.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle claim" }));
    await waitFor(() => expect(screen.getByText("Settle this claim?")).toBeInTheDocument());
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Settle claim" }).at(-1)!);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe("/api/proxy/v1/assets/insurance/claims/c1/settle");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ settlementAmountMinor: 750050, currency: "INR" });
    expect(((init as RequestInit).headers as Record<string, string>)["x-idempotency-key"]).toBeTruthy();
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("reject keeps Confirm disabled until a reason is typed, then PATCHes the reason", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "c1" }), { status: 200 }));
    render(<ClaimActions claimId="c1" claimAmountMinor="800000" />);
    fireEvent.click(screen.getByRole("button", { name: "Reject claim" }));
    await waitFor(() => expect(screen.getByText("Reject this claim?")).toBeInTheDocument());
    const confirm = screen.getAllByRole("button", { name: "Reject claim" }).at(-1)!;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for rejection"), { target: { value: "Not covered" } });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(String(spy.mock.calls[0]![0])).toBe("/api/proxy/v1/assets/insurance/claims/c1/reject");
    expect(JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ reason: "Not covered" });
  });

  it("shows a server refusal inside the settle dialog", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "CLAIM_NOT_DECIDABLE" }), { status: 409 }));
    render(<ClaimActions claimId="c1" claimAmountMinor="800000" />);
    fireEvent.change(screen.getByLabelText(/Settled amount/), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle claim" }));
    await waitFor(() => expect(screen.getByText("Settle this claim?")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Settle claim" }).at(-1)!);
    await waitFor(() => expect(screen.getByText(/This information was changed by someone else\. Refresh to see the latest version, then try again\./)).toBeInTheDocument());
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
