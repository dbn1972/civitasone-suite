import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VendorsTable } from "./VendorsTable";
import { useSeededResource } from "@/lib/sync/resource";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function seeded(data: Record<string, unknown>[], provenance: "live" | "cached" | "error-no-data" = "live") {
  vi.mocked(useSeededResource).mockReturnValue({ data, provenance, offline: false, cachedAt: null } as never);
}

const vendor = (over: Record<string, unknown> = {}) => ({
  id: "v" + Math.random().toString(36).slice(2, 7),
  vendorCode: "VEN-1",
  name: "Acme",
  category: "General",
  empanelmentStatus: "empanelled",
  ...over,
});

const MIX = [
  vendor({ name: "Alpha", empanelmentStatus: "empanelled" }),
  vendor({ name: "Bravo", empanelmentStatus: "provisional" }),
  vendor({ name: "Charlie", empanelmentStatus: "not_empanelled" }),
  vendor({ name: "Delta", empanelmentStatus: "blacklisted" }),
];

function tileValue(container: HTMLElement, label: string): string | null {
  const labels = Array.from(container.querySelectorAll(".stat .lab"));
  const match = labels.find((el) => el.textContent === label);
  return match?.parentElement?.querySelector(".val")?.textContent ?? null;
}

describe("VendorsTable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("VENDORS-05: the status tiles reconcile — the four status counts sum to Total Vendors", () => {
    seeded(MIX);
    const { container } = render(<VendorsTable vendors={MIX as never} source="api" />);
    expect(tileValue(container, "Total Vendors")).toBe("4");
    expect(tileValue(container, "Not Empanelled")).toBe("1");
    expect(tileValue(container, "Blacklisted")).toBe("1");
  });

  it("VENDORS-01: the status filter narrows the table to one status", () => {
    seeded(MIX);
    render(<VendorsTable vendors={MIX as never} source="api" />);
    // All four visible initially.
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Delta")).toBeInTheDocument();
    // Filter to Blacklisted only.
    fireEvent.click(screen.getByRole("tab", { name: "Blacklisted" }));
    expect(screen.getByText("Delta")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("VENDORS-02: when a vendor has only a phone, the number is masked (raw digits absent)", () => {
    const rows = [vendor({ name: "Phoney", contactPerson: null, phone: "9876543210" })];
    seeded(rows);
    const { container } = render(<VendorsTable vendors={rows as never} source="api" />);
    expect(container.innerHTML).not.toContain("9876543210");
    expect(screen.getByText("98XXXXX210")).toBeInTheDocument();
  });

  it("VENDORS-04: a failed load with no data shows '—' tiles and a retry error state, not 0 + 'No vendors found'", () => {
    seeded([], "error-no-data");
    const { container } = render(<VendorsTable vendors={[] as never} source="error" />);
    expect(tileValue(container, "Total Vendors")).toBe("—");
    expect(tileValue(container, "Blacklisted")).toBe("—");
    expect(screen.queryByText("No vendors found")).toBeNull();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("VENDORS-03: shows a 'showing first N' truncation notice when the list hit the fetch cap", () => {
    seeded(MIX);
    render(<VendorsTable vendors={MIX as never} source="api" truncated limit={500} />);
    expect(screen.getByText(/Showing the first 500 vendors/)).toBeInTheDocument();
  });

  it("VENDORS-03: no truncation notice when the list is within the cap", () => {
    seeded(MIX);
    render(<VendorsTable vendors={MIX as never} source="api" truncated={false} />);
    expect(screen.queryByText(/Showing the first/)).toBeNull();
  });
});
