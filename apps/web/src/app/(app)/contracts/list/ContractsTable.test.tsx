import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { ContractsTable, type ContractRow } from "./ContractsTable";

const VENDOR_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const VENDOR_B = "11111111-2222-4333-8444-555555555555";

const rows: ContractRow[] = [
  { id: "c1", label: "Road resurfacing", vendorId: VENDOR_A, status: "active", meta: "CON-0001", expiry: "2099-01-01", valueMinor: "15000000" },
  { id: "c2", label: "IT maintenance", vendorId: VENDOR_B, status: "draft", meta: "CON-0002", expiry: "2098-06-15", valueMinor: "250000" },
];

const vendorNames = { [VENDOR_A]: "Acme Infra Pvt Ltd", [VENDOR_B]: "ByteWorks LLP" };

describe("ContractsTable", () => {
  it("GAP-CONTRACTS-LIST-01: shows vendor names, never a raw UUID", () => {
    const { container } = render(<ContractsTable rows={rows} vendorNames={vendorNames} />);
    expect(screen.getByText("Acme Infra Pvt Ltd")).toBeInTheDocument();
    expect(screen.getByText("ByteWorks LLP")).toBeInTheDocument();
    // No 36-char UUID anywhere in the rendered text.
    expect(container.textContent ?? "").not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    // Header is "Vendor", not "Vendor ID".
    expect(screen.getByRole("columnheader", { name: "Vendor" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Vendor ID" })).not.toBeInTheDocument();
  });

  it("GAP-CONTRACTS-LIST-01: unresolved vendor shows 'Unknown vendor', not the UUID", () => {
    render(<ContractsTable rows={rows} vendorNames={{}} />);
    expect(screen.getAllByText("Unknown vendor").length).toBe(2);
  });

  it("GAP-CONTRACTS-LIST-01: when the vendor master failed to load, shows a dash", () => {
    render(<ContractsTable rows={rows} vendorNames={{}} vendorNamesUnavailable />);
    const vendorCells = screen.getAllByText("—");
    expect(vendorCells.length).toBeGreaterThanOrEqual(2);
  });

  it("GAP-CONTRACTS-LIST-04: renders a formatted Value and Expires column", () => {
    render(<ContractsTable rows={rows} vendorNames={vendorNames} />);
    // 15000000 paise = ₹1,50,000.00
    expect(screen.getByText("₹1,50,000.00")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Expires" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Value" })).toBeInTheDocument();
  });

  it("GAP-CONTRACTS-LIST-04: flags an active contract expiring within 30 days", () => {
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    render(
      <ContractsTable
        rows={[{ id: "x", label: "Soon", vendorId: VENDOR_A, status: "active", meta: "CON-X", expiry: soon, valueMinor: "100" }]}
        vendorNames={vendorNames}
      />,
    );
    expect(screen.getByText("Expiring soon")).toBeInTheDocument();
  });

  it("GAP-CONTRACTS-LIST-03: typing in the filter narrows the rows", () => {
    render(<ContractsTable rows={rows} vendorNames={vendorNames} />);
    const box = screen.getByPlaceholderText(/filter/i);
    fireEvent.change(box, { target: { value: "ByteWorks" } });
    expect(screen.getByText("IT maintenance")).toBeInTheDocument();
    expect(screen.queryByText("Road resurfacing")).not.toBeInTheDocument();
  });

  it("GAP-CONTRACTS-LIST-03: columns are sortable (headers expose aria-sort)", () => {
    render(<ContractsTable rows={rows} vendorNames={vendorNames} />);
    const vendorHeader = screen.getByRole("columnheader", { name: "Vendor" });
    expect(vendorHeader).toHaveAttribute("aria-sort");
    const btn = within(vendorHeader).queryByRole("button") ?? vendorHeader;
    fireEvent.click(btn);
    expect(vendorHeader.getAttribute("aria-sort")).not.toBe("none");
  });
});
