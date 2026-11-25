import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
const identity = vi.fn();
vi.mock("@/lib/auth/useSessionIdentity", () => ({ useSessionIdentity: () => identity() }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));

import { useSeededResource } from "@/lib/sync/resource";
import { mapEmdBgRows } from "../../../_data/loaders";
import { EmdBgTable } from "./EmdBgTable";
import { EmdBgActions, isActionable, dispositionsFor, refSpec } from "./EmdBgActions";

const base = { id: "11111111-1111-4111-8111-111111111111", vendor: "Alpha Co", amountPaise: 125050 };

function lastBody(): Record<string, unknown> {
  const init = (vi.mocked(fetch).mock.calls[0] as [string, RequestInit])[1];
  return JSON.parse(init.body as string);
}

describe("EmdBgActions", () => {
  beforeEach(() => {
    refresh.mockReset();
    identity.mockReturnValue({ loaded: true, userId: "u1", roles: ["procurement_officer"] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 202 })));
  });

  it("maps register to the dispositions the backend allows, and the required reference field", () => {
    expect(dispositionsFor("emd")).toEqual(["forfeit", "refund"]);
    expect(dispositionsFor("pbg")).toEqual(["forfeit", "release"]);
    expect(refSpec("forfeit")).toEqual({ field: "forfeitureOrderNo", min: 1, max: 64 });
    expect(refSpec("refund").field).toBe("paymentRef");
    expect(refSpec("release").min).toBe(3);
    expect(isActionable("collected")).toBe(true);
    expect(isActionable("Forfeited")).toBe(false);
  });

  it("renders nothing for roles outside PROC_ROLES or a settled instrument", () => {
    identity.mockReturnValue({ loaded: true, userId: "u1", roles: ["finance_officer"] });
    const a = render(<EmdBgActions {...base} register="emd" status="collected" />);
    expect(a.container).toBeEmptyDOMElement();
    identity.mockReturnValue({ loaded: true, userId: "u1", roles: ["procurement_officer"] });
    const b = render(<EmdBgActions {...base} register="pbg" status="released" />);
    expect(b.container).toBeEmptyDOMElement();
  });

  it("forfeit: blocks confirm until a forfeiture order no. is entered, then POSTs forfeitureOrderNo (+ optional reason)", async () => {
    render(<EmdBgActions {...base} register="emd" status="collected" />);
    fireEvent.click(screen.getByRole("button", { name: "Forfeit" }));
    expect(screen.getByText(/cannot be reversed/i)).toBeTruthy();
    expect(screen.getByText(/does not move bank funds/i)).toBeTruthy();
    expect(document.body.textContent).toContain("1,250.50");
    const confirm = screen.getByRole("button", { name: "Forfeit security" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Forfeiture order number/), { target: { value: "  FO/2026/17  " } });
    fireEvent.change(screen.getByLabelText("Remarks (optional)"), { target: { value: "Bid withdrawn after opening" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect((vi.mocked(fetch).mock.calls[0] as [string])[0]).toBe("/api/proxy/v1/procurement/emd/" + base.id + "/forfeit");
    expect(lastBody()).toEqual({ forfeitureOrderNo: "FO/2026/17", reason: "Bid withdrawn after opening" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("refund: needs a paymentRef of at least 3 chars and sends it", async () => {
    render(<EmdBgActions {...base} register="emd" status="collected" />);
    fireEvent.click(screen.getByRole("button", { name: "Refund" }));
    const confirm = screen.getByRole("button", { name: "Refund deposit" });
    const input = screen.getByLabelText(/Payment reference/);
    fireEvent.change(input, { target: { value: "ab" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: "UTR123456" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(lastBody()).toEqual({ paymentRef: "UTR123456" });
  });

  it("PBG release hits the pbg route with paymentRef and does not claim funds moved", async () => {
    render(<EmdBgActions {...base} register="pbg" status="active" />);
    fireEvent.click(screen.getByRole("button", { name: "Release" }));
    expect(screen.getByText(/does not itself return funds/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Payment reference/), { target: { value: "PFMS-9981" } });
    fireEvent.click(screen.getByRole("button", { name: "Release guarantee" }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect((vi.mocked(fetch).mock.calls[0] as [string])[0]).toBe("/api/proxy/v1/procurement/pbg/" + base.id + "/release");
    expect(lastBody()).toEqual({ paymentRef: "PFMS-9981" });
  });

  it("a failed request does not refresh as if it succeeded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })));
    render(<EmdBgActions {...base} register="emd" status="collected" />);
    fireEvent.click(screen.getByRole("button", { name: "Refund" }));
    fireEvent.change(screen.getByLabelText(/Payment reference/), { target: { value: "UTR123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Refund deposit" }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("real backend payload -> loader mapper -> table -> dialog", () => {
  it("renders amount and vendor correctly from {items:[{emdNo, amountMinor:\"125050\", status:\"collected\", vendorId}]}", () => {
    identity.mockReturnValue({ loaded: true, userId: "u1", roles: ["procurement_officer"] });
    const vendorId = "22222222-2222-4222-8222-222222222222";
    const payload = {
      items: [
        { id: "33333333-3333-4333-8333-333333333333", emdNo: "EMD-2026-0001", vendorId, amountMinor: "125050", currency: "INR", instrument: "bank_guarantee", status: "collected", collectedAt: "2026-11-01T00:00:00.000Z" },
      ],
    };
    const rows = mapEmdBgRows(payload, "EMD")!;
    expect(rows[0]).toMatchObject({ ref: "EMD-2026-0001", amount: 125050, status: "collected", vendorId });
    // The page resolves vendor name from vendorId; emulate that join.
    const named = rows.map((r) => ({ ...r, vendor: "Shree Infra Pvt Ltd" }));
    vi.mocked(useSeededResource).mockImplementation(((key: string) => ({
      data: key === "procurement.emd" ? named : [],
      provenance: "live", offline: false, cachedAt: null, fromCache: false,
    })) as unknown as typeof useSeededResource);
    render(<EmdBgTable emdEntries={named} pbgEntries={[]} emdSource="api" pbgSource="api" />);
    expect(screen.getByText("Shree Infra Pvt Ltd")).toBeTruthy();
    expect(screen.getByText("EMD-2026-0001")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refund" }));
    expect(document.body.textContent).toContain("1,250.50");
    expect(document.body.textContent).toContain("Shree Infra Pvt Ltd");
    expect(document.body.textContent).not.toContain("undefined");
  });
});
