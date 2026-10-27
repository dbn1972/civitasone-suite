import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@/test-utils/intl-render";

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, seed: unknown) => ({ data: seed, provenance: "live", offline: false, cachedAt: null }),
}));

import { PlansClient } from "./PlansClient";
import type { PlansData, DowngradeRequestSummary } from "@/app/_data/loaders";

const DATA: PlansData = {
  currentPlanId: "enterprise",
  trialDaysLeft: null,
  plans: [
    { id: "enterprise", name: "Enterprise", pricePerMonth: 500000, maxUsers: 500, storageGb: 500, maxApiCalls: 1000000, modules: ["finance", "hrms", "payroll"] },
    { id: "basic", name: "Basic", pricePerMonth: 100000, maxUsers: 50, storageGb: 50, maxApiCalls: 100000, modules: ["finance"] },
  ],
  invoices: [],
} as unknown as PlansData;

const open = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Request downgrade" }));
  return screen.findByRole("alertdialog");
};
const submitButton = (d: HTMLElement) => Array.from(d.querySelectorAll("button")).find((b) => b.textContent === "Submit request") as HTMLButtonElement;

describe("PlansClient downgrade request (owner decision #24)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("Submit stays disabled until a reason of 10+ characters is given; the dialog says it is a request", async () => {
    render(<PlansClient plansData={DATA} source="api" />);
    const dialog = await open();
    expect(dialog.textContent).toMatch(/platform billing reviews every downgrade/i);
    expect(submitButton(dialog).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Reason for the downgrade/i), { target: { value: "too short" } });
    expect(submitButton(dialog).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Reason for the downgrade/i), { target: { value: "Headcount drops after restructuring" } });
    expect(submitButton(dialog).disabled).toBe(false);
  });

  it("posts the request once with the reason and shows a pending state, never a success/changed plan", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "r1", status: "pending" }), { status: 202 }));
    render(<PlansClient plansData={DATA} source="api" />);
    const dialog = await open();
    fireEvent.change(within(dialog).getByLabelText(/Reason for the downgrade/i), { target: { value: "Headcount drops after restructuring" } });
    const btn = submitButton(dialog);
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Downgrade requested.*awaiting approval from platform billing/s));
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/tenant/subscription/downgrade");
    expect(JSON.parse(String(init.body))).toEqual({ targetPlanId: "basic", acknowledgement: true, reason: "Headcount drops after restructuring" });
    expect(screen.queryByText(/Successful/i)).toBeNull();
    // Another request cannot be raised while this one is open.
    expect((screen.getByRole("button", { name: "Request downgrade" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a BLOCKING message naming the limits that current usage exceeds, and cannot be confirmed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      code: "USAGE_EXCEEDS_TARGET_PLAN", message: "raw", details: [{ resource: "users", used: 80, limit: 50 }, { resource: "storage_gb", used: 70, limit: 50 }],
    }), { status: 409 }));
    render(<PlansClient plansData={DATA} source="api" />);
    const dialog = await open();
    fireEvent.change(within(dialog).getByLabelText(/Reason for the downgrade/i), { target: { value: "Headcount drops after restructuring" } });
    fireEvent.click(submitButton(dialog));
    const blockedText = () => within(dialog).getAllByRole("alert").map((a) => a.textContent).join(" ");
    await waitFor(() => expect(blockedText()).toMatch(/blocked/i));
    expect(blockedText()).toContain("Users: using 80, the target plan allows 50");
    expect(blockedText()).toContain("Storage (GB): using 70, the target plan allows 50");
    expect(dialog.textContent).not.toContain("raw");
    expect(submitButton(dialog).disabled).toBe(true);
    expect(screen.queryByText(/Downgrade requested/)).toBeNull();
  });

  it("an open request from the server shows the pending banner and disables further downgrade requests", () => {
    const pending: DowngradeRequestSummary = { id: "r1", targetPlanId: "basic", fromPlanId: "enterprise", reason: "x".repeat(12), status: "pending", requestedAt: "2026-10-26T10:00:00Z" };
    render(<PlansClient plansData={DATA} source="api" downgradeRequests={[pending]} />);
    expect(screen.getByRole("status").textContent).toMatch(/Basic is awaiting approval|move to Basic is awaiting approval/);
    expect((screen.getByRole("button", { name: "Request downgrade" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a rejected request is explained in plain language and a new request can be raised", () => {
    const rejected: DowngradeRequestSummary = { id: "r1", targetPlanId: "basic", fromPlanId: "enterprise", reason: "x".repeat(12), status: "rejected", requestedAt: "2026-10-26T10:00:00Z", decisionReason: "USAGE_EXCEEDS_TARGET_PLAN" };
    render(<PlansClient plansData={DATA} source="api" downgradeRequests={[rejected]} />);
    expect(screen.getByRole("status").textContent).toMatch(/usage was above the limits/i);
    expect(document.body.textContent).not.toContain("USAGE_EXCEEDS_TARGET_PLAN");
    expect((screen.getByRole("button", { name: "Request downgrade" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
