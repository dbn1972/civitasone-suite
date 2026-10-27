import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@/test-utils/intl-render";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { DowngradeQueue, type PendingDowngrade } from "./DowngradeQueue";

const REQ = crypto.randomUUID();
const TENANT = crypto.randomUUID();
const rows: PendingDowngrade[] = [{
  id: REQ, tenantId: TENANT, fromPlanId: crypto.randomUUID(), targetPlanId: crypto.randomUUID(),
  reason: "Headcount drops after the restructuring", requestedAt: "2026-10-20T08:00:00Z",
}];
const short = REQ.slice(0, 8);
const dialogButton = (dialog: HTMLElement, label: string) =>
  Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === label) as HTMLButtonElement;

describe("DowngradeQueue (F8: platform billing decides, approval applies at period end)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refresh.mockClear(); });

  it("lists the pending request with the reason the tenant gave", () => {
    render(<DowngradeQueue rows={rows} />);
    expect(screen.getByText("Headcount drops after the restructuring")).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(`Approve: ${short}`) })).toBeTruthy();
  });

  it("approve needs no reason, posts the decision once for the right tenant, and says it applies at period end", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<DowngradeQueue rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Approve: ${short}`) }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/end of its current billing period/i);
    const confirm = dialogButton(dialog, "Approve");
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/proxy/v1/tenant/subscription/downgrade-requests/${REQ}/decision`);
    expect(JSON.parse(String(init.body))).toEqual({ tenantId: TENANT, decision: "approve" });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/end of the billing period/i));
    expect(refresh).toHaveBeenCalled();
  });

  it("reject is blocked until a reason is given, then posts it", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<DowngradeQueue rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Reject: ${short}`) }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = dialogButton(dialog, "Reject");
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Reason/i), { target: { value: "Contract runs to March" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String((spy.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ tenantId: TENANT, decision: "reject", reason: "Contract runs to March" });
  });

  it("a server refusal shows a plain-language error, not the raw server text, and no success message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "SELF_APPROVAL", message: "raw server text" }), { status: 403 }));
    render(<DowngradeQueue rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Approve: ${short}`) }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(dialogButton(dialog, "Approve"));
    await waitFor(() => expect(dialog.textContent).toMatch(/not allowed|permission|can.t|cannot/i));
    expect(dialog.textContent).not.toContain("raw server text");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows an empty state when nothing is waiting", () => {
    render(<DowngradeQueue rows={[]} />);
    expect(screen.getByText("No downgrade requests are waiting.")).toBeTruthy();
  });
});
