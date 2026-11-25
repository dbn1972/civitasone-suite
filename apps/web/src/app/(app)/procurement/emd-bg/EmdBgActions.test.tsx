import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
const identity = vi.fn();
vi.mock("@/lib/auth/useSessionIdentity", () => ({ useSessionIdentity: () => identity() }));

import { EmdBgActions, isActionable, dispositionsFor } from "./EmdBgActions";

const base = { id: "11111111-1111-4111-8111-111111111111", vendor: "Alpha Co", amountPaise: 125050 };

describe("EmdBgActions", () => {
  beforeEach(() => {
    refresh.mockReset();
    identity.mockReturnValue({ loaded: true, userId: "u1", roles: ["procurement_officer"] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 202 })));
  });

  it("maps register to the dispositions the backend allows", () => {
    expect(dispositionsFor("emd")).toEqual(["forfeit", "refund"]);
    expect(dispositionsFor("pbg")).toEqual(["forfeit", "release"]);
    expect(isActionable("Active")).toBe(true);
    expect(isActionable("collected")).toBe(true);
    expect(isActionable("Forfeited")).toBe(false);
  });

  it("renders nothing for roles outside PROC_ROLES", () => {
    identity.mockReturnValue({ loaded: true, userId: "u1", roles: ["finance_officer"] });
    const { container } = render(<EmdBgActions {...base} register="emd" status="Active" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a settled instrument", () => {
    const { container } = render(<EmdBgActions {...base} register="pbg" status="Released" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("forfeit states amount + irreversibility, requires a reason, and POSTs it to the EMD route", async () => {
    render(<EmdBgActions {...base} register="emd" status="Active" />);
    fireEvent.click(screen.getByRole("button", { name: "Forfeit" }));
    expect(screen.getByText(/cannot be reversed/i)).toBeTruthy();
    expect(document.body.textContent).toContain("1,250.50");
    const confirm = screen.getByRole("button", { name: "Forfeit security" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Bid withdrawn after opening" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/proxy/v1/procurement/emd/${base.id}/forfeit`);
    expect(JSON.parse(init.body as string)).toEqual({ reason: "Bid withdrawn after opening" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("PBG release hits the pbg route and does not claim funds moved", async () => {
    render(<EmdBgActions {...base} register="pbg" status="Active" />);
    fireEvent.click(screen.getByRole("button", { name: "Release" }));
    expect(screen.getByText(/does not itself return funds/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Release guarantee" }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect((vi.mocked(fetch).mock.calls[0] as [string])[0]).toBe(`/api/proxy/v1/procurement/pbg/${base.id}/release`);
  });

  it("a failed request does not refresh as if it succeeded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })));
    render(<EmdBgActions {...base} register="emd" status="Active" />);
    fireEvent.click(screen.getByRole("button", { name: "Refund" }));
    fireEvent.click(screen.getByRole("button", { name: "Refund deposit" }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(refresh).not.toHaveBeenCalled();
  });
});
