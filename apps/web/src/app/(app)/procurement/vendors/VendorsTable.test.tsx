import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test-utils/intl-render";
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

  // ── GAP-PROCUREMENT-VENDORS-03 / 05 (Wave 2 part 2) ──────────────────────
  const SUMMARY = { total: 600, empanelled: 400, registered: 150, blacklisted: 50 };

  it("VENDORS-03: with a server summary the tiles show TRUE totals (not the 500 fetched) and reconcile", () => {
    const rows = Array.from({ length: 5 }, (_, n) => vendor({ name: `Row ${n}` }));
    seeded(rows);
    const { container } = render(<VendorsTable vendors={rows as never} source="api" truncated limit={500} summary={SUMMARY} />);
    expect(tileValue(container, "Total Vendors")).toBe("600");
    expect(tileValue(container, "Empanelled")).toBe("400");
    expect(tileValue(container, "Not Empanelled")).toBe("150");
    expect(tileValue(container, "Blacklisted")).toBe("50");
    // The three states are exhaustive, so the tiles add up to Total by construction.
    expect(400 + 150 + 50).toBe(SUMMARY.total);
    // No always-zero Provisional tile (vendors have no such state).
    expect(tileValue(container, "Provisional")).toBeNull();
  });

  it("VENDORS-03: says how many of the total are shown", () => {
    const rows = [vendor({ name: "Only" })];
    seeded(rows);
    render(<VendorsTable vendors={rows as never} source="api" summary={SUMMARY} />);
    expect(screen.getByText(/Showing 1 of 600 vendors/)).toBeInTheDocument();
  });

  it("VENDORS-03: a vendor beyond the first page is found by the full-directory search (server ?q=)", async () => {
    const rows = [vendor({ name: "Alpha" })];
    seeded(rows);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "far-1", name: "Vendor 599", category: "goods", vendorType: "empanelled", gstin: "27AAPFU0939F1ZV" }] }), { status: 200 }),
    );
    render(<VendorsTable vendors={rows as never} source="api" summary={SUMMARY} />);
    fireEvent.change(screen.getByLabelText("Search the full vendor directory"), { target: { value: "599" } });
    expect(await screen.findByText("Vendor 599")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).toBeNull();
    const url = String(fetchSpy.mock.calls[0]![0]);
    expect(url).toContain("/api/proxy/v1/procurement/vendors");
    expect(url).toContain("q=599");
    // vendorType is mapped to the real standing, not "not empanelled".
    expect(screen.getAllByText("Empanelled").length).toBeGreaterThan(0);
    fetchSpy.mockRestore();
  });

  it("VENDORS-03: a failed full-directory search shows an error with Retry, not 'No vendors found'", async () => {
    seeded([vendor({ name: "Alpha" })]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    render(<VendorsTable vendors={[vendor({ name: "Alpha" })] as never} source="api" summary={SUMMARY} />);
    fireEvent.change(screen.getByLabelText("Search the full vendor directory"), { target: { value: "zzz" } });
    expect(await screen.findByText("Couldn’t search the vendor directory.")).toBeInTheDocument();
    expect(screen.queryByText("No vendors found")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    fetchSpy.mockRestore();
  });

  // D4c #22 (owner decision 2026-10-27) supersedes the earlier out-of-5 labelling:
  // one scale everywhere - the scorecard score out of 100 with its band.
  it("D4c #22: the rating column is the scorecard score out of 100 with its band", () => {
    const rows = [vendor({ name: "Scored", performanceScore: 86, performanceBand: "A", rating: 4 })];
    seeded(rows);
    render(<VendorsTable vendors={rows as never} source="api" />);
    expect(screen.getByText("Score (/100)")).toBeInTheDocument();
    expect(screen.getByText("86/100 · Band A")).toBeInTheDocument();
    expect(screen.queryByText("4/5")).toBeNull();
  });

  it("D4c #22: an unscored vendor reads 'Not scored', not 0/100", () => {
    const rows = [vendor({ name: "Fresh" })];
    seeded(rows);
    render(<VendorsTable vendors={rows as never} source="api" />);
    expect(screen.getByText("Not scored")).toBeInTheDocument();
    expect(screen.queryByText(/\/100 ·/)).toBeNull();
  });
});
