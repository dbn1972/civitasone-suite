import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));

import { RegisterVendorForm } from "./RegisterVendorForm";

function fill(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("RegisterVendorForm", () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("NEW-01: IFSC without an account number is a field error (no submit)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(<RegisterVendorForm />);
    fill("Vendor name *", "Acme");
    fireEvent.change(screen.getByLabelText("Category *"), { target: { value: "goods" } });
    fill("Bank IFSC", "SBIN0001234");
    fireEvent.click(screen.getByRole("button", { name: /Register vendor/ }));
    await screen.findByText(/Enter the account number for this IFSC/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("NEW-01: mismatched confirm account number blocks submit", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(<RegisterVendorForm />);
    fill("Vendor name *", "Acme");
    fireEvent.change(screen.getByLabelText("Category *"), { target: { value: "goods" } });
    fill("Bank IFSC", "SBIN0001234");
    fill("Bank account number", "123456789");
    fill("Confirm account number", "999999999");
    fireEvent.click(screen.getByRole("button", { name: /Register vendor/ }));
    await screen.findByText(/Account numbers do not match/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("NEW-02: a GSTIN whose embedded PAN disagrees with the PAN field is rejected", async () => {
    render(<RegisterVendorForm />);
    fill("Vendor name *", "Acme");
    fireEvent.change(screen.getByLabelText("Category *"), { target: { value: "goods" } });
    fill("GSTIN", "27AAPFU0939F1ZV"); // embedded PAN AAPFU0939F
    fill("PAN", "ABCDE1234F");
    fireEvent.click(screen.getByRole("button", { name: /Register vendor/ }));
    await screen.findByText(/PAN does not match the PAN embedded in the GSTIN/);
  });

  it("NEW-05/NEW-03: a '+91' phone is normalized and submit redirects to the new vendor profile", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "veNEW" }), { status: 201, headers: { "content-type": "application/json" } }),
    );
    render(<RegisterVendorForm />);
    fill("Vendor name *", "Acme");
    fireEvent.change(screen.getByLabelText("Category *"), { target: { value: "goods" } });
    fill("Phone", "+91 98765 43210");
    fireEvent.click(screen.getByRole("button", { name: /Register vendor/ }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.phone).toBe("9876543210");
    expect(body.category).toBe("goods");
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/procurement/vendors/veNEW?registered=1"));
  });

  it("NEW-03: a DPDP collection notice is shown", () => {
    render(<RegisterVendorForm />);
    expect(screen.getByText(/collected for vendor onboarding/i)).toBeInTheDocument();
  });
});
