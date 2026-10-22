import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { ToastProvider } from "@/app/_components/ds";
import { BillPassPayActions, billPassBlockedReason, billSodConflict } from "./FinanceActions";

type ActorProps = Partial<Pick<React.ComponentProps<typeof BillPassPayActions>, "canPass" | "canRelease" | "viewerId" | "createdBy" | "passedBy">>;

function renderActions(status: string, threeWayMatch?: string, actors: ActorProps = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ToastProvider>
        <BillPassPayActions id="b1" status={status} {...(threeWayMatch ? { threeWayMatch } : {})} {...actors} />
      </ToastProvider>
    </NextIntlClientProvider>,
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
  it("hides the release link when canRelease is false (the officer created or passed the bill)", () => {
    renderActions("passed", "matched", { canRelease: false });
    expect(screen.queryByRole("link", { name: "Release payment" })).not.toBeInTheDocument();
  });
  it("offers no release link while the bill is not yet passed", () => {
    renderActions("pending", "matched");
    expect(screen.queryByRole("link", { name: "Release payment" })).not.toBeInTheDocument();
  });
});

// GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-03: the maker-checker rules finance-service enforces (self-approval -> 409
// MAKER_CHECKER_VIOLATION, payer == passer -> 409 PAYER_IS_PASSER), mirrored so the page does not offer a doomed action.
const LODGER = "00000000-aaaa-4000-8000-000000000001";
const PASSER = "00000000-bbbb-4000-8000-000000000002";
const OTHER = "00000000-cccc-4000-8000-000000000003";

describe("billSodConflict", () => {
  it("pass: only the officer who lodged the bill is blocked", () => {
    expect(billSodConflict("pass", LODGER, LODGER, null)).toBe("lodger");
    expect(billSodConflict("pass", OTHER, LODGER, null)).toBeNull();
  });
  it("release: the lodger and the passer are blocked, anyone else is not", () => {
    expect(billSodConflict("release", LODGER, LODGER, PASSER)).toBe("lodger");
    expect(billSodConflict("release", PASSER, LODGER, PASSER)).toBe("passer");
    expect(billSodConflict("release", OTHER, LODGER, PASSER)).toBeNull();
  });
  it("never blocks an unknown viewer or an unknown lodger (the server decides)", () => {
    expect(billSodConflict("pass", null, LODGER, PASSER)).toBeNull();
    expect(billSodConflict("release", undefined, LODGER, PASSER)).toBeNull();
    expect(billSodConflict("pass", OTHER, null, null)).toBeNull();
    expect(billSodConflict("release", OTHER, undefined, undefined)).toBeNull();
  });
});

describe("BillPassPayActions maker-checker gating", () => {
  it("withholds Pass bill from the officer who lodged the bill and says why", () => {
    renderActions("pending", "matched", { viewerId: LODGER, createdBy: LODGER });
    expect(screen.queryByRole("button", { name: "Pass bill" })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("You lodged this bill, so another officer must pass it.");
  });
  it("offers Pass bill to a different officer", () => {
    renderActions("pending", "matched", { viewerId: OTHER, createdBy: LODGER });
    expect(screen.getByRole("button", { name: "Pass bill" })).toBeEnabled();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
  it("keeps Pass bill (disabled with its reason) on a bill that is no longer awaiting a pass, even for the lodger", () => {
    renderActions("paid", "matched", { viewerId: LODGER, createdBy: LODGER });
    expect(screen.getByRole("button", { name: "Pass bill" })).toBeDisabled();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("withholds Release payment from the officer who passed the bill, with the reason", () => {
    renderActions("passed", "matched", { viewerId: PASSER, createdBy: LODGER, passedBy: PASSER });
    expect(screen.queryByRole("link", { name: "Release payment" })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("You passed this bill, so another officer must release its payment.");
  });
  it("withholds Release payment from the officer who lodged the bill, with the reason", () => {
    renderActions("passed", "matched", { viewerId: LODGER, createdBy: LODGER, passedBy: PASSER });
    expect(screen.queryByRole("link", { name: "Release payment" })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("You lodged this bill, so another officer must release its payment.");
  });
  it("offers Release payment to a third officer", () => {
    renderActions("passed", "matched", { viewerId: OTHER, createdBy: LODGER, passedBy: PASSER });
    expect(screen.getByRole("link", { name: "Release payment" })).toHaveAttribute("href", "/finance/payments/new?billId=b1");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
  it("hides Release payment from roles the payments route would 403, and says nothing about it", () => {
    renderActions("passed", "matched", { canRelease: false, viewerId: OTHER, createdBy: LODGER, passedBy: PASSER });
    expect(screen.queryByRole("link", { name: "Release payment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
