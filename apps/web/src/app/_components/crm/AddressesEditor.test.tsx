import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AddressesEditor } from "./AddressesEditor";
import * as aa from "@/lib/crm/activityAccount";

vi.mock("@/lib/crm/activityAccount", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/activityAccount")>();
  return { ...actual, getAddresses: vi.fn(), createAddress: vi.fn(), updateAddress: vi.fn(), deleteAddress: vi.fn() };
});

const addr: aa.Address = { id: "ad1", ownerType: "contact", ownerId: "c1", addressType: "billing", line1: "1 Rd", line2: "", city: "Pune", state: "MH", pincode: "411001", country: "India", isPrimary: true };

beforeEach(() => {
  vi.mocked(aa.getAddresses).mockReset();
  vi.mocked(aa.createAddress).mockReset();
  vi.mocked(aa.updateAddress).mockReset();
  vi.mocked(aa.deleteAddress).mockReset();
});

describe("AddressesEditor (CM-001)", () => {
  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(aa.getAddresses).mockResolvedValue({ data: [], source: "error" });
    render(<AddressesEditor ownerType="contact" ownerId="c1" />);
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i)[0]).toBeInTheDocument());
  });

  it("blocks save when PIN is not a valid 6 digits", async () => {
    vi.mocked(aa.getAddresses).mockResolvedValue({ data: [], source: "api" });
    render(<AddressesEditor ownerType="contact" ownerId="c1" />);
    await waitFor(() => expect(screen.getByText(/no addresses yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add address/i }));
    fireEvent.change(screen.getByLabelText(/line 1 for address 1/i), { target: { value: "10 MG Rd" } });
    fireEvent.change(screen.getByLabelText(/city for address 1/i), { target: { value: "Pune" } });
    fireEvent.change(screen.getByLabelText(/pin code for address 1/i), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/valid 6-digit PIN/i)).toBeInTheDocument();
    expect(aa.createAddress).not.toHaveBeenCalled();
  });

  it("creates a valid address then reloads", async () => {
    vi.mocked(aa.getAddresses).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(aa.createAddress).mockResolvedValue(undefined);
    render(<AddressesEditor ownerType="contact" ownerId="c1" />);
    await waitFor(() => expect(screen.getByText(/no addresses yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add address/i }));
    fireEvent.change(screen.getByLabelText(/line 1 for address 1/i), { target: { value: "10 MG Rd" } });
    fireEvent.change(screen.getByLabelText(/city for address 1/i), { target: { value: "Pune" } });
    fireEvent.change(screen.getByLabelText(/pin code for address 1/i), { target: { value: "411001" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(aa.createAddress).toHaveBeenCalled());
    expect(vi.mocked(aa.createAddress).mock.calls[0][0]).toMatchObject({ city: "Pune", pincode: "411001", isPrimary: true });
  });

  it("marking a second address primary clears the first", async () => {
    vi.mocked(aa.getAddresses).mockResolvedValue({ data: [addr], source: "api" });
    render(<AddressesEditor ownerType="contact" ownerId="c1" />);
    await waitFor(() => expect(screen.getByDisplayValue("1 Rd")).toBeInTheDocument());
    // add a second row (its primary defaults false since one exists)
    fireEvent.click(screen.getByRole("button", { name: /add address/i }));
    const firstPrimary = screen.getByLabelText(/mark address 1 as primary/i) as HTMLInputElement;
    const secondPrimary = screen.getByLabelText(/mark address 2 as primary/i) as HTMLInputElement;
    expect(firstPrimary.checked).toBe(true);
    fireEvent.click(secondPrimary);
    expect(secondPrimary.checked).toBe(true);
    expect(firstPrimary.checked).toBe(false);
  });

  it("deletes an address via ConfirmDialog", async () => {
    vi.mocked(aa.getAddresses).mockResolvedValue({ data: [addr], source: "api" });
    vi.mocked(aa.deleteAddress).mockResolvedValue(undefined);
    render(<AddressesEditor ownerType="contact" ownerId="c1" />);
    await waitFor(() => expect(screen.getByDisplayValue("1 Rd")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete address 1/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /delete address/i }));
    await waitFor(() => expect(aa.deleteAddress).toHaveBeenCalledWith("ad1"));
  });
});
