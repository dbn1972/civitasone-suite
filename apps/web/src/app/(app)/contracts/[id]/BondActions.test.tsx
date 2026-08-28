import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { BondActions } from "./BondActions";

const HELD_BOND = { id: "b1", referenceNo: "BG-1", status: "held" };

describe("BondActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("POSTs bond register and expects 202", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<BondActions contractId="c1" canRegister bonds={[]} />);
    fireEvent.change(screen.getByPlaceholderText("BG-…"), { target: { value: "BG-1" } });
    fireEvent.change(screen.getByPlaceholderText("100000"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Register bond" }));
    await waitFor(() => expect(screen.getByText(/registration accepted/i)).toBeInTheDocument());
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("/bonds");
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.amountMinor).toBe(100000);
  });

  it("shows error when register fails with non-202", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("bond rejected", { status: 409 }),
    );
    render(<BondActions contractId="c1" canRegister bonds={[]} />);
    fireEvent.change(screen.getByPlaceholderText("BG-…"), { target: { value: "BG-2" } });
    fireEvent.change(screen.getByPlaceholderText("100000"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Register bond" }));
    await waitFor(() => expect(screen.getByText(/bond rejected|failed/i)).toBeInTheDocument());
  });

  it("a held bond offers Release, Claim, and Forfeit, none of which fire without confirming", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<BondActions contractId="c1" canRegister={false} bonds={[HELD_BOND]} />);
    for (const label of ["Release", "Claim", "Forfeit"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Claim" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("releasing does not require a reason", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<BondActions contractId="c1" canRegister={false} bonds={[HELD_BOND]} />);
    fireEvent.click(screen.getByRole("button", { name: "Release" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, release" }));
    await waitFor(() => expect(screen.getByText(/bond released accepted/i)).toBeInTheDocument());
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("/api/proxy/v1/contract/contracts/c1/bonds/b1/transition");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.toStatus).toBe("released");
  });

  it("claiming requires a reason before the dialog can be confirmed, and sends it as notes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<BondActions contractId="c1" canRegister={false} bonds={[HELD_BOND]} />);
    fireEvent.click(screen.getByRole("button", { name: "Claim" }));
    const confirmBtn = screen.getByRole("button", { name: "Yes, claim" });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/reason \(recorded on the bond\)/i), {
      target: { value: "Vendor failed final inspection; work incomplete" },
    });
    expect(confirmBtn).toBeEnabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(screen.getByText(/bond claimed accepted/i)).toBeInTheDocument());
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toMatchObject({
      toStatus: "claimed",
      notes: "Vendor failed final inspection; work incomplete",
    });
  });

  it("a released/claimed/forfeited bond offers no transition buttons", () => {
    render(
      <BondActions
        contractId="c1"
        canRegister={false}
        bonds={[{ id: "b2", referenceNo: "BG-2", status: "released" }]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Release" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Claim" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Forfeit" })).not.toBeInTheDocument();
  });
});
