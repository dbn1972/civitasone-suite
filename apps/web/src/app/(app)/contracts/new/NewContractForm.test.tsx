import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

import { NewContractForm, type VendorChoice } from "./NewContractForm";

const VENDOR_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const vendors: VendorChoice[] = [
  { id: VENDOR_A, name: "Acme Infra Pvt Ltd" },
  { id: "11111111-2222-4333-8444-555555555555", name: "ByteWorks LLP" },
];

async function pickVendor(name: RegExp) {
  const combo = screen.getByRole("combobox", { name: /vendor/i });
  fireEvent.focus(combo);
  fireEvent.change(combo, { target: { value: "Acme" } });
  const option = await screen.findByRole("option", { name });
  fireEvent.mouseDown(option);
}

describe("NewContractForm", () => {
  beforeEach(() => {
    pushMock.mockReset();
    vi.restoreAllMocks();
  });

  it("GAP-CONTRACTS-NEW-02: an empty submit shows every field error at once and fires no request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NewContractForm vendors={vendors} />);
    fireEvent.click(screen.getByRole("button", { name: /create contract/i }));

    expect(screen.getByText("Contract number is required.")).toBeInTheDocument();
    expect(screen.getByText("Title is required.")).toBeInTheDocument();
    expect(screen.getByText("Select a vendor.")).toBeInTheDocument();
    expect(screen.getByText("Value is required.")).toBeInTheDocument();
    expect(screen.getByText("Start date is required.")).toBeInTheDocument();
    expect(screen.getByText("Expiry date is required.")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("GAP-CONTRACTS-NEW-03: shows a live money preview from the typed rupees", () => {
    render(<NewContractForm vendors={vendors} />);
    fireEvent.change(screen.getByLabelText(/value/i), { target: { value: "1234.50" } });
    expect(screen.getByText("₹1,234.50")).toBeInTheDocument();
  });

  it("GAP-CONTRACTS-NEW-03: rejects a sub-paise amount with an inline error, no request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NewContractForm vendors={vendors} />);
    fireEvent.change(screen.getByLabelText(/value/i), { target: { value: "1.005" } });
    fireEvent.click(screen.getByRole("button", { name: /create contract/i }));
    expect(screen.getByText(/at most two decimals/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("GAP-CONTRACTS-NEW-01/03: picking a vendor submits its UUID and exact paise as a number", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );
    render(<NewContractForm vendors={vendors} />);

    fireEvent.change(screen.getByLabelText(/contract no/i), { target: { value: "CON-2026-1" } });
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "Annual IT Maintenance" } });
    await pickVendor(/Acme Infra/);
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText(/expiry date/i), { target: { value: "2028-03-31" } });
    fireEvent.change(screen.getByLabelText(/value/i), { target: { value: "1234.10" } });

    fireEvent.click(screen.getByRole("button", { name: /create contract/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.vendorId).toBe(VENDOR_A);
    expect(body.valueMinor).toBe(123410);
    expect(typeof body.valueMinor).toBe("number");
    expect(body.contractNo).toBe("CON-2026-1");
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/contracts/list"));
  });

  it("GAP-CONTRACTS-NEW-02: blocks an expiry before the start date", () => {
    render(<NewContractForm vendors={vendors} />);
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText(/expiry date/i), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /create contract/i }));
    expect(screen.getByText(/on or after start date/i)).toBeInTheDocument();
  });

  it("GAP-CONTRACTS-NEW-04: uses design-system token colours, not tailwind text-red-600", () => {
    const { container } = render(<NewContractForm vendors={vendors} />);
    fireEvent.click(screen.getByRole("button", { name: /create contract/i }));
    expect(container.querySelector(".text-red-600")).toBeNull();
    expect(container.querySelector(".text-emerald-700")).toBeNull();
  });
});
