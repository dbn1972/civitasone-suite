import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { ToastProvider } from "@/app/_components/ds";
import { BillPassPayActions, billPassBlockedReason } from "./FinanceActions";

function renderActions(status: string, threeWayMatch?: string) {
  return render(
    <ToastProvider>
      <BillPassPayActions id="b1" status={status} {...(threeWayMatch ? { threeWayMatch } : {})} />
    </ToastProvider>,
  );
}

describe("billPassBlockedReason (GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-02)", () => {
  it("allows a pending, fully matched bill", () => {
    expect(billPassBlockedReason("pending", "matched")).toBeNull();
    expect(billPassBlockedReason("under_review", "matched")).toBeNull();
  });
  it("blocks paid / passed / rejected bills", () => {
    for (const s of ["paid", "passed", "rejected", "approved"]) expect(billPassBlockedReason(s, "matched")).toMatch(/pre-audit/);
  });
  it("blocks a bill whose 3-way match is incomplete", () => {
    for (const m of ["unmatched", "partial", "na", "pending"]) expect(billPassBlockedReason("pending", m)).toMatch(/3-way match/);
  });
});

describe("BillPassPayActions", () => {
  it("disables Pass bill for a paid bill and for a mismatched one", () => {
    const { unmount } = renderActions("paid", "matched");
    expect(screen.getByRole("button", { name: "Pass bill" })).toBeDisabled();
    unmount();
    renderActions("pending", "unmatched");
    expect(screen.getByRole("button", { name: "Pass bill" })).toBeDisabled();
  });

  it("enables Pass bill and sends the reason as `notes` (what approveBillBody accepts)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    renderActions("pending", "matched");
    const btn = screen.getByRole("button", { name: "Pass bill" });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    fireEvent.change(await screen.findByLabelText("Pre-audit officer & reason"), { target: { value: "checked PO+GRN" } });
    fireEvent.click(screen.getAllByText("Pass bill").pop() as HTMLElement);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/bills/b1/approve");
    expect(JSON.parse(init.body as string)).toEqual({ notes: "checked PO+GRN" });
  });

  it("Release payment links to the payment form for a passed bill (no one-line release POST)", () => {
    renderActions("passed", "matched");
    expect(screen.getByRole("link", { name: "Release payment" })).toHaveAttribute("href", "/finance/payments/new?billId=b1");
  });
  it("offers no release link while the bill is not yet passed", () => {
    renderActions("pending", "matched");
    expect(screen.queryByRole("link", { name: "Release payment" })).not.toBeInTheDocument();
  });
});
