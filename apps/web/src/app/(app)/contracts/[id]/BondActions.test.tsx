import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { BondActions } from "./BondActions";

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
});
