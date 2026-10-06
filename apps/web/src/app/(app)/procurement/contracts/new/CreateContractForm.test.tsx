import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import { CreateContractForm } from "./CreateContractForm";

const VENDORS = { data: [{ id: "v1", name: "Acme" }, { id: "v2", name: "Beta" }] };

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Partial<Response>>) {
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    impl(String(input), init) as unknown as Promise<Response>,
  ) as unknown as typeof fetch;
}

async function fillValid() {
  // Choose a vendor explicitly (NEW-01: no auto-select).
  fireEvent.change(await screen.findByRole("combobox"), { target: { value: "v1" } });
  fireEvent.change(screen.getByLabelText("Contract no *"), { target: { value: "CON-1" } });
  fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "AMC" } });
  fireEvent.change(screen.getByLabelText("Contract value (₹) *"), { target: { value: "1000.50" } });
  fireEvent.change(screen.getByLabelText("Start date *"), { target: { value: "2026-01-01" } });
  fireEvent.change(screen.getByLabelText("Expiry date *"), { target: { value: "2027-01-01" } });
}

describe("CreateContractForm", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GAP-CONTRACTS-NEW-01: does not auto-select a vendor; submit is blocked with a vendor error and no POST", async () => {
    const post = vi.fn();
    mockFetch(async (url, init) => {
      if (url.includes("/procurement/vendors")) return { ok: true, json: async () => VENDORS };
      post(url, init);
      return { ok: true, json: async () => ({}) };
    });
    render(<CreateContractForm />);
    // Vendor select starts blank (placeholder selected), not "Acme".
    const select = await screen.findByRole("combobox");
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe(""));

    // Fill everything EXCEPT vendor, then submit.
    fireEvent.change(screen.getByLabelText("Contract no *"), { target: { value: "CON-1" } });
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "AMC" } });
    fireEvent.change(screen.getByLabelText("Contract value (₹) *"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Expiry date *"), { target: { value: "2027-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create contract" }));

    expect(await screen.findByText("Select a vendor.")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("GAP-CONTRACTS-NEW-02: a vendor-load failure shows an error + retry, not an endless 'Loading…', and disables submit", async () => {
    mockFetch(async (url) => {
      if (url.includes("/procurement/vendors")) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => ({}) };
    });
    render(<CreateContractForm />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Couldn.t load vendors/i);
    expect(screen.queryByText("Loading vendors…")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create contract" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("GAP-CONTRACTS-NEW-03: an expiry on/before the start date is blocked client-side with no POST", async () => {
    const post = vi.fn();
    mockFetch(async (url, init) => {
      if (url.includes("/procurement/vendors")) return { ok: true, json: async () => VENDORS };
      post(url, init);
      return { ok: true, json: async () => ({}) };
    });
    render(<CreateContractForm />);
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "v1" } });
    fireEvent.change(screen.getByLabelText("Contract no *"), { target: { value: "CON-1" } });
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "AMC" } });
    fireEvent.change(screen.getByLabelText("Contract value (₹) *"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Start date *"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Expiry date *"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create contract" }));

    expect(await screen.findByText("Expiry date must be after the start date.")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("GAP-CONTRACTS-NEW-03: a 409 shows an inline duplicate error on the contract-no field", async () => {
    mockFetch(async (url) => {
      if (url.includes("/procurement/vendors")) return { ok: true, json: async () => VENDORS };
      return { ok: false, status: 409, json: async () => ({ code: "DUPLICATE" }), text: async () => "" };
    });
    render(<CreateContractForm />);
    await fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Create contract" }));
    expect(await screen.findByText("A contract with this number already exists.")).toBeInTheDocument();
  });

  it("GAP-CONTRACTS-NEW-05: sends exact paise via rupeesToMinorString (1000.50 -> 100050), no float error", async () => {
    let sentBody: Record<string, unknown> | null = null;
    mockFetch(async (url, init) => {
      if (url.includes("/procurement/vendors")) return { ok: true, json: async () => VENDORS };
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return { ok: true, json: async () => ({}) };
    });
    render(<CreateContractForm />);
    await fillValid();
    fireEvent.click(screen.getByRole("button", { name: "Create contract" }));
    await waitFor(() => expect(sentBody).not.toBeNull());
    expect(sentBody!.valueMinor).toBe(100050);
  });

  it("GAP-CONTRACTS-NEW-05: the ₹ hint is hidden until a valid value is typed", async () => {
    mockFetch(async (url) => {
      if (url.includes("/procurement/vendors")) return { ok: true, json: async () => VENDORS };
      return { ok: true, json: async () => ({}) };
    });
    render(<CreateContractForm />);
    await screen.findByRole("combobox");
    // Before typing: no ₹0.00 hint.
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Contract value (₹) *"), { target: { value: "0.10" } });
    expect(screen.getByText("₹0.10")).toBeInTheDocument();
  });
});
