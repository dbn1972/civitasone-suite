import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

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

  it("w0-report: posts contactPerson, address and the account number under the API's field name `bankAccount`", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "veNEW" }), { status: 202, headers: { "content-type": "application/json" } }),
    );
    render(<RegisterVendorForm />);
    fill("Vendor name *", "Acme");
    fireEvent.change(screen.getByLabelText("Category *"), { target: { value: "goods" } });
    fill("Contact person", "Asha Verma");
    fill("Address", "12 Sector 5, New Delhi");
    fill("Bank IFSC", "SBIN0001234");
    fill("Bank account number", "123456789012");
    fill("Confirm account number", "123456789012");
    fireEvent.click(screen.getByRole("button", { name: /Register vendor/ }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.bankAccount).toBe("123456789012");
    expect(body).not.toHaveProperty("bankAccountNo");
    expect(body.contactPerson).toBe("Asha Verma");
    expect(body.address).toBe("12 Sector 5, New Delhi");
  });

  it("NEW-03: a DPDP collection notice is shown", () => {
    render(<RegisterVendorForm />);
    expect(screen.getByText(/collected for vendor onboarding/i)).toBeInTheDocument();
  });

  // ── GAP-PROCUREMENT-VENDORS-NEW-02/04/06 (Wave 2 part 2) ─────────────────
  function fillValid() {
    fill("Vendor name *", "Acme");
    fireEvent.change(screen.getByLabelText("Category *"), { target: { value: "goods" } });
    fill("GSTIN", "27AAPFU0939F1ZV");
    fill("PAN", "AAPFU0939F");
  }

  it("NEW-02/06: a 409 VENDOR_DUPLICATE shows a field error and a link to the existing vendor, with no navigation", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      code: "VENDOR_DUPLICATE", message: "raw server text", field: "gstin",
      existingVendorId: "v-existing", existingVendorName: "Acme Traders",
    }), { status: 409 }));
    render(<RegisterVendorForm />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /Register vendor/ }));
    expect(await screen.findByText("A vendor with this GSTIN is already registered.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "View Acme Traders" });
    expect(link).toHaveAttribute("href", "/procurement/vendors/v-existing");
    expect(screen.queryByText(/raw server text/)).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("NEW-02/06: a duplicate PAN is reported on the PAN field", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      code: "VENDOR_DUPLICATE", field: "pan", existingVendorId: "v-existing", existingVendorName: "",
    }), { status: 409 }));
    render(<RegisterVendorForm />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /Register vendor/ }));
    expect(await screen.findByText("A vendor with this PAN is already registered.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View the existing vendor" })).toBeInTheDocument();
  });

  it("NEW-02: a server-side GSTIN rejection (400 VALIDATION_FAILED) is shown on the GSTIN field with fixed copy", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      code: "VALIDATION_FAILED", fieldErrors: [{ field: "gstin", message: "GSTIN check digit is invalid" }],
    }), { status: 400 }));
    render(<RegisterVendorForm />);
    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /Register vendor/ }));
    expect(await screen.findByText(/The GSTIN failed validation/)).toBeInTheDocument();
    expect(screen.queryByText(/check digit is invalid/)).not.toBeInTheDocument();
  });

  it("NEW-04: GSTIN and PAN are honestly labelled as format-checked, not verified", () => {
    render(<RegisterVendorForm />);
    expect(screen.getAllByText(/Not verified against the GST \/ income-tax portals/)).toHaveLength(2);
  });
});
